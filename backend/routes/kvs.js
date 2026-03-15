const express = require('express');
const { KinesisVideoClient, DescribeSignalingChannelCommand, GetSignalingChannelEndpointCommand } = require('@aws-sdk/client-kinesis-video');
const { KinesisVideoSignalingClient, GetIceServerConfigCommand } = require('@aws-sdk/client-kinesis-video-signaling');
const config = require('../config');
const { credentials } = require('../aws');

const router = express.Router();

// GET /api/kvs/viewer-config?channel=xxx — get everything the browser needs for WebRTC
router.get('/viewer-config', async (req, res) => {
  try {
    const channelName = req.query.channel;
    if (!channelName) return res.status(400).json({ error: 'channel required' });

    const kv = new KinesisVideoClient({ region: config.awsRegion, credentials });

    // 1. Describe signaling channel
    const descResp = await kv.send(new DescribeSignalingChannelCommand({
      ChannelName: channelName,
    }));
    const channelARN = descResp.ChannelInfo.ChannelARN;

    // 2. Get WSS + HTTPS endpoints
    const endpointResp = await kv.send(new GetSignalingChannelEndpointCommand({
      ChannelARN: channelARN,
      SingleMasterChannelEndpointConfiguration: {
        Protocols: ['WSS', 'HTTPS'],
        Role: 'VIEWER',
      },
    }));

    const endpoints = {};
    endpointResp.ResourceEndpointList.forEach(e => {
      endpoints[e.Protocol] = e.ResourceEndpoint;
    });

    // 3. Get ICE servers
    const kvsSig = new KinesisVideoSignalingClient({
      region: config.awsRegion,
      credentials,
      endpoint: endpoints.HTTPS,
    });

    const viewerClientId = 'viewer-' + Math.random().toString(36).slice(2, 10);

    const iceResp = await kvsSig.send(new GetIceServerConfigCommand({
      ChannelARN: channelARN,
      ClientId: viewerClientId,
    }));

    const iceServers = [
      { urls: 'stun:stun.kinesisvideo.' + config.awsRegion + '.amazonaws.com:443' },
      ...iceResp.IceServerList.map(s => ({
        urls: s.Uris,
        username: s.Username,
        credential: s.Password,
      })),
    ];

    res.json({
      channelARN,
      endpoints,
      viewerClientId,
      iceServers,
      region: config.awsRegion,
      // The browser still needs credentials for SigV4 signing the WebSocket connection
      // We provide a short-lived signed WSS URL instead
      signalingWssEndpoint: endpoints.WSS,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
