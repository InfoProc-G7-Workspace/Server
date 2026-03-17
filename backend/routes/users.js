const express = require('express');
const { ScanCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { ddb } = require('../aws');
const { createLogger } = require('../logger');

const router = express.Router();
const log = createLogger('USERS');

// GET /api/users — list all users (admin only)
router.get('/', async (req, res) => {
  if (req.authUser.role !== 'admin') {
    log.warn(`List users denied: user="${req.authUser.display_name}" is not admin`);
    return res.status(403).json({ error: 'Admin only' });
  }
  try {
    log.info('Listing all users');
    const result = await ddb.send(new ScanCommand({ TableName: 'users' }));
    const items = result.Items || [];
    log.debug(`Returned ${items.length} user(s)`);
    res.json(items);
  } catch (err) {
    log.error('List users failed', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/users/:id — get single user (self or admin)
router.get('/:id', async (req, res) => {
  if (req.authUser.role !== 'admin' && req.authUser.user_id !== req.params.id) {
    log.warn(`Get user denied: user="${req.authUser.display_name}" tried to access user_id=${req.params.id}`);
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    log.info(`Get user: user_id=${req.params.id}`);
    const result = await ddb.send(new GetCommand({
      TableName: 'users',
      Key: { user_id: req.params.id },
    }));
    if (!result.Item) {
      log.warn(`User not found: user_id=${req.params.id}`);
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.Item);
  } catch (err) {
    log.error(`Get user failed: user_id=${req.params.id}`, err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
