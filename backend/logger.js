const fs = require('fs');
const path = require('path');

// ─── In-memory stats ──────────────────────────────────────────────────────────

const stats = {
  startedAt: new Date().toISOString(),
  totalRequests: 0,
  // IP → { firstSeen, lastSeen, requests, username, connected }
  connections: new Map(),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getClientIp(req) {
  return req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
}

function ts() {
  return new Date().toISOString();
}

// ─── Request logging middleware ───────────────────────────────────────────────

function requestLogger(req, res, next) {
  // Skip static file requests
  if (!req.path.startsWith('/api/')) return next();

  stats.totalRequests++;
  const ip = getClientIp(req);
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    console.log(`[${ts()}] ${req.method} ${req.path} ${status} ${duration}ms ← ${ip}`);
  });

  next();
}

// ─── Connection tracker ───────────────────────────────────────────────────────

function trackConnection(req, username) {
  const ip = getClientIp(req);
  const now = ts();

  if (stats.connections.has(ip)) {
    const conn = stats.connections.get(ip);
    conn.lastSeen = now;
    conn.requests++;
    conn.connected = true;
    if (username) conn.username = username;
  } else {
    stats.connections.set(ip, {
      ip,
      firstSeen: now,
      lastSeen: now,
      requests: 1,
      username: username || null,
      connected: true,
    });
  }

  console.log(`[${now}] CONNECT ${ip}${username ? ' (' + username + ')' : ''} — total active: ${getActiveCount()}`);
}

function trackApiCall(req) {
  const ip = getClientIp(req);
  if (stats.connections.has(ip)) {
    const conn = stats.connections.get(ip);
    conn.lastSeen = ts();
    conn.requests++;
  }
}

// Consider a user inactive if no request in 5 minutes
function getActiveCount() {
  const threshold = Date.now() - 5 * 60 * 1000;
  let count = 0;
  for (const [, conn] of stats.connections) {
    if (new Date(conn.lastSeen).getTime() > threshold) count++;
  }
  return count;
}

function getStats() {
  const threshold = Date.now() - 5 * 60 * 1000;
  const active = [];
  const inactive = [];

  for (const [, conn] of stats.connections) {
    if (new Date(conn.lastSeen).getTime() > threshold) {
      active.push(conn);
    } else {
      inactive.push(conn);
    }
  }

  return {
    serverStartedAt: stats.startedAt,
    totalRequests: stats.totalRequests,
    activeUsers: active.length,
    totalUsersEver: stats.connections.size,
    active,
    recentInactive: inactive.slice(-10),
  };
}

module.exports = { requestLogger, trackConnection, trackApiCall, getStats, getClientIp };
