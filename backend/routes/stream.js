const express = require('express');
const { ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3 } = require('../aws');
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

module.exports = router;
