// ─── Session UI ───────────────────────────────────────────────────────────────

var VIEWER_BASE_URL = 'https://marion-salad-picks-oil.trycloudflare.com';

function escapeHtml(str) {
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

window.updateSessionInfoBar = function () {
  var bar = document.getElementById('session-info');
  if (AppState.currentRobotId || AppState.currentSessionData) {
    bar.classList.remove('hidden');
    document.getElementById('info-user').textContent = AppState.currentUsername || '--';
    document.getElementById('info-session').textContent =
      AppState.currentSessionData
        ? AppState.currentSessionData.session_id.slice(0, 8) + '...'
        : '--';
    var endBtn = document.getElementById('btn-end-session');
    if (AppState.currentSessionData) {
      endBtn.classList.remove('btn-disabled');
    } else {
      endBtn.classList.add('btn-disabled');
    }
  } else {
    bar.classList.add('hidden');
  }
};

// ─── Session List ─────────────────────────────────────────────────────────────

window.refreshSessions = async function () {
  var listEl = document.getElementById('session-list');
  var isFirstLoad = !listEl.querySelector('.session-item-wrapper');
  if (isFirstLoad) {
    listEl.innerHTML = '<p class="text-warning" style="padding:8px;">Loading...</p>';
  }

  try {
    // Fetch user map and sessions in parallel
    var userMapPromise = AppState._userMap
      ? Promise.resolve()
      : API.listUsers().then(function (users) {
          AppState._userMap = {};
          (users || []).forEach(function (u) {
            AppState._userMap[u.user_id] = u.display_name;
          });
        }).catch(function () { AppState._userMap = {}; });

    var sessionsPromise = API.listSessions();
    await userMapPromise;
    var sessions = await sessionsPromise;
    if (!sessions || sessions.length === 0) {
      listEl.innerHTML = '<p class="text-muted" style="padding:8px;">No sessions found.</p>';
      return;
    }

    sessions.sort(function (a, b) {
      return (b.started_at || '').localeCompare(a.started_at || '');
    });

    var userMap = AppState._userMap || {};

    listEl.innerHTML = sessions.map(function (s) {
      var isActive = AppState.currentSessionData && s.session_id === AppState.currentSessionData.session_id;
      var shortId = escapeHtml(s.session_id.slice(0, 8));
      var status = escapeHtml(s.scene_status || 'pending');
      var date = s.started_at ? escapeHtml(new Date(s.started_at).toLocaleString()) : 'unknown';
      var ended = s.ended_at ? 'Ended' : 'Active';
      var displayName = escapeHtml(userMap[s.user_id] || AppState.currentUsername || s.user_id || '?');
      var safeId = escapeHtml(s.session_id);
      return ''
        + '<div class="session-item-wrapper" data-session-id="' + safeId + '">'
        + '<div class="session-item' + (isActive ? ' session-item--active' : '') + '">'
        + '  <div class="session-item__info">'
        + '    <div class="session-item__id">' + (s.scene_name ? escapeHtml(s.scene_name) : shortId + '...') + '</div>'
        + '    <div class="session-item__meta">' + date + ' &middot; ' + displayName + ' &middot; ' + ended + '</div>'
        + '  </div>'
        + '  <div class="session-item__actions">'
        + '    <span class="badge badge-' + status + '">' + status + '</span>'
        + '    <button class="btn-ghost btn-sm" data-view-session="' + safeId + '">View</button>'
        + '  </div>'
        + '</div>'
        + '<div class="session-inline-detail" id="detail-' + safeId + '"></div>'
        + '</div>';
    }).join('');

    // If detail view is open for a session, refresh it too
    if (AppState.viewingSessionId) {
      viewSessionDetail(AppState.viewingSessionId);
    }
  } catch (err) {
    listEl.innerHTML = '<p class="text-danger" style="padding:8px;">Error: ' + err.message + '</p>';
  }

  checkSessionPollingNeeded();
};

// ─── Session Detail + Gaussian Viewer ─────────────────────────────────────────

function collapseDetail(el, callback) {
  el.classList.remove('expanded');
  var handler = function () {
    el.removeEventListener('transitionend', handler);
    el.innerHTML = '';
    if (callback) callback();
  };
  el.addEventListener('transitionend', handler);
  // Fallback in case transitionend doesn't fire
  setTimeout(function () {
    el.removeEventListener('transitionend', handler);
    el.innerHTML = '';
    if (callback) callback();
  }, 400);
}

window.viewSessionDetail = async function (sessionId) {
  // Collapse previously expanded detail
  var previouslyOpen = document.querySelector('.session-inline-detail.expanded');
  if (previouslyOpen) {
    if (previouslyOpen.id === 'detail-' + sessionId) {
      // Toggle closed if clicking same session
      collapseDetail(previouslyOpen);
      AppState.viewingSessionId = null;
      return;
    }
    collapseDetail(previouslyOpen);
  }

  AppState.viewingSessionId = sessionId;
  var detailEl = document.getElementById('detail-' + sessionId);
  if (!detailEl) return;

  detailEl.classList.add('expanded');
  detailEl.innerHTML = '<div class="session-detail__card"><p class="text-warning">Loading...</p></div>';

  try {
    var session = await API.getSession(sessionId);
    if (!session) {
      detailEl.innerHTML = '<div class="session-detail__card"><p class="text-danger">Not found</p></div>';
      return;
    }

    var imageCount = session.image_count || 0;

    // Build scene section based on status
    var sceneSection = '';
    if (session.scene_status === 'complete' && session.scene_id) {
      var viewerUrl = VIEWER_BASE_URL + '/' + session.scene_id;
      sceneSection = ''
        + '<p><strong>Scene:</strong> <span class="badge badge-complete">complete</span></p>'
        + '<div class="gaussian-viewer">'
        + '  <iframe src="' + viewerUrl + '" allowfullscreen></iframe>'
        + '  <p><a href="' + viewerUrl + '" target="_blank">Open in new tab</a></p>'
        + '</div>';
    } else if (session.scene_status === 'processing') {
      sceneSection = '<p><strong>Scene:</strong> <span class="badge badge-processing">processing</span></p>';
    } else {
      sceneSection = '<p><strong>Scene:</strong> <span class="badge badge-pending">' + (session.scene_status || 'pending') + '</span></p>';
    }

    var userMap = AppState._userMap || {};
    var displayName = escapeHtml(userMap[session.user_id] || AppState.currentUsername || session.user_id);

    detailEl.innerHTML = ''
      + '<div class="session-detail__card">'
      + '  <h4>Session Details</h4>'
      + '  <p><strong>Scene Name:</strong> ' + escapeHtml(session.scene_name || 'N/A') + '</p>'
      + '  <p><strong>ID:</strong> ' + escapeHtml(session.session_id) + '</p>'
      + '  <p><strong>Robot:</strong> ' + escapeHtml(session.robot_id) + '</p>'
      + '  <p><strong>User:</strong> ' + displayName + '</p>'
      + '  <p><strong>Started:</strong> ' + escapeHtml(session.started_at || 'N/A') + '</p>'
      + '  <p><strong>Ended:</strong> ' + escapeHtml(session.ended_at || 'Still active') + '</p>'
      + '  <p><strong>Images:</strong> ' + imageCount + '</p>'
      + '  <p><strong>Scene ID:</strong> ' + escapeHtml(session.scene_id || 'N/A') + '</p>'
      + '  ' + sceneSection
      + '  <button class="btn-ghost btn-sm" data-close-detail="true" style="margin-top:10px;">Close</button>'
      + '</div>';
  } catch (err) {
    detailEl.innerHTML = '<div class="session-detail__card"><p class="text-danger">Error: ' + err.message + '</p></div>';
  }
};

// ─── Session Status Polling ───────────────────────────────────────────────────

window.startSessionPolling = function () {
  if (AppState.sessionPollTimer) return;
  AppState.sessionPollTimer = setInterval(function () {
    refreshSessions();
  }, 5000);
};

window.stopSessionPolling = function () {
  if (AppState.sessionPollTimer) {
    clearInterval(AppState.sessionPollTimer);
    AppState.sessionPollTimer = null;
  }
};

window.checkSessionPollingNeeded = function () {
  var activeStage = document.querySelector('.stage.active');
  var isSessionsTab = activeStage && activeStage.id === 'stage-sessions';

  if (!isSessionsTab) {
    stopSessionPolling();
    return;
  }

  var processingBadges = document.querySelectorAll('#session-list .badge-processing');
  if (processingBadges.length > 0) {
    startSessionPolling();
  } else {
    stopSessionPolling();
  }
};

// ─── End Current Session ──────────────────────────────────────────────────────

window.endCurrentSession = async function () {
  if (!AppState.currentSessionData) { setStatus('No active session', 'err'); return; }
  try {
    await API.endSession(AppState.currentSessionData.session_id);
    setStatus('Session ended', 'ok');
    AppState.currentSessionData = null;
    AppState.isRecording = false;
    AppState.sessionManuallyEnded = true;
    // Reset record button
    var btn = document.getElementById('btn-record');
    if (btn) btn.classList.remove('recording');
    var label = document.getElementById('record-label');
    if (label) label.textContent = 'Record';
    updateSessionInfoBar();
    refreshSessions();
  } catch (err) {
    setStatus('Failed to end session: ' + err.message, 'err');
  }
};

// ─── Reset Sessions Stage UI ─────────────────────────────────────────────────

window.resetSessionsStageUI = function () {
  stopSessionPolling();

  var listEl = document.getElementById('session-list');
  if (listEl) {
    listEl.innerHTML = '<p class="text-muted" style="padding:8px;">Tap Refresh to load sessions.</p>';
  }

  // Collapse any expanded inline details
  var expandedDetails = document.querySelectorAll('.session-inline-detail.expanded');
  expandedDetails.forEach(function (el) {
    el.classList.remove('expanded');
    el.innerHTML = '';
  });

  AppState._userMap = null;

  var endBtn = document.getElementById('btn-end-session');
  if (endBtn) endBtn.classList.add('btn-disabled');
};
