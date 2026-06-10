const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const config = require('./config');
const { handleConnection } = require('./websocket/handler');
const apiRoutes = require('./routes/api');

const app = express();
const server = http.createServer(app);

// 解析 JSON 请求体
app.use(express.json());

// CORS 头
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// 静态文件服务 - 前端页面（本地开发时可用，Render 上可选）
const webPath = path.join(__dirname, '..', 'web');
try {
  const fs = require('fs');
  if (fs.existsSync(webPath)) {
    app.use(express.static(webPath));
    console.log('[INFO] 静态文件服务已启用: ' + webPath);
  }
} catch (e) {
  console.log('[INFO] 静态文件服务未启用（前端需单独部署）');
}

// REST API 路由
app.use('/api', apiRoutes);

// 创建 WebSocket 服务
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  handleConnection(ws, req);
});

// 启动服务（Render 只需传端口号）
server.listen(config.port, () => {
  console.log(`🎮 微信小游戏后端服务已启动`);
  console.log(`   PORT:    ${config.port}`);
  console.log(`   API:     http://localhost:${config.port}/api/health`);
});

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n正在关闭服务...');
  wss.close(() => {
    server.close(() => {
      console.log('服务已关闭');
      process.exit(0);
    });
  });
});

process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});
