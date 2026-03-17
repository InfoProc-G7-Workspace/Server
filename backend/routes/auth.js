const express = require('express');
const crypto = require('crypto');
const { PutCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { ddb } = require('../aws');
const config = require('../config');
const { createLogger } = require('../logger');

const router = express.Router();
const log = createLogger('AUTH');

const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours

// Helper: create a server-side session and set cookie
async function createSession(res, user) {
  const sessionToken = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  log.debug(`Creating session for user="${user.display_name}" (${user.user_id}), role=${user.role}`);

  await ddb.send(new PutCommand({
    TableName: 'auth_sessions',
    Item: {
      session_token: sessionToken,
      user_id: user.user_id,
      display_name: user.display_name,
      role: user.role,
      created_at: new Date().toISOString(),
      expires_at: now + SESSION_TTL_SECONDS,
    },
  }));

  res.cookie('session_token', sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: '/',
  });

  log.info(`Session created for user="${user.display_name}", expires in ${SESSION_TTL_SECONDS}s`);

  return {
    user_id: user.user_id,
    display_name: user.display_name,
    role: user.role,
  };
}

// POST /api/auth/login — login by display name
router.post('/login', async (req, res) => {
  try {
    const { username } = req.body;
    log.info(`Login attempt for username="${username}"`);
    if (!username) {
      log.warn('Login rejected: missing username');
      return res.status(400).json({ error: 'username required' });
    }

    const result = await ddb.send(new ScanCommand({
      TableName: 'users',
      FilterExpression: 'display_name = :name',
      ExpressionAttributeValues: { ':name': username },
    }));

    const user = (result.Items || [])[0];
    if (!user) {
      log.warn(`Login failed: user "${username}" not found in DynamoDB`);
      return res.status(401).json({ error: 'User not found' });
    }

    log.info(`Login successful: user="${username}" (${user.user_id}), role=${user.role}`);
    res.json(await createSession(res, user));
  } catch (err) {
    log.error('Login error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/register — create a new user account
router.post('/register', async (req, res) => {
  try {
    const { username } = req.body;
    log.info(`Register attempt for username="${username}"`);
    if (!username) {
      log.warn('Register rejected: missing username');
      return res.status(400).json({ error: 'username required' });
    }

    // Check if user already exists
    const existing = await ddb.send(new ScanCommand({
      TableName: 'users',
      FilterExpression: 'display_name = :name',
      ExpressionAttributeValues: { ':name': username },
    }));

    if ((existing.Items || []).length > 0) {
      log.warn(`Register rejected: user "${username}" already exists`);
      return res.status(409).json({ error: 'User already exists' });
    }

    const user = {
      user_id: crypto.randomUUID(),
      display_name: username,
      role: username === config.adminUsername ? 'admin' : 'user',
      created_at: new Date().toISOString(),
    };

    await ddb.send(new PutCommand({ TableName: 'users', Item: user }));
    log.info(`User registered: "${username}" (${user.user_id}), role=${user.role}`);

    res.json(await createSession(res, user));
  } catch (err) {
    log.error('Register error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout — destroy session
router.post('/logout', async (req, res) => {
  try {
    const token = req.cookies && req.cookies.session_token;
    log.info(`Logout request, hasToken=${!!token}`);
    if (token) {
      await ddb.send(new DeleteCommand({
        TableName: 'auth_sessions',
        Key: { session_token: token },
      }));
      log.debug('Session deleted from DynamoDB');
    }

    res.clearCookie('session_token', {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      path: '/',
    });

    log.info('Logout successful');
    res.json({ ok: true });
  } catch (err) {
    log.error('Logout error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me — return current user from session
router.get('/me', (req, res) => {
  res.json(req.authUser);
});

module.exports = { router, createSession };
