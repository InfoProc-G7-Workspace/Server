const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const { ddb } = require('../aws');

const PUBLIC_PATHS = ['/api/auth/login', '/api/auth/register', '/api/health'];

async function requireAuth(req, res, next) {
  if (PUBLIC_PATHS.includes(req.path)) {
    return next();
  }

  const token = req.cookies && req.cookies.session_token;
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const result = await ddb.send(new GetCommand({
      TableName: 'auth_sessions',
      Key: { session_token: token },
    }));

    if (!result.Item) {
      return res.status(401).json({ error: 'Session expired or invalid' });
    }

    if (Date.now() / 1000 > result.Item.expires_at) {
      return res.status(401).json({ error: 'Session expired' });
    }

    req.authUser = {
      user_id: result.Item.user_id,
      display_name: result.Item.display_name,
      role: result.Item.role,
    };

    next();
  } catch (err) {
    console.error('Auth middleware error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = requireAuth;
