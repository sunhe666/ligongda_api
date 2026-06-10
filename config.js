const path = require('path');

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',

  // 微信小游戏开发时，此处填写开发者工具中显示的 IP
  // 生产环境填写实际服务器域名
  serverUrl: process.env.SERVER_URL || 'ws://localhost:3000',

  dbPath: path.join(__dirname, 'data', 'game.db'),

  // 摇一摇参数
  shake: {
    windowMs: 1000,        // 窗口期（毫秒），每秒汇总一次
    maxPowerPerTick: 100,  // 每 tick 最大力量值
    ropeSpeedFactor: 0.5,  // 力量差转为绳子偏移的系数
  },

  // 游戏时长（秒）
  gameDuration: 30,
  countdownSeconds: 3,
};
