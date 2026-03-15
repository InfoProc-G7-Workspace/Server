// ─── Backend API Client ─────────────────────────────────────────────────────
// All AWS calls are handled by the backend. Frontend only talks to /api/*.

var API = (function () {
  var BASE = '/api';

  function authHeaders() {
    var headers = { 'Content-Type': 'application/json' };
    if (window.AppState && AppState.currentUserId) {
      headers['x-user-id'] = AppState.currentUserId;
    }
    if (window.AppState && AppState.currentUserRole) {
      headers['x-user-role'] = AppState.currentUserRole;
    }
    return headers;
  }

  async function json(url, opts) {
    opts = opts || {};
    // Merge auth headers into every request
    opts.headers = Object.assign({}, authHeaders(), opts.headers || {});
    var res = await fetch(BASE + url, opts);
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  return {
    // Users
    login: function (displayName) {
      return json('/users/login', {
        method: 'POST',
        body: JSON.stringify({ display_name: displayName }),
      });
    },
    register: function (displayName) {
      return json('/users/register', {
        method: 'POST',
        body: JSON.stringify({ display_name: displayName }),
      });
    },
    listUsers: function () {
      return json('/users');
    },
    getUser: function (userId) {
      return json('/users/' + encodeURIComponent(userId));
    },

    // MQTT
    getMqttSignedUrl: function (username) {
      var qs = username ? '?username=' + encodeURIComponent(username) : '';
      return json('/mqtt/signed-url' + qs);
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
    createSession: function (robotId, userId) {
      return json('/sessions', {
        method: 'POST',
        body: JSON.stringify({ robot_id: robotId, user_id: userId }),
      });
    },
    endSession: function (sessionId) {
      return json('/sessions/' + encodeURIComponent(sessionId) + '/end', {
        method: 'PUT',
      });
    },

    // S3 — images & scenes
    listSessionImages: function (prefix) {
      return json('/stream/images?prefix=' + encodeURIComponent(prefix));
    },
    getSceneUrl: function (key) {
      return json('/stream/scene-url?key=' + encodeURIComponent(key));
    },

    // Frame saving during recording
    saveFrame: function (sessionId, userId, frameData) {
      return json('/stream/save-frame', {
        method: 'POST',
        body: JSON.stringify({ session_id: sessionId, user_id: userId, frame_data: frameData }),
      });
    },

    // KVS
    getKvsViewerConfig: function (channel) {
      return json('/kvs/viewer-config?channel=' + encodeURIComponent(channel));
    },
  };
})();
