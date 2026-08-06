require('dotenv').config({ override: true });

function env(name, fallback = '') {
  const value = process.env[name];
  if (value == null) return fallback;
  return String(value).trim();
}

const config = {
  port: parseInt(env('PORT', '4000'), 10),
  mongodbUri: env('MONGODB_URI', 'mongodb://localhost:27017/ai-engineering-manager'),
  redisUrl: env('REDIS_URL', 'redis://localhost:6379'),
  nodeEnv: env('NODE_ENV', 'development'),
  timezone: env('TZ', 'Asia/Kolkata'),
  slack: {
    botToken: env('SLACK_BOT_TOKEN'),
    signingSecret: env('SLACK_SIGNING_SECRET'),
    appToken: env('SLACK_APP_TOKEN'),
    socketMode: env('SLACK_SOCKET_MODE', 'true') !== 'false',
  },
  openai: {
    apiKey: env('OPENAI_API_KEY'),
    model: env('OPENAI_MODEL', 'gpt-4o-mini'),
  },
  reminderIntervalMs: parseInt(env('REMINDER_INTERVAL_MS', '3600000'), 10),
  corsOrigin: env('FRONTEND_URL', 'http://localhost:4200'),
  jwtSecret: env('JWT_SECRET', 'change-me-in-production'),
  similarityThreshold: 0.9,
  confidenceFloor: 0.7,
};

module.exports = config;
