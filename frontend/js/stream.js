// ─── IoT Core Video Stream ─────────────────────────────────────────────────────
// Frames arrive as base64 JPEG on the robot/video MQTT topic.
// Call startIoTStream() after MQTT connects; the broker routes frames here.

window.handleVideoFrame = function (message) {
  if (!AppState._videoSubscribed) return;

  var img         = document.getElementById('mjpeg-stream');
  var placeholder = document.getElementById('video-placeholder');
  var liveBadge   = document.getElementById('live-badge');

  img.src = 'data:image/jpeg;base64,' + message.toString();
  img.classList.add('active');

  if (placeholder) placeholder.style.display = 'none';
  if (liveBadge)   liveBadge.classList.remove('hidden');
};

window.startIoTStream = function () {
  if (!AppState.mqttClient || AppState._videoSubscribed) return;

  AppState.mqttClient.subscribe('robot/video', { qos: 0 });
  AppState._videoSubscribed = true;
};

window.stopIoTStream = function () {
  if (AppState.mqttClient && AppState._videoSubscribed) {
    AppState.mqttClient.unsubscribe('robot/video');
  }

  AppState._videoSubscribed = false;

  var img         = document.getElementById('mjpeg-stream');
  var placeholder = document.getElementById('video-placeholder');
  var liveBadge   = document.getElementById('live-badge');

  if (img) {
    img.src = '';
    img.classList.remove('active');
  }
  if (placeholder) placeholder.style.display = '';
  if (liveBadge)   liveBadge.classList.add('hidden');
};
