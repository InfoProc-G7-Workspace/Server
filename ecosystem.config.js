module.exports = {
  apps: [
    {
      name: 'robot-cloud',
      script: 'backend/server.js',
      cwd: '/home/ubuntu/Server',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      // Log file configuration
      out_file: '/home/ubuntu/Server/logs/robot-cloud-out.log',
      error_file: '/home/ubuntu/Server/logs/robot-cloud-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'DEBUG',
      },
    },
    {
      name: 'face-service',
      script: 'app_api.py',
      interpreter: 'python3',
      cwd: '/home/ubuntu/Server/face-service',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      // Log file configuration
      out_file: '/home/ubuntu/Server/logs/face-service-out.log',
      error_file: '/home/ubuntu/Server/logs/face-service-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      merge_logs: true,
      env: {
        PYTHONUNBUFFERED: '1',
      },
    },
  ],
};
