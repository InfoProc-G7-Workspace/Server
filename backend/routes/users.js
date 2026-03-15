const express = require('express');
const crypto = require('crypto');
const { ScanCommand, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { ddb } = require('../aws');

const router = express.Router();

// POST /api/users/login — login by display name
router.post('/login', async (req, res) => {
  try {
    const { display_name } = req.body;
    if (!display_name) return res.status(400).json({ error: 'display_name required' });

    const result = await ddb.send(new ScanCommand({
      TableName: 'users',
      FilterExpression: 'display_name = :name',
      ExpressionAttributeValues: { ':name': display_name },
    }));

    const user = (result.Items || [])[0];
    if (!user) return res.status(401).json({ error: 'User not found' });

    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/users/register — create a new user
router.post('/register', async (req, res) => {
  try {
    const { display_name } = req.body;
    if (!display_name) return res.status(400).json({ error: 'display_name required' });

    // Check if user already exists
    const existing = await ddb.send(new ScanCommand({
      TableName: 'users',
      FilterExpression: 'display_name = :name',
      ExpressionAttributeValues: { ':name': display_name },
    }));

    if ((existing.Items || []).length > 0) {
      return res.status(409).json({ error: 'User already exists' });
    }

    const item = {
      user_id: crypto.randomUUID(),
      display_name,
      role: display_name === 'admin' ? 'admin' : 'user',
      created_at: new Date().toISOString(),
    };

    await ddb.send(new PutCommand({ TableName: 'users', Item: item }));
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users — list all users
router.get('/', async (req, res) => {
  try {
    const result = await ddb.send(new ScanCommand({ TableName: 'users' }));
    res.json(result.Items || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/:id — get single user
router.get('/:id', async (req, res) => {
  try {
    const result = await ddb.send(new GetCommand({
      TableName: 'users',
      Key: { user_id: req.params.id },
    }));
    if (!result.Item) return res.status(404).json({ error: 'User not found' });
    res.json(result.Item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
