// ─── FLIR Scanner Control ──────────────────────────────────────────────────────

var _scanTimeoutId = null;

window.updateScanButton = function () {
  var enabled = AppState.currentRobotId && AppState.currentRobotStatus === 'online';
  var btn = document.getElementById('btn-scan');
  if (btn) btn.disabled = !enabled;
  var mobileBtn = document.getElementById('btn-scan-mobile');
  if (mobileBtn) mobileBtn.disabled = !enabled;
};

window.toggleScanPanel = function () {
  if (AppState.isScanning) return; // don't toggle during a scan
  var panel = document.getElementById('scan-panel');
  if (panel) panel.classList.toggle('expanded');
};

window.startScan = async function () {
  if (AppState.isScanning) return;

  var sceneName = document.getElementById('scan-scene-name').value.trim();
  var totalImages = parseInt(document.getElementById('scan-total-images').value, 10);
  var interval = parseInt(document.getElementById('scan-interval').value, 10);

  if (!sceneName) { setStatus('Enter a scene name', 'err'); return; }
  if (!totalImages || totalImages < 1) { setStatus('Invalid image count', 'err'); return; }
  if (!interval || interval < 1) { setStatus('Invalid interval', 'err'); return; }

  if (!AppState.currentRobotId || !AppState.currentUserId) {
    setStatus('No robot connected', 'err');
    return;
  }

  // Create session via backend API
  try {
    AppState.currentSessionData = await API.createSession(
      AppState.currentRobotId,
      { scene_name: sceneName, total_images: totalImages, image_interval: interval, scan_mode: true }
    );
  } catch (err) {
    setStatus('Failed to create scan session: ' + err.message, 'err');
    return;
  }

  // Subscribe to scan status topic
  if (AppState.mqttClient) {
    AppState.mqttClient.subscribe('robot/scan/status', { qos: 1 });
  }

  // Publish scan command to robot via MQTT
  var scanCommand = {
    action: 'start_scan',
    scene_id: AppState.currentSessionData.scene_id,
    scene_name: sceneName,
    image_s3_prefix: AppState.currentSessionData.image_s3_prefix,
    total_images: totalImages,
    image_interval: interval,
  };

  AppState.mqttClient.publish('robot/scan', JSON.stringify(scanCommand), { qos: 1 });

  // Update UI — show progress, hide form
  AppState.isScanning = true;
  var formEl = document.getElementById('scan-form');
  if (formEl) formEl.classList.add('hidden');
  var progressEl = document.getElementById('scan-progress');
  if (progressEl) progressEl.classList.remove('hidden');
  updateScanProgress(0, totalImages);

  var scanBtn = document.getElementById('btn-scan');
  if (scanBtn) scanBtn.classList.add('scanning');
  var mobileBtn = document.getElementById('btn-scan-mobile');
  if (mobileBtn) mobileBtn.classList.add('scanning');

  setStatus('Scan started: ' + sceneName, 'ok');
  updateSessionInfoBar();

  // Safety timeout: (total_images * interval) + 10 seconds
  var timeoutMs = ((totalImages * interval) + 10) * 1000;
  _scanTimeoutId = setTimeout(function () {
    if (AppState.isScanning) {
      console.warn('[SCAN] Safety timeout reached — auto-ending session');
      finishScan(true);
    }
  }, timeoutMs);
};

window.handleScanStatus = function (payload) {
  // Only handle status for the current scan
  if (!AppState.currentSessionData) return;
  if (payload.scene_id !== AppState.currentSessionData.scene_id) return;

  if (payload.status === 'capturing') {
    updateScanProgress(payload.current_image, payload.total_images);
  } else if (payload.status === 'complete') {
    finishScan(false);
  } else if (payload.status === 'error') {
    setStatus('Scan error: ' + (payload.message || 'unknown'), 'err');
    finishScan(false);
  }
};

function updateScanProgress(current, total) {
  var fill = document.getElementById('scan-progress-fill');
  var text = document.getElementById('scan-progress-text');
  if (fill) {
    var pct = total > 0 ? Math.round((current / total) * 100) : 0;
    fill.style.width = pct + '%';
  }
  if (text) text.textContent = current + ' / ' + total;
}

function finishScan(timedOut) {
  // Clear safety timeout
  if (_scanTimeoutId) {
    clearTimeout(_scanTimeoutId);
    _scanTimeoutId = null;
  }

  // Auto-end the session
  if (AppState.currentSessionData) {
    API.endSession(AppState.currentSessionData.session_id).then(function () {
      if (timedOut) {
        setStatus('Scan timed out — session ended', 'err');
      } else {
        setStatus('Scan complete — processing...', 'ok');
      }
    }).catch(function (err) {
      setStatus('Failed to end session: ' + err.message, 'err');
    });
  }

  AppState.isScanning = false;
  AppState.currentSessionData = null;

  // Unsubscribe from scan status
  if (AppState.mqttClient) {
    try { AppState.mqttClient.unsubscribe('robot/scan/status'); } catch (e) {}
  }

  resetScanUI();
  updateSessionInfoBar();
}

window.resetScanUI = function () {
  var formEl = document.getElementById('scan-form');
  if (formEl) formEl.classList.remove('hidden');

  var progressEl = document.getElementById('scan-progress');
  if (progressEl) progressEl.classList.add('hidden');

  var fill = document.getElementById('scan-progress-fill');
  if (fill) fill.style.width = '0%';

  var text = document.getElementById('scan-progress-text');
  if (text) text.textContent = '0 / 0';

  var scanBtn = document.getElementById('btn-scan');
  if (scanBtn) scanBtn.classList.remove('scanning');
  var mobileBtn = document.getElementById('btn-scan-mobile');
  if (mobileBtn) mobileBtn.classList.remove('scanning');

  if (_scanTimeoutId) {
    clearTimeout(_scanTimeoutId);
    _scanTimeoutId = null;
  }
};
