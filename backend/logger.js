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

// ─── Structured logger ───────────────────────────────────────────────────────

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const currentLevel = LOG_LEVELS[process.env.LOG_LEVEL || 'ERROR'];

function formatLog(level, tag, message, extra) {
  const base = `[${ts()}] [${level}] [${tag}] ${message}`;
  if (extra !== undefined) {
    const detail = extra instanceof Error
      ? `${extra.message}\n${extra.stack}`
      : (typeof extra === 'object' ? JSON.stringify(extra) : String(extra));
    return `${base} | ${detail}`;
  }
  return base;
}

function createLogger(tag) {
  return {
    debug(msg, extra) { if (currentLevel <= LOG_LEVELS.DEBUG) console.log(formatLog('DEBUG', tag, msg, extra)); },
    info(msg, extra)  { if (currentLevel <= LOG_LEVELS.INFO)  console.log(formatLog('INFO',  tag, msg, extra)); },
    warn(msg, extra)  { if (currentLevel <= LOG_LEVELS.WARN)  console.warn(formatLog('WARN',  tag, msg, extra)); },
    error(msg, extra) { if (currentLevel <= LOG_LEVELS.ERROR) console.error(formatLog('ERROR', tag, msg, extra)); },
  };
}

const reqLog = createLogger('HTTP');

// ─── Request logging middleware ───────────────────────────────────────────────

function requestLogger(req, res, next) {
  // Skip static file requests
  if (!req.path.startsWith('/api/')) return next();

  stats.totalRequests++;
  const ip = getClientIp(req);
  const start = Date.now();

  reqLog.debug(`→ ${req.method} ${req.path}`, {
    ip,
    query: Object.keys(req.query).length ? req.query : undefined,
    contentLength: req.headers['content-length'],
    userAgent: req.headers['user-agent'],
  });

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    reqLog[level](`← ${req.method} ${req.path} ${status} ${duration}ms ← ${ip}`);
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

  if (currentLevel < LOG_LEVELS.OFF) {
    console.log(`[${now}] CONNECT ${ip}${username ? ' (' + username + ')' : ''} — total active: ${getActiveCount()}`);
  }
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

module.exports = { requestLogger, trackConnection, trackApiCall, getStats, getClientIp, createLogger };
