const express = require('express');
const path = require('path');
const config = require('./config');
const { requestLogger, getStats } = require('./logger');

const robotsRouter = require('./routes/robots');
const sessionsRouter = require('./routes/sessions');
const mqttRouter = require('./routes/mqtt');
const streamRouter = require('./routes/stream');
const kvsRouter = require('./routes/kvs');

const app = express();
app.use(express.json());

// Log all API requests
app.use(requestLogger);

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// API routes
app.use('/api/robots', robotsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/mqtt', mqttRouter);
app.use('/api/stream', streamRouter);
app.use('/api/kvs', kvsRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Stats — active connections, request counts
app.get('/api/stats', (req, res) => {
  res.json(getStats());
});

// SPA fallback — serve index.html for non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.listen(config.port, () => {
  console.log(`[${new Date().toISOString()}] Server running on http://0.0.0.0:${config.port}`);
});
