const express = require('express');
const { ScanCommand, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { ddb } = require('../aws');

const router = express.Router();

// GET /api/robots — list all robots
router.get('/', async (req, res) => {
  try {
    const result = await ddb.send(new ScanCommand({ TableName: 'robots' }));
    res.json(result.Items || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/robots/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await ddb.send(new GetCommand({
      TableName: 'robots',
      Key: { robot_id: req.params.id },
    }));
    if (!result.Item) return res.status(404).json({ error: 'Robot not found' });
    res.json(result.Item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/robots — create a robot
router.post('/', async (req, res) => {
  try {
    const item = {
      robot_id: req.body.robot_id,
      name: req.body.name,
      iot_thing_name: req.body.iot_thing_name || '',
      kvs_channel: req.body.kvs_channel || '',
      status: 'offline',
      created_at: new Date().toISOString(),
    };
    await ddb.send(new PutCommand({ TableName: 'robots', Item: item }));
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
