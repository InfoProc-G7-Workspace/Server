const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { requestLogger, getStats, createLogger } = require('./logger');
const requireAuth = require('./middleware/auth');

const log = createLogger('SERVER');

const { router: authRouter } = require('./routes/auth');
const robotsRouter = require('./routes/robots');
const sessionsRouter = require('./routes/sessions');
const usersRouter = require('./routes/users');
const mqttRouter = require('./routes/mqtt');
const streamRouter = require('./routes/stream');
const kvsRouter = require('./routes/kvs');
const { router: faceRouter, publicRouter: facePublicRouter } = require('./routes/face');

log.info('All route modules loaded successfully');

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Log all API requests
app.use(requestLogger);

// Serve frontend static files (no auth required)
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Health check (public)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes (login is public, logout/me go through middleware)
app.use('/api/auth', authRouter);
app.use('/api/auth', facePublicRouter);

// Auth middleware — gates all routes below
app.use(requireAuth);

// Protected API routes
app.use('/api/face', faceRouter);
app.use('/api/robots', robotsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/users', usersRouter);
app.use('/api/mqtt', mqttRouter);
app.use('/api/stream', streamRouter);
app.use('/api/kvs', kvsRouter);

// Stats — active connections, request counts (now requires auth)
app.get('/api/stats', (req, res) => {
  res.json(getStats());
});

// SPA fallback — serve index.html for non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// Global error handlers for uncaught exceptions and rejections
process.on('uncaughtException', (err) => {
  log.error('UNCAUGHT EXCEPTION — process will exit', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log.error('UNHANDLED REJECTION', reason instanceof Error ? reason : new Error(String(reason)));
});

app.listen(config.port, () => {
  log.info(`Server started on http://0.0.0.0:${config.port} (NODE_ENV=${process.env.NODE_ENV || 'development'}, region=${config.awsRegion})`);
});
