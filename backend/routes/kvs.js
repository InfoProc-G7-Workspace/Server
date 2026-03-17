const express = require('express');
const { KinesisVideoClient, DescribeSignalingChannelCommand, GetSignalingChannelEndpointCommand } = require('@aws-sdk/client-kinesis-video');
const { KinesisVideoSignalingClient, GetIceServerConfigCommand } = require('@aws-sdk/client-kinesis-video-signaling');
const config = require('../config');
const { credentials } = require('../aws');
const { createLogger } = require('../logger');

const router = express.Router();
const log = createLogger('KVS');

// GET /api/kvs/viewer-config?channel=xxx — get everything the browser needs for WebRTC
router.get('/viewer-config', async (req, res) => {
  try {
    const channelName = req.query.channel;
    log.info(`Viewer config request: channel=${channelName}, user="${req.authUser.display_name}"`);
    if (!channelName) {
      log.warn('Viewer config rejected: missing channel name');
      return res.status(400).json({ error: 'channel required' });
    }

    const kv = new KinesisVideoClient({ region: config.awsRegion, credentials });

    // 1. Describe signaling channel
    log.debug(`Describing signaling channel: ${channelName}`);
    const descResp = await kv.send(new DescribeSignalingChannelCommand({
      ChannelName: channelName,
    }));
    const channelARN = descResp.ChannelInfo.ChannelARN;
    log.debug(`Channel ARN: ${channelARN}`);

    // 2. Get WSS + HTTPS endpoints
    log.debug('Getting signaling channel endpoints');
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
    log.debug(`Endpoints: WSS=${endpoints.WSS ? 'ok' : 'missing'}, HTTPS=${endpoints.HTTPS ? 'ok' : 'missing'}`);

    // 3. Get ICE servers
    const kvsSig = new KinesisVideoSignalingClient({
      region: config.awsRegion,
      credentials,
      endpoint: endpoints.HTTPS,
    });

    const viewerClientId = 'viewer-' + Math.random().toString(36).slice(2, 10);

    log.debug(`Getting ICE servers for clientId=${viewerClientId}`);
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

    log.info(`Viewer config ready: channel=${channelName}, clientId=${viewerClientId}, iceServers=${iceServers.length}`);
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
    log.error(`Viewer config failed: channel=${req.query.channel}`, err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
