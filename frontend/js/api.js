// ─── Backend API Client ─────────────────────────────────────────────────────
// All AWS calls are handled by the backend. Frontend only talks to /api/*.

var API = (function () {
  var BASE = '/api';

  async function json(url, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    var res = await fetch(BASE + url, opts);
    if (res.status === 401 && !url.startsWith('/auth/login') && !url.startsWith('/auth/register')) {
      window.handleSessionExpired && window.handleSessionExpired();
      throw new Error('Session expired');
    }
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  return {
    // Auth
    authLogin: function (username) {
      return json('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: username }),
      });
    },
    authRegister: function (username) {
      return json('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username: username }),
      });
    },
    authLogout: function () {
      return json('/auth/logout', { method: 'POST' });
    },
    authMe: function () {
      return json('/auth/me');
    },

    // Users (admin only)
    listUsers: function () {
      return json('/users');
    },
    getUser: function (userId) {
      return json('/users/' + encodeURIComponent(userId));
    },

    // MQTT
    getMqttSignedUrl: function () {
      return json('/mqtt/signed-url');
    },

    // Robots
    listRobots: function () {
      return json('/robots');
    },
    getRobot: function (robotId) {
      return json('/robots/' + encodeURIComponent(robotId));
    },
    createRobot: function (params) {
      return json('/robots', {
        method: 'POST',
        body: JSON.stringify(params),
      });
    },

    // Sessions
    listSessions: function () {
      return json('/sessions');
    },
    getSession: function (sessionId) {
      return json('/sessions/' + encodeURIComponent(sessionId));
    },
    createSession: function (robotId, opts) {
      opts = opts || {};
      return json('/sessions', {
        method: 'POST',
        body: JSON.stringify({
          robot_id: robotId,
          scene_name: opts.scene_name || '',
          total_images: opts.total_images || 0,
          image_interval: opts.image_interval || 0,
          scan_mode: !!opts.scan_mode,
        }),
      });
    },
    endSession: function (sessionId) {
      return json('/sessions/' + encodeURIComponent(sessionId) + '/end', {
        method: 'PUT',
      });
    },

    // S3 — images & scenes
    listSessionImages: function (sessionId) {
      return json('/stream/images?session_id=' + encodeURIComponent(sessionId));
    },
    getSceneUrl: function (sessionId) {
      return json('/stream/scene-url?session_id=' + encodeURIComponent(sessionId));
    },

    // KVS
    getKvsViewerConfig: function (channel) {
      return json('/kvs/viewer-config?channel=' + encodeURIComponent(channel));
    },

    // Face recognition — browser FaceEngine extracts features, backend matches
    authFaceLogin: function (feature) {
      return json('/auth/face-login', {
        method: 'POST',
        body: JSON.stringify({ feature: feature }),
      });
    },
    faceEnroll: function (feature, name, department, imageData) {
      return json('/face/enroll', {
        method: 'POST',
        body: JSON.stringify({ feature: feature, name: name, department: department || '', image: imageData || '' }),
      });
    },
    faceRecognize: function (faces) {
      return json('/face/recognize', {
        method: 'POST',
        body: JSON.stringify({ faces: faces }),
      });
    },
    faceListPersons: function () {
      return json('/face/persons');
    },
    faceDeletePerson: function (personId) {
      return json('/face/persons/' + encodeURIComponent(personId), { method: 'DELETE' });
    },
    faceGetLogs: function () {
      return json('/face/logs');
    },
  };
})();
