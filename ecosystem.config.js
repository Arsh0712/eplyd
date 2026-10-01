// PM2 process definition for the EplyD control plane.
// Start with:  pm2 start ecosystem.config.js && pm2 save
// Restore on container boot with: /opt/eplyd/app/start.sh  (runs `pm2 resurrect`)
module.exports = {
  apps: [
    {
      name: 'eplyd',
      cwd: __dirname,
      script: 'apps/server/dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      // 24/7: always restart the control plane if it ever exits, with a small
      // delay and generous retry budget so a bad deploy can never take the
      // platform down for good.
      autorestart: true,
      max_restarts: 50,
      min_uptime: '10s',
      restart_delay: 3000,
      // Give bot processes up to 10s (SIGTERM) to shut down gracefully before
      // the platform itself is restarted.
      kill_timeout: 10000,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      },
      time: true
    }
  ]
};
