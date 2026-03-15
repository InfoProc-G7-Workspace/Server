// ─── Session UI ───────────────────────────────────────────────────────────────

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

window.refreshSessions = async function () {
  var listEl = document.getElementById('session-list');
  listEl.innerHTML = '<p class="text-warning" style="padding:8px;">Loading...</p>';

  try {
    var sessions = await API.listSessions(AppState.currentRobotId);
    if (!sessions || sessions.length === 0) {
      listEl.innerHTML = '<p class="text-muted" style="padding:8px;">No sessions found.</p>';
      return;
    }

    sessions.sort(function (a, b) {
      return (b.started_at || '').localeCompare(a.started_at || '');
    });

    listEl.innerHTML = sessions.map(function (s) {
      var isActive = AppState.currentSessionData && s.session_id === AppState.currentSessionData.session_id;
      var shortId = s.session_id.slice(0, 8);
      var status = s.scene_status || 'pending';
      var date = s.started_at ? new Date(s.started_at).toLocaleString() : 'unknown';
      var ended = s.ended_at ? 'Ended' : 'Active';
      return ''
        + '<div class="session-item' + (isActive ? ' session-item--active' : '') + '">'
        + '  <div class="session-item__info">'
        + '    <div class="session-item__id">' + shortId + '...</div>'
        + '    <div class="session-item__meta">' + date + ' &middot; ' + (s.user_id || '?') + ' &middot; ' + ended + '</div>'
        + '  </div>'
        + '  <div class="session-item__actions">'
        + '    <span class="badge badge-' + status + '">' + status + '</span>'
        + '    <button class="btn-ghost btn-sm" data-view-session="' + s.session_id + '">View</button>'
        + '  </div>'
        + '</div>';
    }).join('');
  } catch (err) {
    listEl.innerHTML = '<p class="text-danger" style="padding:8px;">Error: ' + err.message + '</p>';
  }
};

window.viewSessionDetail = async function (sessionId) {
  var detailEl = document.getElementById('session-detail');
  detailEl.classList.add('visible');
  detailEl.innerHTML = '<div class="session-detail__card"><p class="text-warning">Loading...</p></div>';

  try {
    var session = await API.getSession(sessionId);
    if (!session) {
      detailEl.innerHTML = '<div class="session-detail__card"><p class="text-danger">Not found</p></div>';
      return;
    }

    var imageCount = session.image_count || 0;
    try {
      if (session.image_s3_prefix) {
        var images = await API.listSessionImages(session.image_s3_prefix);
        imageCount = images.length;
      }
    } catch (e) { /* use DB count */ }

    var sceneLink = 'N/A';
    if (session.scene_status === 'ready' && session.scene_s3_key) {
      var sceneData = await API.getSceneUrl(session.scene_s3_key);
      sceneLink = '<a href="' + sceneData.url + '" target="_blank">Download Scene</a>';
    }

    detailEl.innerHTML = ''
      + '<div class="session-detail__card">'
      + '  <h4>Session Details</h4>'
      + '  <p><strong>ID:</strong> ' + session.session_id + '</p>'
      + '  <p><strong>Robot:</strong> ' + session.robot_id + '</p>'
      + '  <p><strong>User:</strong> ' + session.user_id + '</p>'
      + '  <p><strong>Started:</strong> ' + (session.started_at || 'N/A') + '</p>'
      + '  <p><strong>Ended:</strong> ' + (session.ended_at || 'Still active') + '</p>'
      + '  <p><strong>Images:</strong> ' + imageCount + '</p>'
      + '  <p><strong>Scene:</strong> <span class="badge badge-' + (session.scene_status || 'pending') + '">' + (session.scene_status || 'pending') + '</span></p>'
      + '  <p>' + sceneLink + '</p>'
      + '  <button class="btn-ghost btn-sm" data-close-detail="true" style="margin-top:10px;">Close</button>'
      + '</div>';
  } catch (err) {
    detailEl.innerHTML = '<div class="session-detail__card"><p class="text-danger">Error: ' + err.message + '</p></div>';
  }
};

window.endCurrentSession = async function () {
  if (!AppState.currentSessionData) { setStatus('No active session', 'err'); return; }
  try {
    await API.endSession(AppState.currentSessionData.session_id);
    setStatus('Session ended', 'ok');
    AppState.currentSessionData = null;
    AppState.sessionManuallyEnded = true;
    updateSessionInfoBar();
    refreshSessions();
  } catch (err) {
    setStatus('Failed to end session: ' + err.message, 'err');
  }
};
