const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');
const config = require('./config');

let heartbeatInterval = null;

// ─── Command handler (swap this out for real motor control later) ────────────

function handleCommand(payload) {
  const action = (payload.action || 'unknown').toUpperCase();
  const speed = payload.speed != null ? payload.speed : '?';

  switch (action) {
    case 'FORWARD':
    case 'BACKWARD':
    case 'LEFT':
    case 'RIGHT':
      console.log(`[ROBOT] Driving ${action} at ${speed}% speed`);
      break;
    case 'ROTATE_CW':
      console.log(`[ROBOT] Rotating CLOCKWISE at ${speed}% speed`);
      break;
    case 'ROTATE_CCW':
      console.log(`[ROBOT] Rotating COUNTER-CLOCKWISE at ${speed}% speed`);
      break;
    case 'STOP':
      console.log(`[ROBOT] STOPPED`);
      break;
    default:
      console.log(`[ROBOT] Unknown command: ${JSON.stringify(payload)}`);
  }
}

// ─── Status publishing ──────────────────────────────────────────────────────

function publishStatus() {
  const payload = JSON.stringify({
    robot_id: config.robotId,
    status: 'online',
    timestamp: new Date().toISOString(),
  });
  client.publish(config.statusTopic, payload, { qos: 1 }, (err) => {
    if (err) console.error(`[ROBOT] Failed to publish status: ${err.message}`);
    else console.log(`[ROBOT] Published status to "${config.statusTopic}"`);
  });
}

// ─── MQTT connection ─────────────────────────────────────────────────────────

const certsDir = path.resolve(__dirname, '..', 'certs');

// Verify certificates exist before connecting
for (const file of ['device-cert.pem', 'private-key.pem', 'root-ca.pem']) {
  const filePath = path.join(certsDir, file);
  if (!fs.existsSync(filePath)) {
    console.error(`Missing certificate: ${filePath}`);
    console.error('Download your certificates from AWS IoT Console and place them in the certs/ folder.');
    process.exit(1);
  }
}

const connectUrl = `mqtts://${config.endpoint}:8883`;

console.log(`Connecting to ${config.endpoint}...`);

const client = mqtt.connect(connectUrl, {
  clientId: config.clientId,
  protocol: 'mqtts',
  cert: fs.readFileSync(path.join(certsDir, 'device-cert.pem')),
  key: fs.readFileSync(path.join(certsDir, 'private-key.pem')),
  ca: fs.readFileSync(path.join(certsDir, 'root-ca.pem')),
  reconnectPeriod: 3000,
  will: {
    topic: config.statusTopic,
    payload: JSON.stringify({ robot_id: config.robotId, status: 'offline' }),
    qos: 1,
  },
});

client.on('connect', () => {
  console.log(`[ROBOT] Connected to AWS IoT Core`);
  console.log(`[ROBOT] Subscribing to "${config.topic}"...`);

  client.subscribe(config.topic, { qos: 1 }, (err) => {
    if (err) {
      console.error(`Subscribe failed: ${err.message}`);
    } else {
      console.log(`[ROBOT] Listening for commands on "${config.topic}"\n`);
      publishStatus();
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(publishStatus, 30000);
    }
  });
});

client.on('message', (topic, message) => {
  try {
    const payload = JSON.parse(message.toString());
    handleCommand(payload);
  } catch (e) {
    console.log(`[ROBOT] Bad message on ${topic}: ${message.toString()}`);
  }
});

client.on('error', (err) => {
  console.error(`[ROBOT] MQTT error: ${err.message}`);
});

client.on('reconnect', () => {
  console.log('[ROBOT] Reconnecting...');
});

client.on('offline', () => {
  console.log('[ROBOT] Connection lost, will retry...');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[ROBOT] Shutting down...');
  client.end(false, () => process.exit(0));
});
