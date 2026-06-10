const express = require('express');
const os = require('os');
const router = express.Router();
const Leaderboard = require('../models/Leaderboard');
const Room = require('../models/Room');

// 获取服务器局域网 IP（优先物理网卡 en0/eth0）
router.get('/server-info', (req, res) => {
  var ip = '';
  var ifaces = os.networkInterfaces();
  // 优先物理网卡
  ['en0','eth0','en1','eth1'].forEach(function(name) {
    if (ifaces[name]) {
      ifaces[name].forEach(function(iface) {
        if (iface.family === 'IPv4' && !iface.internal) { ip = iface.address; }
      });
    }
  });
  // 回退：任意非内部 IPv4
  if (!ip) {
    Object.keys(ifaces).forEach(function(name) {
      ifaces[name].forEach(function(iface) {
        if (iface.family === 'IPv4' && !iface.internal && !ip) { ip = iface.address; }
      });
    });
  }
  res.json({ success: true, data: { ip: ip || 'localhost', port: 3000 } });
});

// 健康检查
router.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 获取排行榜
router.get('/leaderboard', (req, res) => {
  const { game = 'tug-of-war', limit = 50, offset = 0 } = req.query;
  const list = Leaderboard.getList(game, parseInt(limit), parseInt(offset));
  res.json({ success: true, data: list });
});

// 获取个人统计
router.get('/leaderboard/stats', (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ success: false, message: 'userId is required' });
  }
  const stats = Leaderboard.getPlayerStats(userId);
  res.json({ success: true, data: stats });
});

// 获取单局详情
router.get('/leaderboard/:id', (req, res) => {
  const list = Leaderboard.getList('tug-of-war', 1, 0); // 简化处理
  const entry = list.find(item => item.id === parseInt(req.params.id));
  if (!entry) {
    return res.status(404).json({ success: false, message: '未找到记录' });
  }
  res.json({ success: true, data: entry });
});

module.exports = router;
