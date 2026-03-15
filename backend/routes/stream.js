const express = require('express');
const { ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3, ddb } = require('../aws');
const config = require('../config');

const router = express.Router();

// GET /api/stream/images?prefix=xxx — list session images with signed URLs
router.get('/images', async (req, res) => {
  try {
    const prefix = req.query.prefix;
    if (!prefix) return res.status(400).json({ error: 'prefix required' });

    const result = await s3.send(new ListObjectsV2Command({
      Bucket: config.imageBucket,
      Prefix: prefix,
    }));

    const items = await Promise.all((result.Contents || []).map(async (obj) => {
      const url = await getSignedUrl(s3, new GetObjectCommand({
        Bucket: config.imageBucket,
        Key: obj.Key,
      }), { expiresIn: 3600 });
      return { key: obj.Key, url, size: obj.Size };
    }));

    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stream/scene-url?key=xxx — get signed URL for a 3D scene
router.get('/scene-url', async (req, res) => {
  try {
    const key = req.query.key;
    if (!key) return res.status(400).json({ error: 'key required' });

    const url = await getSignedUrl(s3, new GetObjectCommand({
      Bucket: config.sceneBucket,
      Key: key,
    }), { expiresIn: 3600 });

    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stream/save-frame — save a camera frame to S3 during recording
router.post('/save-frame', async (req, res) => {
  try {
    const { session_id, user_id, frame_data } = req.body;
    if (!session_id || !user_id || !frame_data) {
      return res.status(400).json({ error: 'session_id, user_id, and frame_data required' });
    }

    // Increment image_count and get the new count for the filename
    const updateResult = await ddb.send(new UpdateCommand({
      TableName: 'sessions',
      Key: { session_id },
      UpdateExpression: 'ADD image_count :one',
      ExpressionAttributeValues: { ':one': 1 },
      ReturnValues: 'UPDATED_NEW',
    }));

    const frameNumber = updateResult.Attributes.image_count;
    const paddedNum = String(frameNumber).padStart(6, '0');
    const key = user_id + '/' + session_id + '/frame_' + paddedNum + '.jpg';

    // Decode base64 and upload to S3
    const buffer = Buffer.from(frame_data, 'base64');
    await s3.send(new PutObjectCommand({
      Bucket: config.imageBucket,
      Key: key,
      Body: buffer,
      ContentType: 'image/jpeg',
    }));

    res.json({ ok: true, frame_number: frameNumber });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
