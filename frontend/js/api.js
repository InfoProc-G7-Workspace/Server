// ─── Backend API Client ─────────────────────────────────────────────────────
// All AWS calls are handled by the backend. Frontend only talks to /api/*.

var API = (function () {
  var BASE = '/api';

  async function json(url, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    var res = await fetch(BASE + url, opts);
    if (res.status === 401) {
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
    createSession: function (robotId) {
      return json('/sessions', {
        method: 'POST',
        body: JSON.stringify({ robot_id: robotId }),
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

    // Frame saving during recording
    saveFrame: function (sessionId, frameData) {
      return json('/stream/save-frame', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId, frame_data: frameData }),
      });
    },

    // KVS
    getKvsViewerConfig: function (channel) {
      return json('/kvs/viewer-config?channel=' + encodeURIComponent(channel));
    },
  };
})();
