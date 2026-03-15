const fs = require('fs');
const path = require('path');

// Load keys from ~/keys.txt
// Format: KEY=VALUE per line
function loadKeys() {
  const keysPath = path.join(process.env.HOME, 'keys.txt');
  if (!fs.existsSync(keysPath)) {
    console.error('ERROR: ~/keys.txt not found. Create it from keys.txt.example');
    process.exit(1);
  }

  const keys = {};
  const lines = fs.readFileSync(keysPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    keys[key] = value;
  }
  return keys;
}

const keys = loadKeys();

module.exports = {
  // AWS credentials
  awsAccessKeyId: keys.AWS_ACCESS_KEY_ID || '',
  awsSecretAccessKey: keys.AWS_SECRET_ACCESS_KEY || '',
  awsRegion: keys.AWS_REGION || 'eu-west-2',

  // AWS IoT Core
  iotEndpoint: keys.IOT_ENDPOINT || '',

  // S3 buckets
  imageBucket: keys.IMAGE_BUCKET || 'robot-raw-images-eu-west-2',
  sceneBucket: keys.SCENE_BUCKET || 'robot-3d-scenes-eu-west-2',

  // Server
  port: parseInt(keys.PORT, 10) || 3000,
};
