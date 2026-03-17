const express = require('express');
const crypto = require('crypto');
const { ScanCommand, PutCommand, DeleteCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { ddb, s3 } = require('../aws');
const config = require('../config');
const { createSession } = require('./auth');

const router = express.Router();
const publicRouter = express.Router();

const FLASK_URL = process.env.FLASK_URL || 'http://127.0.0.1:5000';
const INTERNAL_KEY = process.env.FACE_API_KEY || 'face-internal-secret';

const MATCH_THRESHOLD = 0.5;
const DUPLICATE_THRESHOLD = 0.75;
const FACE_BUCKET = config.imageBucket;

// ── Helper: call Flask for ML compute only ──────────────────────────────────

async function callFlask(path, options = {}) {
  const url = `${FLASK_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': INTERNAL_KEY,
      ...(options.headers || {}),
    },
  });
  if (!res.ok && res.status >= 500) {
    throw new Error('Face service unavailable');
  }
  return res.json();
}

// ── Helper: detect faces via Flask ──────────────────────────────────────────

async function detectFaces(imageData) {
  const data = await callFlask('/api/detect', {
    method: 'POST',
    body: JSON.stringify({ image: imageData }),
  });
  if (!data.ok) {
    return { ok: false, msg: data.msg || 'Detection failed', timing: data.timing };
  }
  return { ok: true, faces: data.faces, timing: data.timing };
}

// ── Helper: cosine similarity ───────────────────────────────────────────────

function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Helper: get all face_persons from DynamoDB ──────────────────────────────

async function getAllPersons() {
  const result = await ddb.send(new ScanCommand({ TableName: 'face_persons' }));
  return result.Items || [];
}

// ── Helper: match a feature vector against all enrolled persons ─────────────

async function matchFeature(feature) {
  const persons = await getAllPersons();
  let bestMatch = null;
  let bestSim = -1;

  for (const person of persons) {
    const encoding = JSON.parse(person.encoding);
    const sim = cosineSimilarity(feature, encoding);
    if (sim > bestSim) {
      bestSim = sim;
      bestMatch = person;
    }
  }

  if (bestSim >= MATCH_THRESHOLD && bestMatch) {
    return { matched: true, person: bestMatch, similarity: bestSim };
  }
  return { matched: false, similarity: bestSim };
}

// ── Helper: find DynamoDB user by display_name ──────────────────────────────

async function findUserByName(displayName) {
  const result = await ddb.send(new ScanCommand({
    TableName: 'users',
    FilterExpression: 'display_name = :name',
    ExpressionAttributeValues: { ':name': displayName },
  }));
  return (result.Items || [])[0] || null;
}

// ── Helper: find DynamoDB user by user_id ───────────────────────────────────

async function findUserById(userId) {
  const result = await ddb.send(new ScanCommand({
    TableName: 'users',
    FilterExpression: 'user_id = :uid',
    ExpressionAttributeValues: { ':uid': userId },
  }));
  return (result.Items || [])[0] || null;
}

// ── Helper: auto-create user in DynamoDB ────────────────────────────────────

async function createUser(displayName) {
  const user = {
    user_id: crypto.randomUUID(),
    display_name: displayName,
    role: displayName === config.adminUsername ? 'admin' : 'user',
    created_at: new Date().toISOString(),
  };
  await ddb.send(new PutCommand({ TableName: 'users', Item: user }));
  return user;
}

// ── Helper: save face photo to S3, return key ───────────────────────────────

async function uploadFacePhoto(personId, imageData) {
  // Strip data URL prefix if present
  let raw = imageData;
  if (raw.includes(',')) {
    raw = raw.split(',')[1];
  }
  const buf = Buffer.from(raw, 'base64');
  const key = `faces/${personId}.jpg`;

  await s3.send(new PutObjectCommand({
    Bucket: FACE_BUCKET,
    Key: key,
    Body: buf,
    ContentType: 'image/jpeg',
  }));
  return key;
}

// ── Helper: log face login to DynamoDB ──────────────────────────────────────

async function logFaceLogin(personId, personName, similarity) {
  await ddb.send(new PutCommand({
    TableName: 'face_login_logs',
    Item: {
      log_id: crypto.randomUUID(),
      person_id: personId || '',
      person_name: personName || 'Unknown',
      similarity: similarity || 0,
      login_time: new Date().toISOString(),
    },
  }));
}

// ══════════════════════════════════════════════════════════════════════════════
// Public Route (mounted on /api/auth by server.js)
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/auth/face-login
publicRouter.post('/face-login', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'image required' });
    }

    // Step 1: detect faces via Flask
    let detection;
    try {
      detection = await detectFaces(image);
    } catch (err) {
      return res.status(503).json({ error: 'Face recognition service unavailable' });
    }

    if (!detection.ok || !detection.faces || detection.faces.length === 0) {
      return res.status(401).json({ error: detection.msg || 'No face detected' });
    }

    // Step 2: match the first detected face against DynamoDB
    const feature = detection.faces[0].feature;
    const match = await matchFeature(feature);

    if (!match.matched) {
      await logFaceLogin(null, null, match.similarity);
      return res.status(401).json({ error: 'Face not recognized', similarity: match.similarity });
    }

    // Step 3: find or create DynamoDB user
    let user = null;
    if (match.person.user_id) {
      user = await findUserById(match.person.user_id);
    }
    if (!user) {
      user = await findUserByName(match.person.name);
    }
    if (!user) {
      user = await createUser(match.person.name);
    }

    await logFaceLogin(match.person.person_id, match.person.name, match.similarity);

    // Step 4: create session (same as username login)
    const sessionData = await createSession(res, user);
    res.json({
      ...sessionData,
      similarity: match.similarity,
      timing: detection.timing,
    });
  } catch (err) {
    console.error('Face login error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Protected Routes (mounted under /api/face, auth middleware applied)
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/face/enroll — admin only
router.post('/enroll', async (req, res) => {
  if (req.authUser.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  try {
    const { image, name, department } = req.body;
    if (!image || !name) {
      return res.status(400).json({ error: 'image and name required' });
    }

    // Step 1: detect face via Flask
    let detection;
    try {
      detection = await detectFaces(image);
    } catch (err) {
      return res.status(503).json({ error: 'Face service unavailable' });
    }

    if (!detection.ok || !detection.faces || detection.faces.length === 0) {
      return res.json({ ok: false, msg: detection.msg || 'No face detected' });
    }

    const feature = detection.faces[0].feature;

    // Step 2: check for duplicate enrollment
    const existingPersons = await getAllPersons();
    for (const p of existingPersons) {
      const encoding = JSON.parse(p.encoding);
      const sim = cosineSimilarity(feature, encoding);
      if (sim >= DUPLICATE_THRESHOLD) {
        return res.json({
          ok: false,
          msg: `Face too similar to existing person "${p.name}" (similarity: ${sim.toFixed(3)})`,
        });
      }
    }

    // Step 3: look up DynamoDB user_id for the given name
    let userId = '';
    const existingUser = await findUserByName(name);
    if (existingUser) {
      userId = existingUser.user_id;
    }

    // Step 4: upload photo to S3
    const personId = crypto.randomUUID();
    const photoKey = await uploadFacePhoto(personId, image);

    // Step 5: store person in DynamoDB
    await ddb.send(new PutCommand({
      TableName: 'face_persons',
      Item: {
        person_id: personId,
        name,
        department: department || '',
        encoding: JSON.stringify(feature),
        photo_s3_key: photoKey,
        user_id: userId,
        created_at: new Date().toISOString(),
      },
    }));

    res.json({
      ok: true,
      person_id: personId,
      name,
      timing: detection.timing,
    });
  } catch (err) {
    console.error('Face enroll error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/face/recognize
router.post('/recognize', async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: 'image required' });
    }

    // Step 1: detect faces via Flask
    let detection;
    try {
      detection = await detectFaces(image);
    } catch (err) {
      return res.status(503).json({ error: 'Face service unavailable' });
    }

    if (!detection.ok || !detection.faces || detection.faces.length === 0) {
      return res.json({ ok: false, msg: detection.msg || 'No face detected' });
    }

    // Step 2: match each face against DynamoDB
    const results = [];
    const labels = [];
    for (const face of detection.faces) {
      const match = await matchFeature(face.feature);
      if (match.matched) {
        results.push({
          name: match.person.name,
          similarity: match.similarity,
          person_id: match.person.person_id,
          box: face.box,
        });
        labels.push({ name: match.person.name, sim: match.similarity });
      } else {
        results.push({ name: null, similarity: match.similarity, box: face.box });
        labels.push({ name: null, sim: 0 });
      }
    }

    // Step 3: annotate image via Flask
    let annotated = null;
    try {
      const annotateResp = await callFlask('/api/annotate', {
        method: 'POST',
        body: JSON.stringify({
          image,
          faces: detection.faces,
          labels,
        }),
      });
      if (annotateResp.ok) {
        annotated = annotateResp.annotated;
      }
    } catch (err) {
      // Annotation failure is non-critical
    }

    res.json({
      ok: true,
      results,
      annotated,
      timing: detection.timing,
    });
  } catch (err) {
    console.error('Face recognize error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/face/persons — admin only
router.get('/persons', async (req, res) => {
  if (req.authUser.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  try {
    const persons = await getAllPersons();

    // Generate signed URLs for photos
    const items = await Promise.all(persons.map(async (p) => {
      let photoUrl = null;
      if (p.photo_s3_key) {
        try {
          photoUrl = await getSignedUrl(s3, new GetObjectCommand({
            Bucket: FACE_BUCKET,
            Key: p.photo_s3_key,
          }), { expiresIn: 3600 });
        } catch (err) {
          // Photo may not exist
        }
      }
      return {
        person_id: p.person_id,
        name: p.name,
        department: p.department || '',
        user_id: p.user_id || '',
        photo_url: photoUrl,
        created_at: p.created_at,
      };
    }));

    res.json({ ok: true, persons: items });
  } catch (err) {
    console.error('Face persons error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/face/persons/:id — admin only
router.delete('/persons/:id', async (req, res) => {
  if (req.authUser.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  try {
    const personId = req.params.id;

    // Find person to get S3 key
    const persons = await getAllPersons();
    const person = persons.find(p => p.person_id === personId);

    if (!person) {
      return res.status(404).json({ ok: false, msg: 'Person not found' });
    }

    // Delete photo from S3
    if (person.photo_s3_key) {
      try {
        await s3.send(new DeleteObjectCommand({
          Bucket: FACE_BUCKET,
          Key: person.photo_s3_key,
        }));
      } catch (err) {
        // Non-critical
      }
    }

    // Delete from DynamoDB
    await ddb.send(new DeleteCommand({
      TableName: 'face_persons',
      Key: { person_id: personId },
    }));

    res.json({ ok: true });
  } catch (err) {
    console.error('Face delete error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/face/logs — admin only
router.get('/logs', async (req, res) => {
  if (req.authUser.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  try {
    const result = await ddb.send(new ScanCommand({ TableName: 'face_login_logs' }));
    const logs = (result.Items || []).sort((a, b) =>
      new Date(b.login_time) - new Date(a.login_time)
    );
    res.json({ ok: true, logs });
  } catch (err) {
    console.error('Face logs error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/face/pynq-health
router.get('/pynq-health', async (req, res) => {
  try {
    const data = await callFlask('/api/health');
    res.json(data);
  } catch (err) {
    res.json({ ok: false, pynq: false, error: 'Face service unavailable' });
  }
});

module.exports = { router, publicRouter };
