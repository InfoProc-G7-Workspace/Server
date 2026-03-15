const express = require('express');
const crypto = require('crypto');
const { ScanCommand, PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { ddb } = require('../aws');

const router = express.Router();

// GET /api/sessions?robot_id=xxx
router.get('/', async (req, res) => {
  try {
    const params = { TableName: 'sessions' };
    if (req.query.robot_id) {
      params.FilterExpression = 'robot_id = :rid';
      params.ExpressionAttributeValues = { ':rid': req.query.robot_id };
    }
    const result = await ddb.send(new ScanCommand(params));
    res.json(result.Items || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sessions/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await ddb.send(new GetCommand({
      TableName: 'sessions',
      Key: { session_id: req.params.id },
    }));
    if (!result.Item) return res.status(404).json({ error: 'Session not found' });
    res.json(result.Item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sessions — create a session
router.post('/', async (req, res) => {
  try {
    const sessionId = crypto.randomUUID();
    const item = {
      session_id: sessionId,
      robot_id: req.body.robot_id,
      user_id: req.body.user_id,
      started_at: new Date().toISOString(),
      ended_at: null,
      image_s3_prefix: req.body.robot_id + '/' + sessionId + '/',
      scene_s3_key: null,
      scene_status: 'pending',
      image_count: 0,
    };
    await ddb.send(new PutCommand({ TableName: 'sessions', Item: item }));
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/sessions/:id/end — end a session
router.put('/:id/end', async (req, res) => {
  try {
    await ddb.send(new UpdateCommand({
      TableName: 'sessions',
      Key: { session_id: req.params.id },
      UpdateExpression: 'SET ended_at = :t',
      ExpressionAttributeValues: { ':t': new Date().toISOString() },
    }));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
