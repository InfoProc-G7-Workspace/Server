// ─── IoT Core Video Stream ─────────────────────────────────────────────────────
// Frames arrive as base64 JPEG on the robot/video MQTT topic.
// Call startIoTStream() after MQTT connects; the broker routes frames here.

// ─── Frame Recording State ────────────────────────────────────────────────────
var _lastFrameSaveTime = 0;
var FRAME_SAVE_INTERVAL_MS = 67; // ~15fps
var _streamImg = null;
var _streamPlaceholder = null;
var _streamLiveBadge = null;
var _streamFirstFrame = true;

window.handleVideoFrame = function (message) {
  if (!AppState._videoSubscribed) return;

  var base64Data = message.toString();

  if (!_streamImg) _streamImg = document.getElementById('mjpeg-stream');
  _streamImg.src = 'data:image/jpeg;base64,' + base64Data;

  if (_streamFirstFrame) {
    _streamFirstFrame = false;
    _streamImg.classList.add('active');
    if (!_streamPlaceholder) _streamPlaceholder = document.getElementById('video-placeholder');
    if (!_streamLiveBadge) _streamLiveBadge = document.getElementById('live-badge');
    if (_streamPlaceholder) _streamPlaceholder.style.display = 'none';
    if (_streamLiveBadge) _streamLiveBadge.classList.remove('hidden');
  }

  // Save frame to S3 if recording (throttled to ~15fps)
  if (AppState.isRecording && AppState.currentSessionData) {
    var now = Date.now();
    if (now - _lastFrameSaveTime >= FRAME_SAVE_INTERVAL_MS) {
      _lastFrameSaveTime = now;
      API.saveFrame(
        AppState.currentSessionData.session_id,
        base64Data
      ).catch(function (err) {
        console.error('Frame save error:', err.message);
      });
    }
  }
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
  _streamFirstFrame = true;

  var img         = _streamImg || document.getElementById('mjpeg-stream');
  var placeholder = _streamPlaceholder || document.getElementById('video-placeholder');
  var liveBadge   = _streamLiveBadge || document.getElementById('live-badge');

  if (img) {
    img.src = '';
    img.classList.remove('active');
  }
  if (placeholder) placeholder.style.display = '';
  if (liveBadge)   liveBadge.classList.add('hidden');

  _streamImg = null;
  _streamPlaceholder = null;
  _streamLiveBadge = null;
};
