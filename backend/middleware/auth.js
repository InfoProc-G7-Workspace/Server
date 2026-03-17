const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const { ddb } = require('../aws');
const { createLogger } = require('../logger');

const log = createLogger('AUTH-MW');

const PUBLIC_PATHS = ['/api/auth/login', '/api/auth/register', '/api/auth/face-login', '/api/health'];

async function requireAuth(req, res, next) {
  if (PUBLIC_PATHS.includes(req.path)) {
    log.debug(`Public path, skipping auth: ${req.path}`);
    return next();
  }

  const token = req.cookies && req.cookies.session_token;
  if (!token) {
    log.warn(`Unauthenticated request to ${req.method} ${req.path} (no session cookie)`);
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const result = await ddb.send(new GetCommand({
      TableName: 'auth_sessions',
      Key: { session_token: token },
    }));

    if (!result.Item) {
      log.warn(`Invalid session token for ${req.method} ${req.path} (not found in DynamoDB)`);
      return res.status(401).json({ error: 'Session expired or invalid' });
    }

    if (Date.now() / 1000 > result.Item.expires_at) {
      log.warn(`Expired session for user="${result.Item.display_name}" on ${req.method} ${req.path}`);
      return res.status(401).json({ error: 'Session expired' });
    }

    req.authUser = {
      user_id: result.Item.user_id,
      display_name: result.Item.display_name,
      role: result.Item.role,
    };

    log.debug(`Auth OK: user="${result.Item.display_name}" (${result.Item.role}) → ${req.method} ${req.path}`);
    next();
  } catch (err) {
    log.error(`Auth middleware error on ${req.method} ${req.path}`, err);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = requireAuth;
