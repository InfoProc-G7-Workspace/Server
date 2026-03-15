// ─── Backend API Client ─────────────────────────────────────────────────────
// All AWS calls are handled by the backend. Frontend only talks to /api/*.

var API = (function () {
  var BASE = '/api';

  async function json(url, opts) {
    var res = await fetch(BASE + url, opts);
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  return {
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
    },

    // Sessions
    listSessions: function (robotId) {
      var qs = robotId ? '?robot_id=' + encodeURIComponent(robotId) : '';
      return json('/sessions' + qs);
    },
    getSession: function (sessionId) {
      return json('/sessions/' + encodeURIComponent(sessionId));
    },
    createSession: function (robotId, userId) {
      return json('/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

    // KVS
    getKvsViewerConfig: function (channel) {
      return json('/kvs/viewer-config?channel=' + encodeURIComponent(channel));
    },
  };
})();
