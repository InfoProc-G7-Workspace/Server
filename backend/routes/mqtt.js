const express = require('express');
const CryptoJS = require('crypto-js');
const config = require('../config');

const router = express.Router();

// GET /api/mqtt/signed-url — returns a SigV4-signed WSS URL for MQTT over WebSocket
router.get('/signed-url', (req, res) => {
  try {
    const host = config.iotEndpoint;
    const region = config.awsRegion;
    const accessKey = config.awsAccessKeyId;
    const secretKey = config.awsSecretAccessKey;
    const service = 'iotdevicegateway';

    const now = new Date();
    const dateStamp = now.toISOString().replace(/[-:]/g, '').slice(0, 8);
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z/, 'Z');
    const credentialScope = dateStamp + '/' + region + '/' + service + '/aws4_request';

    const params = [
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', encodeURIComponent(accessKey + '/' + credentialScope)],
      ['X-Amz-Date', amzDate],
      ['X-Amz-SignedHeaders', 'host'],
    ];
    const queryString = params.map(p => p[0] + '=' + p[1]).join('&');

    const canonicalRequest = [
      'GET', '/mqtt', queryString,
      'host:' + host, '', 'host',
      CryptoJS.SHA256('').toString(CryptoJS.enc.Hex),
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256', amzDate, credentialScope,
      CryptoJS.SHA256(canonicalRequest).toString(CryptoJS.enc.Hex),
    ].join('\n');

    let signingKey = CryptoJS.HmacSHA256(dateStamp, 'AWS4' + secretKey);
    signingKey = CryptoJS.HmacSHA256(region, signingKey);
    signingKey = CryptoJS.HmacSHA256(service, signingKey);
    signingKey = CryptoJS.HmacSHA256('aws4_request', signingKey);

    const signature = CryptoJS.HmacSHA256(stringToSign, signingKey).toString(CryptoJS.enc.Hex);
    const url = 'wss://' + host + '/mqtt?' + queryString + '&X-Amz-Signature=' + signature;

    res.json({ url, endpoint: host, region });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
