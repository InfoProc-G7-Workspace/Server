// ─── Stage Navigation ─────────────────────────────────────────────────────────

var STAGE_INDEX = {
  'stage-control': 0,
  'stage-sessions': 1,
  'stage-connect': 2,
};

window.goToStage = function (stageId) {
  var currentStage = document.querySelector('.stage.active');
  var currentIndex = currentStage ? (STAGE_INDEX[currentStage.id] || 0) : 2;
  var targetIndex = STAGE_INDEX[stageId] || 0;

  if (currentStage && currentStage.id === stageId) return;

  var goingRight = targetIndex > currentIndex;

  var stages = document.querySelectorAll('.stage');

  stages.forEach(function (s) {
    if (s.id === stageId) {
      s.classList.remove('exit-left', 'exit-right', 'enter-from-left', 'enter-from-right', 'active');
      s.classList.add(goingRight ? 'enter-from-right' : 'enter-from-left');
      void s.offsetWidth;
      s.classList.remove('enter-from-right', 'enter-from-left');
      s.classList.add('active');
    } else if (s.classList.contains('active')) {
      s.classList.remove('active', 'exit-left', 'exit-right');
      s.classList.add(goingRight ? 'exit-left' : 'exit-right');
    } else {
      s.classList.remove('active', 'exit-left', 'exit-right', 'enter-from-left', 'enter-from-right');
    }
  });

  var slider = document.getElementById('nav-slider');
  document.querySelectorAll('.nav-btn').forEach(function (btn) {
    var isActive = btn.dataset.stage === stageId;
    btn.classList.toggle('active', isActive);
    if (isActive && slider) {
      var idx = parseInt(btn.dataset.index, 10);
      slider.style.transform = 'translateX(' + (idx * 100) + '%)';
    }
  });
};

window.unlockNav = function () {
  document.querySelectorAll('.nav-btn').forEach(function (btn) {
    btn.classList.remove('nav-btn--locked');
  });
};

// ─── Connect Orchestrator ─────────────────────────────────────────────────────

window.connectAll = function () {
  var username = document.getElementById('cfg-username').value.trim();
  var connectStatus = document.getElementById('connect-status');

  if (!username) {
    connectStatus.textContent = 'Please enter your display name';
    connectStatus.className = 'connect-status err';
    return;
  }

  connectStatus.textContent = 'Connecting...';
  connectStatus.className = 'connect-status pending';

  AppState.currentUsername = username;
  AppState.sessionManuallyEnded = false;

  // Connect to MQTT via backend-signed URL
  connectMqtt();
};

// ─── DOM Event Bindings ───────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('connect-btn').addEventListener('click', connectAll);
  document.getElementById('btn-refresh-sessions').addEventListener('click', refreshSessions);
  document.getElementById('btn-end-session').addEventListener('click', endCurrentSession);

  document.querySelectorAll('.nav-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      goToStage(btn.dataset.stage);
    });
  });

  document.getElementById('session-list').addEventListener('click', function (e) {
    var target = e.target;
    if (target.dataset.viewSession) {
      viewSessionDetail(target.dataset.viewSession);
    }
  });

  document.getElementById('session-detail').addEventListener('click', function (e) {
    var target = e.target;
    if (target.dataset.closeDetail) {
      document.getElementById('session-detail').classList.remove('visible');
    }
  });
});
