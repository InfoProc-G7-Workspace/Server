const express = require('express');
const crypto = require('crypto');
const { ScanCommand, PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { ddb } = require('../aws');

const router = express.Router();

// GET /api/sessions — list sessions (with user isolation)
router.get('/', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];

    const params = { TableName: 'sessions' };
    const filters = [];
    const values = {};

    // User isolation: regular users always see only their own sessions
    if (userRole !== 'admin' && userId) {
      filters.push('user_id = :uid');
      values[':uid'] = userId;
    } else if (req.query.user_id) {
      filters.push('user_id = :uid');
      values[':uid'] = req.query.user_id;
    }

    if (req.query.robot_id) {
      filters.push('robot_id = :rid');
      values[':rid'] = req.query.robot_id;
    }

    if (filters.length) {
      params.FilterExpression = filters.join(' AND ');
      params.ExpressionAttributeValues = values;
    }

    const result = await ddb.send(new ScanCommand(params));
    res.json(result.Items || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sessions/:id — get session detail (with user isolation)
router.get('/:id', async (req, res) => {
  try {
    const result = await ddb.send(new GetCommand({
      TableName: 'sessions',
      Key: { session_id: req.params.id },
    }));
    if (!result.Item) return res.status(404).json({ error: 'Session not found' });

    // User isolation: non-admin can only view their own sessions
    const userId = req.headers['x-user-id'];
    const userRole = req.headers['x-user-role'];
    if (userRole !== 'admin' && userId && result.Item.user_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(result.Item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sessions — create a session (recording starts)
router.post('/', async (req, res) => {
  try {
    const sessionId = crypto.randomUUID();
    const item = {
      session_id: sessionId,
      robot_id: req.body.robot_id,
      user_id: req.body.user_id,
      started_at: new Date().toISOString(),
      ended_at: null,
      image_s3_prefix: req.body.user_id + '/' + sessionId + '/',
      scene_id: crypto.randomUUID(),
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

// PUT /api/sessions/:id/end — end a session (signals processor)
router.put('/:id/end', async (req, res) => {
  try {
    await ddb.send(new UpdateCommand({
      TableName: 'sessions',
      Key: { session_id: req.params.id },
      UpdateExpression: 'SET ended_at = :t, scene_status = :s',
      ExpressionAttributeValues: {
        ':t': new Date().toISOString(),
        ':s': 'processing',
      },
    }));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
