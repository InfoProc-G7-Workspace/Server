const express = require('express');
const { ScanCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { ddb } = require('../aws');

const router = express.Router();

// GET /api/users — list all users (admin only)
router.get('/', async (req, res) => {
  if (req.authUser.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  try {
    const result = await ddb.send(new ScanCommand({ TableName: 'users' }));
    res.json(result.Items || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/:id — get single user (self or admin)
router.get('/:id', async (req, res) => {
  if (req.authUser.role !== 'admin' && req.authUser.user_id !== req.params.id) {
    return res.status(403).json({ error: 'Access denied' });
  }
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
