// ─── Face Login (camera capture + local face recognition via FaceEngine) ─────

(function () {
  var faceStream = null;
  var faceCapturedData = null;

  window.startFaceCamera = function () {
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
    }).then(function (s) {
      faceStream = s;
      var video = document.getElementById('face-login-video');
      video.srcObject = s;
      video.style.display = 'block';
      document.getElementById('face-login-placeholder').style.display = 'none';
      document.getElementById('face-login-preview').style.display = 'none';
      document.getElementById('face-camera-btn').style.display = 'none';
      document.getElementById('face-capture-btn').style.display = '';
      document.getElementById('face-reset-btn').style.display = 'none';
      document.getElementById('face-upload-label').style.display = 'none';
      document.getElementById('face-submit-btn').style.display = 'none';
      faceCapturedData = null;
    }).catch(function (e) {
      var status = document.getElementById('face-login-status');
      status.textContent = 'Camera error: ' + e.message;
      status.className = 'connect-status err';
    });
  };

  window.captureFace = function () {
    var video = document.getElementById('face-login-video');
    var canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    faceCapturedData = canvas.toDataURL('image/jpeg', 0.92);

    var preview = document.getElementById('face-login-preview');
    preview.src = faceCapturedData;
    preview.style.display = 'block';
    video.style.display = 'none';

    document.getElementById('face-capture-btn').style.display = 'none';
    document.getElementById('face-reset-btn').style.display = '';
    document.getElementById('face-submit-btn').style.display = '';

    if (faceStream) {
      faceStream.getTracks().forEach(function (t) { t.stop(); });
      faceStream = null;
    }
  };

  window.uploadFacePhoto = function (event) {
    var file = event.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      faceCapturedData = e.target.result;
      var preview = document.getElementById('face-login-preview');
      preview.src = faceCapturedData;
      preview.style.display = 'block';
      document.getElementById('face-login-video').style.display = 'none';
      document.getElementById('face-login-placeholder').style.display = 'none';
      document.getElementById('face-camera-btn').style.display = 'none';
      document.getElementById('face-capture-btn').style.display = 'none';
      document.getElementById('face-upload-label').style.display = 'none';
      document.getElementById('face-reset-btn').style.display = '';
      document.getElementById('face-submit-btn').style.display = '';
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  window.resetFaceCamera = function () {
    faceCapturedData = null;
    document.getElementById('face-login-preview').style.display = 'none';
    document.getElementById('face-login-video').style.display = 'none';
    document.getElementById('face-login-placeholder').style.display = 'flex';
    document.getElementById('face-camera-btn').style.display = '';
    document.getElementById('face-capture-btn').style.display = 'none';
    document.getElementById('face-reset-btn').style.display = 'none';
    document.getElementById('face-upload-label').style.display = '';
    document.getElementById('face-submit-btn').style.display = 'none';
    var status = document.getElementById('face-login-status');
    status.textContent = '';
    status.className = 'connect-status';
  };

  window.submitFaceLogin = async function () {
    if (!faceCapturedData) {
      var status = document.getElementById('face-login-status');
      status.textContent = 'Please capture a photo first';
      status.className = 'connect-status err';
      return;
    }

    var status = document.getElementById('face-login-status');
    var btn = document.getElementById('face-submit-btn');
    btn.disabled = true;

    try {
      // ── Local detection + feature extraction via FaceEngine ──
      status.textContent = 'Loading models...';
      status.className = 'connect-status pending';
      await FaceEngine.init();

      status.textContent = 'Detecting face...';
      var faces = await FaceEngine.detectAndExtractFromDataUrl(faceCapturedData);

      if (!faces.length) {
        status.textContent = 'No face detected';
        status.className = 'connect-status err';
        btn.disabled = false;
        return;
      }

      // ── Send feature vector to backend for matching ──
      status.textContent = 'Recognizing...';
      var user = await API.authFaceLogin(faces[0].feature);
      status.textContent = '';
      status.className = 'connect-status';
      cleanupFaceCamera();
      onAuthSuccess(user);
    } catch (err) {
      status.textContent = err.message || 'Face login failed';
      status.className = 'connect-status err';
    }
    btn.disabled = false;
  };

  window.cleanupFaceCamera = function () {
    if (faceStream) {
      faceStream.getTracks().forEach(function (t) { t.stop(); });
      faceStream = null;
    }
    faceCapturedData = null;

    // Reset UI to initial state
    var preview = document.getElementById('face-login-preview');
    if (preview) { preview.src = ''; preview.style.display = 'none'; }
    var video = document.getElementById('face-login-video');
    if (video) { video.srcObject = null; video.style.display = 'none'; }
    var placeholder = document.getElementById('face-login-placeholder');
    if (placeholder) placeholder.style.display = '';
    var cameraBtn = document.getElementById('face-camera-btn');
    if (cameraBtn) cameraBtn.style.display = '';
    var uploadLabel = document.getElementById('face-upload-label');
    if (uploadLabel) uploadLabel.style.display = '';
    var captureBtn = document.getElementById('face-capture-btn');
    if (captureBtn) captureBtn.style.display = 'none';
    var resetBtn = document.getElementById('face-reset-btn');
    if (resetBtn) resetBtn.style.display = 'none';
    var submitBtn = document.getElementById('face-submit-btn');
    if (submitBtn) submitBtn.style.display = 'none';
    var status = document.getElementById('face-login-status');
    if (status) { status.textContent = ''; status.className = 'connect-status'; }
  };
})();
