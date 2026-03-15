module.exports = {
  apps: [{
    name: 'robot-cloud',
    script: 'backend/server.js',
    cwd: '/home/ubuntu/Server',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '256M',
    env: {
      NODE_ENV: 'production',
    },
  }],
};
