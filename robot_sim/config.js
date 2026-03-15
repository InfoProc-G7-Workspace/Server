const fs = require('fs');
const path = require('path');

// Load keys from ~/keys.txt
const keysPath = path.join(process.env.HOME, 'keys.txt');
const keys = {};
if (fs.existsSync(keysPath)) {
  const lines = fs.readFileSync(keysPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    keys[trimmed.slice(0, eqIndex).trim()] = trimmed.slice(eqIndex + 1).trim();
  }
}

module.exports = {
  endpoint: keys.IOT_ENDPOINT || '',
  robotId: 'robot-01',
  clientId: 'robot-sim-' + Math.floor(Math.random() * 10000),
  topic: 'robot/commands',
  statusTopic: 'robot/status',
};
