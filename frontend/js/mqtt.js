// ─── MQTT Connection + Robot Status ───────────────────────────────────────────

window.setStatus = function (text, cls) {
  var el = document.getElementById('status');
  el.textContent = text;
  el.className = 'status-chip ' + cls;
};

window.connectMqtt = async function () {
  // Disconnect existing
  if (AppState.mqttClient) {
    AppState.mqttClient.end(true);
    AppState.mqttClient = null;
  }

  setStatus('Connecting...', 'pending');

  try {
    // Get SigV4-signed WSS URL from backend
    var data = await API.getMqttSignedUrl();

    AppState.mqttClient = mqtt.connect(data.url, {
      clientId: 'phone-controller-' + Math.floor(Math.random() * 10000),
      protocolVersion: 4,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    });

    AppState.mqttClient.on('connect', function () {
      setStatus('Connected \u2014 waiting for robot...', 'pending');
      document.getElementById('connect-btn').classList.add('connected');
      document.getElementById('connect-btn').textContent = 'Connected';

      unlockNav();
      goToStage('stage-control');

      AppState.mqttClient.subscribe('robot/status', { qos: 1 });
      startIoTStream();
    });

    AppState.mqttClient.on('message', function (topic, message) {
      if (topic === 'robot/video') {
        handleVideoFrame(message);
        return;
      }
      try {
        var payload = JSON.parse(message.toString());
        if (topic === 'robot/status') handleRobotStatus(payload);
      } catch (e) {
        console.error('Bad MQTT message:', e);
      }
    });

    AppState.mqttClient.on('error', function (err) {
      setStatus('MQTT error: ' + err.message, 'err');
    });

    AppState.mqttClient.on('close', function () {
      setStatus('Disconnected', 'err');
      document.getElementById('connect-btn').classList.remove('connected');
      document.getElementById('connect-btn').textContent = 'Connect';
    });

    AppState.mqttClient.on('reconnect', function () {
      setStatus('Reconnecting...', 'pending');
    });

  } catch (err) {
    setStatus('Connection failed: ' + err.message, 'err');
  }
};

// ─── Robot Status Handler ─────────────────────────────────────────────────────

window.handleRobotStatus = async function (payload) {
  AppState.currentRobotId = payload.robot_id;
  AppState.currentRobotStatus = payload.status;
  AppState.lastRobotHeartbeat = Date.now();

  var robotChip = document.getElementById('robot-indicator');
  var robotLabel = document.getElementById('info-robot');
  if (robotChip && robotLabel) {
    robotChip.classList.remove('hidden');
    robotLabel.textContent = payload.robot_id;
    if (payload.status === 'online') {
      robotChip.classList.remove('offline');
    } else {
      robotChip.classList.add('offline');
    }
  }

  updateSessionInfoBar();

  if (payload.status === 'online') {
    setStatus('Robot online', 'ok');
    if (AppState.currentUsername && !AppState.currentSessionData) {
      await autoCreateSession();
    }
  } else {
    setStatus('Robot offline', 'err');
  }
};

// ─── Auto Session Creation ────────────────────────────────────────────────────

window.autoCreateSession = async function () {
  if (!AppState.currentRobotId || !AppState.currentUsername) return;
  if (AppState.currentSessionData || AppState.sessionCreating || AppState.sessionManuallyEnded) return;
  AppState.sessionCreating = true;
  try {
    AppState.currentSessionData = await API.createSession(AppState.currentRobotId, AppState.currentUsername);
    updateSessionInfoBar();
    setStatus('Session active', 'ok');
  } catch (err) {
    setStatus('Session creation failed: ' + err.message, 'err');
  } finally {
    AppState.sessionCreating = false;
  }
};
