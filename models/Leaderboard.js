const path = require('path');
const fs = require('fs');
const config = require('../config');

// JSON 文件存储路径
const dataPath = config.dbPath.replace(/\.db$/, '.json');

// 确保数据目录存在
const dataDir = path.dirname(dataPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 读取数据
function readData() {
  try {
    if (fs.existsSync(dataPath)) {
      const raw = fs.readFileSync(dataPath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('[Leaderboard] 读取数据失败:', e.message);
  }
  return [];
}

// 写入数据
function writeData(data) {
  try {
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('[Leaderboard] 写入数据失败:', e.message);
  }
}

// 初始化：确保文件存在
if (!fs.existsSync(dataPath)) {
  writeData([]);
}

const Leaderboard = {
  // 保存一局游戏结果
  save(result) {
    const data = readData();
    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      gameType: result.gameType || 'tug-of-war',
      roomId: result.roomId || '',
      winner: result.winner || '',
      tie: result.tie ? 1 : 0,
      teamAPlayers: result.teamAPlayers || [],
      teamBPlayers: result.teamBPlayers || [],
      teamAScore: result.teamAScore || 0,
      teamBScore: result.teamBScore || 0,
      mvp: result.mvp || '',
      mvpNickName: result.mvpNickName || '',
      duration: result.duration || 0,
      createdAt: new Date().toISOString(),
    };
    data.push(record);
    writeData(data);
    return record.id;
  },

  // 获取排行榜列表
  getList(gameType, limit, offset) {
    if (gameType === undefined) gameType = 'tug-of-war';
    if (limit === undefined) limit = 50;
    if (offset === undefined) offset = 0;

    const data = readData();
    return data
      .filter(function(row) { return row.gameType === gameType; })
      .sort(function(a, b) { return b.createdAt.localeCompare(a.createdAt); })
      .slice(offset, offset + limit)
      .map(function(row) {
        return {
          id: row.id,
          winner: row.winner,
          tie: !!row.tie,
          teamAPlayers: row.teamAPlayers || [],
          teamBPlayers: row.teamBPlayers || [],
          teamAScore: row.teamAScore,
          teamBScore: row.teamBScore,
          mvp: row.mvp,
          mvpNickName: row.mvpNickName || '',
          duration: row.duration,
          createdAt: row.createdAt,
        };
      });
  },

  // 获取个人统计
  getPlayerStats(userId) {
    var data = readData();
    var totalGames = 0;
    var wins = 0;
    var mvpCount = 0;

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (row.gameType !== 'tug-of-war') continue;

      var isInTeamA = false;
      var isInTeamB = false;
      var teamAPlayers = row.teamAPlayers || [];
      var teamBPlayers = row.teamBPlayers || [];

      for (var j = 0; j < teamAPlayers.length; j++) {
        if (teamAPlayers[j].userId === userId) { isInTeamA = true; break; }
      }
      for (var k = 0; k < teamBPlayers.length; k++) {
        if (teamBPlayers[k].userId === userId) { isInTeamB = true; break; }
      }

      if (isInTeamA || isInTeamB) {
        totalGames++;
        if ((isInTeamA && row.winner === 'A') || (isInTeamB && row.winner === 'B')) {
          wins++;
        }
      }
      if (row.mvp === userId) {
        mvpCount++;
      }
    }

    return {
      totalGames: totalGames,
      wins: wins,
      mvpCount: mvpCount,
    };
  },

  close() {
    // JSON 文件不需要关闭
  },
};

module.exports = Leaderboard;