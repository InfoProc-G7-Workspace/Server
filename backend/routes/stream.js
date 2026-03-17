const express = require('express');
const { ListObjectsV2Command, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3, ddb } = require('../aws');
const config = require('../config');
const { createLogger } = require('../logger');

const router = express.Router();
const log = createLogger('STREAM');

// GET /api/stream/images?session_id=xxx — list session images with signed URLs
router.get('/images', async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    log.info(`List images: session_id=${sessionId}`);
    if (!sessionId) {
      log.warn('List images rejected: missing session_id');
      return res.status(400).json({ error: 'session_id required' });
    }

    // Fetch session and verify ownership
    const session = await ddb.send(new GetCommand({
      TableName: 'sessions',
      Key: { session_id: sessionId },
    }));
    if (!session.Item) {
      log.warn(`Session not found: session_id=${sessionId}`);
      return res.status(404).json({ error: 'Session not found' });
    }

    const { user_id, role } = req.authUser;
    if (role !== 'admin' && session.Item.user_id !== user_id) {
      log.warn(`Access denied: user=${user_id} tried to access session owned by ${session.Item.user_id}`);
      return res.status(403).json({ error: 'Access denied' });
    }

    const prefix = session.Item.image_s3_prefix;
    log.debug(`Listing S3 objects: bucket=${config.imageBucket}, prefix=${prefix}`);
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

    log.info(`Returned ${items.length} image(s) for session_id=${sessionId}`);
    res.json(items);
  } catch (err) {
    log.error('List images failed', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stream/scene-url?session_id=xxx — get signed URL for a 3D scene
router.get('/scene-url', async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    log.info(`Get scene URL: session_id=${sessionId}`);
    if (!sessionId) {
      log.warn('Scene URL rejected: missing session_id');
      return res.status(400).json({ error: 'session_id required' });
    }

    // Fetch session and verify ownership
    const session = await ddb.send(new GetCommand({
      TableName: 'sessions',
      Key: { session_id: sessionId },
    }));
    if (!session.Item) {
      log.warn(`Session not found: session_id=${sessionId}`);
      return res.status(404).json({ error: 'Session not found' });
    }

    const { user_id, role } = req.authUser;
    if (role !== 'admin' && session.Item.user_id !== user_id) {
      log.warn(`Access denied: user=${user_id} tried to access scene for session owned by ${session.Item.user_id}`);
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!session.Item.scene_s3_key) {
      log.warn(`Scene not available for session_id=${sessionId}`);
      return res.status(404).json({ error: 'Scene not available' });
    }

    const url = await getSignedUrl(s3, new GetObjectCommand({
      Bucket: config.sceneBucket,
      Key: session.Item.scene_s3_key,
    }), { expiresIn: 3600 });

    log.debug(`Scene URL generated: bucket=${config.sceneBucket}, key=${session.Item.scene_s3_key}`);
    res.json({ url });
  } catch (err) {
    log.error('Get scene URL failed', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stream/save-frame — save a camera frame to S3 during recording
router.post('/save-frame', async (req, res) => {
  try {
    const { session_id, frame_data } = req.body;
    if (!session_id || !frame_data) {
      log.warn('Save frame rejected: missing session_id or frame_data');
      return res.status(400).json({ error: 'session_id and frame_data required' });
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
    // Derive S3 key from authenticated user, not client input
    const key = req.authUser.user_id + '/' + session_id + '/frame_' + paddedNum + '.jpg';

    // Decode base64 and upload to S3
    const buffer = Buffer.from(frame_data, 'base64');
    await s3.send(new PutObjectCommand({
      Bucket: config.imageBucket,
      Key: key,
      Body: buffer,
      ContentType: 'image/jpeg',
    }));

    log.debug(`Frame saved: session=${session_id}, frame=#${frameNumber}, size=${buffer.length}bytes, key=${key}`);
    res.json({ ok: true, frame_number: frameNumber });
  } catch (err) {
    log.error(`Save frame failed: session=${req.body.session_id}`, err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
