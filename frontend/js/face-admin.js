// ─── Face Admin Panel (enroll, recognize, manage, logs) ──────────────────────

(function () {
  var streams = { enroll: null, recog: null };
  var captures = { enroll: null, recog: null };

  // ── Tab Switching ──────────────────────────────────────────────────────────

  window.switchFaceTab = function (tabId, btn) {
    document.querySelectorAll('.face-tab-content').forEach(function (el) {
      el.classList.remove('active');
    });
    document.querySelectorAll('.face-tab-btn').forEach(function (el) {
      el.classList.remove('active');
    });
    document.getElementById('face-tab-' + tabId).classList.add('active');
    btn.classList.add('active');
    if (tabId === 'manage') loadFacePersons();
    if (tabId === 'logs') loadFaceLogs();
  };

  // ── Camera Operations ──────────────────────────────────────────────────────

  window.startFaceAdminCamera = function (prefix) {
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
    }).then(function (s) {
      streams[prefix] = s;
      var video = document.getElementById('fa-' + prefix + '-video');
      video.srcObject = s;
      video.style.display = 'block';
      document.getElementById('fa-' + prefix + '-placeholder').style.display = 'none';
      document.getElementById('fa-' + prefix + '-preview').style.display = 'none';
      document.getElementById('fa-' + prefix + '-cap-btn').style.display = '';
      document.getElementById('fa-' + prefix + '-reset-btn').style.display = 'none';
      captures[prefix] = null;
    }).catch(function (e) {
      alert('Camera error: ' + e.message);
    });
  };

  window.captureFaceAdmin = function (prefix) {
    var video = document.getElementById('fa-' + prefix + '-video');
    var canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    captures[prefix] = canvas.toDataURL('image/jpeg', 0.92);
    var preview = document.getElementById('fa-' + prefix + '-preview');
    preview.src = captures[prefix];
    preview.style.display = 'block';
    video.style.display = 'none';
    document.getElementById('fa-' + prefix + '-cap-btn').style.display = 'none';
    document.getElementById('fa-' + prefix + '-reset-btn').style.display = '';
    if (streams[prefix]) {
      streams[prefix].getTracks().forEach(function (t) { t.stop(); });
      streams[prefix] = null;
    }
  };

  window.uploadFaceAdmin = function (event, prefix) {
    var file = event.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      captures[prefix] = e.target.result;
      var preview = document.getElementById('fa-' + prefix + '-preview');
      preview.src = captures[prefix];
      preview.style.display = 'block';
      document.getElementById('fa-' + prefix + '-video').style.display = 'none';
      document.getElementById('fa-' + prefix + '-placeholder').style.display = 'none';
      document.getElementById('fa-' + prefix + '-cap-btn').style.display = 'none';
      document.getElementById('fa-' + prefix + '-reset-btn').style.display = '';
      if (streams[prefix]) {
        streams[prefix].getTracks().forEach(function (t) { t.stop(); });
        streams[prefix] = null;
      }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  window.resetFaceAdmin = function (prefix) {
    captures[prefix] = null;
    document.getElementById('fa-' + prefix + '-preview').style.display = 'none';
    document.getElementById('fa-' + prefix + '-video').style.display = 'none';
    document.getElementById('fa-' + prefix + '-placeholder').style.display = 'flex';
    document.getElementById('fa-' + prefix + '-cap-btn').style.display = 'none';
    document.getElementById('fa-' + prefix + '-reset-btn').style.display = 'none';
  };

  function setFaceStatus(id, msg, type) {
    var el = document.getElementById(id);
    el.textContent = msg;
    el.className = 'face-status ' + (type || '');
  }

  // ── Enroll ─────────────────────────────────────────────────────────────────

  window.submitFaceEnroll = async function () {
    var image = captures.enroll;
    var name = document.getElementById('fa-enroll-name').value.trim();
    var dept = document.getElementById('fa-enroll-dept').value.trim();
    if (!image) { setFaceStatus('fa-enroll-status', 'Please capture a photo first', 'error'); return; }
    if (!name) { setFaceStatus('fa-enroll-status', 'Please enter a name', 'error'); return; }

    var btn = document.getElementById('fa-enroll-submit');
    btn.disabled = true;
    btn.textContent = 'Enrolling...';
    try {
      var data = await API.faceEnroll(image, name, dept);
      setFaceStatus('fa-enroll-status', data.msg || 'Enrolled successfully', data.ok ? 'success' : 'error');
      if (data.ok) {
        document.getElementById('fa-enroll-name').value = '';
        document.getElementById('fa-enroll-dept').value = '';
        resetFaceAdmin('enroll');
      }
    } catch (e) {
      setFaceStatus('fa-enroll-status', e.message || 'Network error', 'error');
    }
    btn.disabled = false;
    btn.textContent = 'Enroll';
  };

  // ── Recognize ──────────────────────────────────────────────────────────────

  window.submitFaceRecognize = async function () {
    var image = captures.recog;
    if (!image) { setFaceStatus('fa-recog-status', 'Please capture a photo first', 'error'); return; }

    var btn = document.getElementById('fa-recog-submit');
    btn.disabled = true;
    btn.textContent = 'Recognizing...';
    try {
      var data = await API.faceRecognize(image);
      if (data.ok) {
        var timing = data.timing || {};
        setFaceStatus('fa-recog-status',
          data.results.join('\n') + '\n' + (timing.backend || '') + ' - ' + (timing.total_ms || 0) + 'ms',
          'success');
        var resultImg = document.getElementById('fa-recog-result-img');
        resultImg.src = data.annotated;
        document.getElementById('fa-recog-result-box').style.display = 'block';
      } else {
        setFaceStatus('fa-recog-status', data.msg || 'No match', 'error');
        document.getElementById('fa-recog-result-box').style.display = 'none';
      }
    } catch (e) {
      setFaceStatus('fa-recog-status', e.message || 'Network error', 'error');
    }
    btn.disabled = false;
    btn.textContent = 'Recognize';
  };

  // ── Person Management ──────────────────────────────────────────────────────

  window.loadFacePersons = async function () {
    var tbody = document.getElementById('fa-person-tbody');
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:16px">Loading...</td></tr>';
    try {
      var data = await API.faceListPersons();
      if (!data.ok || !data.persons || data.persons.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:16px">No data</td></tr>';
        return;
      }
      tbody.innerHTML = data.persons.map(function (p) {
        return '<tr><td>' + p.id + '</td><td>' + p.name + '</td><td>' + (p.department || '-') +
          '</td><td>' + (p.created_at || '').slice(0, 10) + '</td></tr>';
      }).join('');
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:16px">Load failed</td></tr>';
    }
  };

  window.deleteFacePerson = async function () {
    var input = document.getElementById('fa-del-id');
    var id = input.value.trim();
    if (!id || isNaN(Number(id))) {
      setFaceStatus('fa-manage-status', 'Enter a valid ID', 'error');
      return;
    }
    try {
      var data = await API.faceDeletePerson(id);
      setFaceStatus('fa-manage-status', data.msg || 'Deleted', data.ok ? 'success' : 'error');
      input.value = '';
      loadFacePersons();
    } catch (e) {
      setFaceStatus('fa-manage-status', e.message || 'Network error', 'error');
    }
  };

  // ── Login Logs ─────────────────────────────────────────────────────────────

  window.loadFaceLogs = async function () {
    var tbody = document.getElementById('fa-log-tbody');
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:16px">Loading...</td></tr>';
    try {
      var data = await API.faceGetLogs();
      if (!data.ok || !data.logs || data.logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:16px">No logs</td></tr>';
        return;
      }
      tbody.innerHTML = data.logs.map(function (l, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + l.name + '</td><td>' + l.similarity +
          '</td><td>' + (l.time || '').replace('T', ' ').slice(0, 19) + '</td></tr>';
      }).join('');
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-muted" style="text-align:center;padding:16px">Load failed</td></tr>';
    }
  };

  // ── Cleanup ────────────────────────────────────────────────────────────────

  window.cleanupFaceAdmin = function () {
    ['enroll', 'recog'].forEach(function (p) {
      if (streams[p]) {
        streams[p].getTracks().forEach(function (t) { t.stop(); });
        streams[p] = null;
      }
      captures[p] = null;
    });
  };
})();
