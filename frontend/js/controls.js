// ─── Command Publishing + D-Pad + Keyboard ───────────────────────────────────

window.sendCommand = function (action, speed) {
  var topic = 'robot/commands';
  var payload = JSON.stringify({ action: action, speed: speed });

  if (AppState.mqttClient && AppState.mqttClient.connected) {
    AppState.mqttClient.publish(topic, payload, { qos: 0 });
  }

  document.getElementById('last-cmd').textContent =
    action === 'stop' ? 'STOP' : action.toUpperCase() + ' @ ' + speed + '%';
};

// ─── Touch / Mouse / Pointer Handling ─────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  var allBtns = document.querySelectorAll('.dpad-btn, .side-btn');

  allBtns.forEach(function (btn) {
    var action = btn.dataset.action;
    if (!action) return;
    var speed = action.startsWith('rotate') ? AppState.ROTATE_SPEED : AppState.SPEED;

    function onDown(e) {
      e.preventDefault();
      btn.classList.add('pressed');
      if (action !== 'stop') {
        sendCommand(action, speed);
      } else {
        sendCommand('stop', 0);
      }
    }

    function onUp(e) {
      e.preventDefault();
      btn.classList.remove('pressed');
      if (action !== 'stop') {
        sendCommand('stop', 0);
      }
    }

    // Touch events (mobile)
    btn.addEventListener('touchstart', onDown, { passive: false });
    btn.addEventListener('touchend', onUp, { passive: false });
    btn.addEventListener('touchcancel', onUp, { passive: false });

    // Mouse events (desktop testing)
    btn.addEventListener('mousedown', onDown);
    btn.addEventListener('mouseup', onUp);
    btn.addEventListener('mouseleave', function (e) {
      if (btn.classList.contains('pressed')) onUp(e);
    });
  });
});

// ─── Keyboard Fallback (Desktop Testing) ──────────────────────────────────────

var KEY_MAP = {
  w: 'forward', s: 'backward', a: 'left', d: 'right',
  q: 'rotate_ccw', e: 'rotate_cw',
  ArrowUp: 'forward', ArrowDown: 'backward', ArrowLeft: 'left', ArrowRight: 'right',
};

document.addEventListener('keydown', function (e) {
  var action = KEY_MAP[e.key];
  if (!action || AppState.activeKeys.has(e.key)) return;
  AppState.activeKeys.add(e.key);
  var speed = action.startsWith('rotate') ? AppState.ROTATE_SPEED : AppState.SPEED;
  sendCommand(action, speed);
});

document.addEventListener('keyup', function (e) {
  if (!KEY_MAP[e.key] || !AppState.activeKeys.has(e.key)) return;
  AppState.activeKeys.delete(e.key);
  if (AppState.activeKeys.size === 0) sendCommand('stop', 0);
});
