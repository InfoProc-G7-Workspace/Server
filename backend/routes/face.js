const express = require('express');
const crypto = require('crypto');
const { ScanCommand, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { ddb, s3 } = require('../aws');
const config = require('../config');
const { createSession } = require('./auth');
const { createLogger } = require('../logger');

const router = express.Router();
const publicRouter = express.Router();
const log = createLogger('FACE');

const MATCH_THRESHOLD = 0.5;
const DUPLICATE_THRESHOLD = 0.75;
const FACE_BUCKET = config.imageBucket;

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
  log.debug('Scanning face_persons table');
  const result = await ddb.send(new ScanCommand({ TableName: 'face_persons' }));
  const items = result.Items || [];
  log.debug(`Found ${items.length} enrolled person(s) in face_persons`);
  return items;
}

// ── Helper: match a feature vector against all enrolled persons ─────────────

async function matchFeature(feature) {
  log.debug(`Matching feature vector (dim=${feature.length}) against enrolled persons`);
  const persons = await getAllPersons();
  let bestMatch = null;
  let bestSim = -1;

  for (const person of persons) {
    const encoding = JSON.parse(person.encoding);
    const sim = cosineSimilarity(feature, encoding);
    log.debug(`  vs "${person.name}": similarity=${sim.toFixed(4)}`);
    if (sim > bestSim) {
      bestSim = sim;
      bestMatch = person;
    }
  }

  if (bestSim >= MATCH_THRESHOLD && bestMatch) {
    log.info(`Match found: "${bestMatch.name}" with similarity=${bestSim.toFixed(4)} (threshold=${MATCH_THRESHOLD})`);
    return { matched: true, person: bestMatch, similarity: bestSim };
  }
  log.warn(`No match: best similarity=${bestSim.toFixed(4)} < threshold=${MATCH_THRESHOLD}`);
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
// Expects { feature: [128-d float array] } from browser FaceEngine
publicRouter.post('/face-login', async (req, res) => {
  try {
    const { feature } = req.body;
    log.info(`Face login attempt, feature=${feature ? `array(${feature.length})` : 'missing'}`);
    if (!feature || !Array.isArray(feature)) {
      log.warn('Face login rejected: missing or invalid feature array');
      return res.status(400).json({ error: 'feature array required' });
    }

    // Step 1: match against DynamoDB
    log.debug('Step 1: matching feature against enrolled faces');
    const match = await matchFeature(feature);

    if (!match.matched) {
      log.warn(`Face login failed: no match (bestSim=${match.similarity.toFixed(4)})`);
      await logFaceLogin(null, null, match.similarity);
      return res.status(401).json({ error: 'Face not recognized', similarity: match.similarity });
    }

    // Step 2: find or create DynamoDB user
    log.debug(`Step 2: resolving user for person="${match.person.name}" (person_id=${match.person.person_id})`);
    let user = null;
    if (match.person.user_id) {
      user = await findUserById(match.person.user_id);
      if (user) log.debug(`Found user by user_id: ${user.user_id}`);
    }
    if (!user) {
      user = await findUserByName(match.person.name);
      if (user) log.debug(`Found user by display_name: ${user.user_id}`);
    }
    if (!user) {
      log.info(`Auto-creating user account for "${match.person.name}"`);
      user = await createUser(match.person.name);
    }

    await logFaceLogin(match.person.person_id, match.person.name, match.similarity);

    // Step 3: create session (same as username login)
    log.info(`Face login successful: "${match.person.name}" (sim=${match.similarity.toFixed(4)}), creating session`);
    const sessionData = await createSession(res, user);
    res.json({
      ...sessionData,
      similarity: match.similarity,
    });
  } catch (err) {
    log.error('Face login error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Protected Routes (mounted under /api/face, auth middleware applied)
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/face/enroll — admin only
// Expects { feature: [128-d], name, department?, image? (for photo storage) }
router.post('/enroll', async (req, res) => {
  if (req.authUser.role !== 'admin') {
    log.warn(`Enroll denied: user="${req.authUser.display_name}" is not admin`);
    return res.status(403).json({ error: 'Admin only' });
  }
  try {
    const { feature, name, department, image } = req.body;
    log.info(`Enroll attempt: name="${name}", department="${department || ''}", hasImage=${!!image}, featureDim=${feature ? feature.length : 0}`);
    if (!feature || !Array.isArray(feature) || !name) {
      log.warn('Enroll rejected: missing feature array or name');
      return res.status(400).json({ error: 'feature array and name required' });
    }

    // Step 1: check for duplicate enrollment
    log.debug('Step 1: checking for duplicate faces');
    const existingPersons = await getAllPersons();
    for (const p of existingPersons) {
      const encoding = JSON.parse(p.encoding);
      const sim = cosineSimilarity(feature, encoding);
      log.debug(`  duplicate check vs "${p.name}": similarity=${sim.toFixed(4)}`);
      if (sim >= DUPLICATE_THRESHOLD) {
        log.warn(`Enroll rejected: face too similar to "${p.name}" (sim=${sim.toFixed(4)} >= ${DUPLICATE_THRESHOLD})`);
        return res.json({
          ok: false,
          msg: `Face too similar to existing person "${p.name}" (similarity: ${sim.toFixed(3)})`,
        });
      }
    }

    // Step 2: look up DynamoDB user_id for the given name
    log.debug(`Step 2: looking up existing user for name="${name}"`);
    let userId = '';
    const existingUser = await findUserByName(name);
    if (existingUser) {
      userId = existingUser.user_id;
      log.debug(`Found existing user_id=${userId}`);
    } else {
      log.debug('No existing user found, will enroll without user_id link');
    }

    // Step 3: upload photo to S3 (if image provided)
    const personId = crypto.randomUUID();
    let photoKey = '';
    if (image) {
      log.debug(`Step 3: uploading face photo to S3 for person_id=${personId}`);
      photoKey = await uploadFacePhoto(personId, image);
      log.debug(`Photo uploaded: key=${photoKey}`);
    }

    // Step 4: store person in DynamoDB
    log.debug('Step 4: writing to face_persons table');
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

    log.info(`Enroll successful: "${name}" (person_id=${personId})`);
    res.json({
      ok: true,
      msg: `Enrolled "${name}" successfully`,
      person_id: personId,
      name,
    });
  } catch (err) {
    log.error('Face enroll error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/face/recognize
// Expects { faces: [{ feature: [128-d], box: [x1,y1,x2,y2] }] } from browser FaceEngine
router.post('/recognize', async (req, res) => {
  try {
    const { faces } = req.body;
    log.info(`Recognize request: ${faces ? faces.length : 0} face(s)`);
    if (!faces || !Array.isArray(faces) || faces.length === 0) {
      log.warn('Recognize rejected: missing or empty faces array');
      return res.status(400).json({ error: 'faces array required' });
    }

    // Match each face against DynamoDB
    const results = [];
    for (let i = 0; i < faces.length; i++) {
      const face = faces[i];
      if (!face.feature || !Array.isArray(face.feature)) {
        log.warn(`Face[${i}] skipped: missing feature array`);
        continue;
      }
      log.debug(`Matching face[${i}] (dim=${face.feature.length})`);
      const match = await matchFeature(face.feature);
      if (match.matched) {
        log.info(`Face[${i}] matched: "${match.person.name}" (sim=${match.similarity.toFixed(4)})`);
        results.push({
          name: match.person.name,
          similarity: match.similarity,
          person_id: match.person.person_id,
          box: face.box,
        });
      } else {
        log.info(`Face[${i}] not matched (bestSim=${match.similarity.toFixed(4)})`);
        results.push({ name: null, similarity: match.similarity, box: face.box });
      }
    }

    log.info(`Recognize complete: ${results.filter(r => r.name).length}/${results.length} matched`);
    res.json({ ok: true, results });
  } catch (err) {
    log.error('Face recognize error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/face/persons — admin only
router.get('/persons', async (req, res) => {
  if (req.authUser.role !== 'admin') {
    log.warn(`List persons denied: user="${req.authUser.display_name}" is not admin`);
    return res.status(403).json({ error: 'Admin only' });
  }
  try {
    log.info('Listing all enrolled persons');
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
          log.warn(`Failed to generate signed URL for person="${p.name}", key=${p.photo_s3_key}`, err);
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

    log.info(`Returned ${items.length} person(s)`);
    res.json({ ok: true, persons: items });
  } catch (err) {
    log.error('Face persons error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/face/persons/:id — admin only
router.delete('/persons/:id', async (req, res) => {
  if (req.authUser.role !== 'admin') {
    log.warn(`Delete person denied: user="${req.authUser.display_name}" is not admin`);
    return res.status(403).json({ error: 'Admin only' });
  }
  try {
    const personId = req.params.id;
    log.info(`Delete person request: person_id=${personId}`);

    // Find person to get S3 key
    const persons = await getAllPersons();
    const person = persons.find(p => p.person_id === personId);

    if (!person) {
      log.warn(`Delete failed: person_id=${personId} not found`);
      return res.status(404).json({ ok: false, msg: 'Person not found' });
    }

    // Delete photo from S3
    if (person.photo_s3_key) {
      try {
        log.debug(`Deleting S3 photo: bucket=${FACE_BUCKET}, key=${person.photo_s3_key}`);
        await s3.send(new DeleteObjectCommand({
          Bucket: FACE_BUCKET,
          Key: person.photo_s3_key,
        }));
      } catch (err) {
        log.warn(`Failed to delete S3 photo for "${person.name}"`, err);
      }
    }

    // Delete from DynamoDB
    await ddb.send(new DeleteCommand({
      TableName: 'face_persons',
      Key: { person_id: personId },
    }));

    log.info(`Person deleted: "${person.name}" (person_id=${personId})`);
    res.json({ ok: true });
  } catch (err) {
    log.error('Face delete error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/face/logs — admin only
router.get('/logs', async (req, res) => {
  if (req.authUser.role !== 'admin') {
    log.warn(`View logs denied: user="${req.authUser.display_name}" is not admin`);
    return res.status(403).json({ error: 'Admin only' });
  }
  try {
    log.info('Fetching face login logs');
    const result = await ddb.send(new ScanCommand({ TableName: 'face_login_logs' }));
    const logs = (result.Items || []).sort((a, b) =>
      new Date(b.login_time) - new Date(a.login_time)
    );
    log.info(`Returned ${logs.length} face login log(s)`);
    res.json({ ok: true, logs });
  } catch (err) {
    log.error('Face logs error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


module.exports = { router, publicRouter };
