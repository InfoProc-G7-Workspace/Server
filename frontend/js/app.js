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

  // Manage session polling based on active tab
  if (stageId === 'stage-sessions') {
    refreshSessions();
  } else {
    stopSessionPolling();
  }

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

window.lockNav = function () {
  document.querySelectorAll('.nav-btn').forEach(function (btn) {
    if (btn.dataset.stage !== 'stage-connect') {
      btn.classList.add('nav-btn--locked');
    }
  });
};

// ─── Login/Logout Card Toggle ────────────────────────────────────────────────

function showLoginForm() {
  var loginCard = document.getElementById('login-card');
  var loggedInCard = document.getElementById('logged-in-card');
  var subtitle = document.getElementById('connect-subtitle');
  var usernameInput = document.getElementById('cfg-username');
  var connectStatus = document.getElementById('connect-status');

  if (loginCard) loginCard.classList.remove('hidden');
  if (loggedInCard) loggedInCard.classList.add('hidden');
  if (subtitle) subtitle.textContent = 'Enter your display name to get started';
  if (usernameInput) usernameInput.value = '';
  if (connectStatus) {
    connectStatus.textContent = '';
    connectStatus.className = 'connect-status';
  }
}

function showLoggedInCard(username) {
  var loginCard = document.getElementById('login-card');
  var loggedInCard = document.getElementById('logged-in-card');
  var loggedInName = document.getElementById('logged-in-username');
  var subtitle = document.getElementById('connect-subtitle');
  var connectStatus = document.getElementById('connect-status');

  if (loginCard) loginCard.classList.add('hidden');
  if (loggedInCard) loggedInCard.classList.remove('hidden');
  if (loggedInName) loggedInName.textContent = username;
  if (subtitle) subtitle.textContent = 'Connected to Robot Controller';
  if (connectStatus) {
    connectStatus.textContent = '';
    connectStatus.className = 'connect-status';
  }
}

// ─── UI Reset Helpers ────────────────────────────────────────────────────────

function resetControlStageUI() {
  var statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.textContent = 'Connecting...';
    statusEl.className = 'status-chip pending';
  }

  var robotChip = document.getElementById('robot-indicator');
  if (robotChip) robotChip.classList.add('hidden');
  var robotLabel = document.getElementById('info-robot');
  if (robotLabel) robotLabel.textContent = '--';

  var sessionBar = document.getElementById('session-info');
  if (sessionBar) sessionBar.classList.add('hidden');
  var infoUser = document.getElementById('info-user');
  if (infoUser) infoUser.textContent = '--';
  var infoSession = document.getElementById('info-session');
  if (infoSession) infoSession.textContent = '--';

  var recordBtn = document.getElementById('btn-record');
  if (recordBtn) {
    recordBtn.classList.remove('recording');
    recordBtn.disabled = true;
  }
  var recordLabel = document.getElementById('record-label');
  if (recordLabel) recordLabel.textContent = 'Record';

  var lastCmd = document.getElementById('last-cmd');
  if (lastCmd) lastCmd.textContent = 'Tap a button to send a command';

  var loginBtn = document.getElementById('login-btn');
  if (loginBtn) {
    loginBtn.classList.remove('connected');
    loginBtn.textContent = 'Login';
  }
  var createBtn = document.getElementById('create-user-btn');
  if (createBtn) {
    createBtn.classList.remove('connected');
    createBtn.textContent = 'Create User';
  }
}

// ─── Logout ──────────────────────────────────────────────────────────────────

window.logoutUser = async function () {
  // End active recording if exists
  if (AppState.isRecording && AppState.currentSessionData) {
    try {
      await API.endSession(AppState.currentSessionData.session_id);
    } catch (err) {
      console.error('Failed to end session during logout:', err.message);
    }
  }

  // Stop video stream (resets _videoSubscribed flag)
  stopIoTStream();

  // Disconnect MQTT cleanly
  disconnectMqtt();

  // Reset AppState (skip SPEED / ROTATE_SPEED — config constants)
  AppState.mqttClient = null;
  AppState.currentRobotId = null;
  AppState.currentRobotStatus = 'unknown';
  AppState.lastRobotHeartbeat = null;
  AppState.currentSessionData = null;
  AppState.currentUsername = null;
  AppState.currentUserId = null;
  AppState.currentUserRole = null;
  AppState.isRecording = false;
  AppState.sessionCreating = false;
  AppState.sessionManuallyEnded = false;
  AppState.activeKeys = new Set();
  AppState._videoSubscribed = false;
  AppState.sessionPollTimer = null;
  AppState.viewingSessionId = null;

  // Reset UI
  resetControlStageUI();
  resetSessionsStageUI();

  // Lock nav and show login form
  lockNav();
  showLoginForm();
  goToStage('stage-connect');
};

// ─── Post-Login Flow (shared by login and create user) ───────────────────────

function onAuthSuccess(user) {
  AppState.currentUserId = user.user_id;
  AppState.currentUsername = user.display_name;
  AppState.currentUserRole = user.role;
  AppState.sessionManuallyEnded = false;

  showLoggedInCard(user.display_name);

  // Unlock nav and go to control stage immediately after login
  unlockNav();
  goToStage('stage-control');

  // Connect MQTT in the background
  connectMqtt();
}

// ─── Login ───────────────────────────────────────────────────────────────────

window.loginUser = async function () {
  var username = document.getElementById('cfg-username').value.trim();
  var connectStatus = document.getElementById('connect-status');

  if (!username) {
    connectStatus.textContent = 'Please enter your display name';
    connectStatus.className = 'connect-status err';
    return;
  }

  connectStatus.textContent = 'Logging in...';
  connectStatus.className = 'connect-status pending';

  try {
    var user = await API.login(username);
    onAuthSuccess(user);
  } catch (err) {
    connectStatus.textContent = err.message || 'Login failed';
    connectStatus.className = 'connect-status err';
  }
};

// ─── Create User ─────────────────────────────────────────────────────────────

window.createUser = async function () {
  var username = document.getElementById('cfg-username').value.trim();
  var connectStatus = document.getElementById('connect-status');

  if (!username) {
    connectStatus.textContent = 'Please enter a display name';
    connectStatus.className = 'connect-status err';
    return;
  }

  connectStatus.textContent = 'Creating user...';
  connectStatus.className = 'connect-status pending';

  try {
    var user = await API.register(username);
    onAuthSuccess(user);
  } catch (err) {
    connectStatus.textContent = err.message || 'Registration failed';
    connectStatus.className = 'connect-status err';
  }
};

// ─── DOM Event Bindings ───────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  document.getElementById('login-btn').addEventListener('click', loginUser);
  document.getElementById('create-user-btn').addEventListener('click', createUser);
  document.getElementById('btn-refresh-sessions').addEventListener('click', refreshSessions);
  document.getElementById('btn-end-session').addEventListener('click', endCurrentSession);
  document.getElementById('btn-record').addEventListener('click', toggleRecording);
  document.getElementById('logout-btn').addEventListener('click', logoutUser);

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
    if (target.dataset.closeDetail) {
      var wrapper = target.closest('.session-inline-detail');
      if (wrapper) {
        wrapper.classList.remove('expanded');
        wrapper.innerHTML = '';
      }
      AppState.viewingSessionId = null;
    }
  });
});
