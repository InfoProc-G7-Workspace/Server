const express = require('express');
const { ScanCommand, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { ddb } = require('../aws');
const { createLogger } = require('../logger');

const router = express.Router();
const log = createLogger('ROBOTS');

// GET /api/robots — list all robots
router.get('/', async (req, res) => {
  try {
    log.info(`List robots requested by user="${req.authUser.display_name}"`);
    const result = await ddb.send(new ScanCommand({ TableName: 'robots' }));
    const items = result.Items || [];
    log.debug(`Returned ${items.length} robot(s)`);
    res.json(items);
  } catch (err) {
    log.error('List robots failed', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/robots/:id
router.get('/:id', async (req, res) => {
  try {
    log.info(`Get robot: robot_id=${req.params.id}`);
    const result = await ddb.send(new GetCommand({
      TableName: 'robots',
      Key: { robot_id: req.params.id },
    }));
    if (!result.Item) {
      log.warn(`Robot not found: robot_id=${req.params.id}`);
      return res.status(404).json({ error: 'Robot not found' });
    }
    log.debug(`Robot found: name="${result.Item.name}", status=${result.Item.status}`);
    res.json(result.Item);
  } catch (err) {
    log.error(`Get robot failed: robot_id=${req.params.id}`, err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/robots — create a robot (admin only)
router.post('/', async (req, res) => {
  if (req.authUser.role !== 'admin') {
    log.warn(`Create robot denied: user="${req.authUser.display_name}" is not admin`);
    return res.status(403).json({ error: 'Admin only' });
  }
  try {
    const item = {
      robot_id: req.body.robot_id,
      name: req.body.name,
      iot_thing_name: req.body.iot_thing_name || '',
      kvs_channel: req.body.kvs_channel || '',
      status: 'offline',
      created_at: new Date().toISOString(),
    };
    log.info(`Creating robot: id=${item.robot_id}, name="${item.name}"`);
    await ddb.send(new PutCommand({ TableName: 'robots', Item: item }));
    log.info(`Robot created: id=${item.robot_id}`);
    res.json(item);
  } catch (err) {
    log.error('Create robot failed', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
