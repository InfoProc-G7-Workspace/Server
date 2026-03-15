// ─── Fake Gaussian Processor ─────────────────────────────────────────────────
// Standalone polling script — runs on a separate device (like robot_sim/).
// Polls DynamoDB for sessions with scene_status='processing', simulates
// Gaussian splatting, then marks them 'complete' with a viewer URL.
//
// Usage: node gaussian_proc_sim/processor.js

const path = require('path');

// Resolve modules from the backend's node_modules
const backendDir = path.join(__dirname, '..', 'backend');
const { ScanCommand, UpdateCommand } = require(path.join(backendDir, 'node_modules', '@aws-sdk', 'lib-dynamodb'));
const { ddb } = require(path.join(backendDir, 'aws'));

const POLL_INTERVAL_MS = 10000; // 10 seconds
const PROCESSING_DELAY_MS = 15000; // 15 seconds simulated processing
const VIEWER_BASE_URL = 'https://marion-salad-picks-oil.trycloudflare.com';

// Track sessions currently being processed to avoid double-processing
const processing = new Set();

function log(msg) {
  console.log(`[${new Date().toISOString()}] PROCESSOR: ${msg}`);
}

async function pollForWork() {
  try {
    const result = await ddb.send(new ScanCommand({
      TableName: 'sessions',
      FilterExpression: 'scene_status = :s',
      ExpressionAttributeValues: { ':s': 'processing' },
    }));

    const sessions = result.Items || [];

    for (const session of sessions) {
      if (processing.has(session.session_id)) continue; // already working on it

      processing.add(session.session_id);

      log(`Found session ${session.session_id} to process`);
      log(`  Scene ID: ${session.scene_id}`);
      log(`  Image S3 prefix: ${session.image_s3_prefix}`);
      log(`  Image count: ${session.image_count || 0}`);
      log(`  Simulating Gaussian splatting (${PROCESSING_DELAY_MS / 1000}s)...`);

      // Simulate processing delay
      setTimeout(async () => {
        try {
          await ddb.send(new UpdateCommand({
            TableName: 'sessions',
            Key: { session_id: session.session_id },
            UpdateExpression: 'SET scene_status = :s',
            ExpressionAttributeValues: { ':s': 'complete' },
          }));

          const viewerUrl = `${VIEWER_BASE_URL}/${session.scene_id}`;
          log(`Session ${session.session_id} complete`);
          log(`  Viewer URL: ${viewerUrl}`);
        } catch (err) {
          log(`ERROR processing session ${session.session_id}: ${err.message}`);
        } finally {
          processing.delete(session.session_id);
        }
      }, PROCESSING_DELAY_MS);
    }
  } catch (err) {
    log(`Poll error: ${err.message}`);
  }
}

// ─── Main Loop ───────────────────────────────────────────────────────────────

log('Gaussian Processor Simulator started');
log(`Polling every ${POLL_INTERVAL_MS / 1000}s for sessions with scene_status="processing"`);
log(`Processing delay: ${PROCESSING_DELAY_MS / 1000}s per session`);
log(`Viewer base URL: ${VIEWER_BASE_URL}`);
log('---');

// Initial poll
pollForWork();

// Continuous polling
setInterval(pollForWork, POLL_INTERVAL_MS);
