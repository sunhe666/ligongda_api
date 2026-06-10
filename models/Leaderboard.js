const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// 确保数据目录存在
const dataDir = path.dirname(config.dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(config.dbPath);

// 初始化表结构
db.exec(`
  CREATE TABLE IF NOT EXISTS leaderboard (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_type TEXT NOT NULL,
    room_id TEXT NOT NULL,
    winner TEXT,
    tie INTEGER DEFAULT 0,
    team_a_players TEXT NOT NULL DEFAULT '[]',
    team_b_players TEXT NOT NULL DEFAULT '[]',
    team_a_score INTEGER DEFAULT 0,
    team_b_score INTEGER DEFAULT 0,
    mvp_user_id TEXT,
    mvp_nick_name TEXT DEFAULT '',
    duration INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_leaderboard_game_type
    ON leaderboard(game_type, created_at DESC);
`);

const Leaderboard = {
  // 保存一局游戏结果
  save(result) {
    const stmt = db.prepare(`
      INSERT INTO leaderboard
        (game_type, room_id, winner, tie, team_a_players, team_b_players,
         team_a_score, team_b_score, mvp_user_id, mvp_nick_name, duration)
      VALUES (@gameType, @roomId, @winner, @tie, @teamAPlayers, @teamBPlayers,
              @teamAScore, @teamBScore, @mvp, @mvpNickName, @duration)
    `);

    const info = stmt.run({
      gameType: 'tug-of-war',
      roomId: result.roomId || '',
      winner: result.winner || '',
      tie: result.tie ? 1 : 0,
      teamAPlayers: JSON.stringify(result.teamAPlayers || []),
      teamBPlayers: JSON.stringify(result.teamBPlayers || []),
      teamAScore: result.teamAScore || 0,
      teamBScore: result.teamBScore || 0,
      mvp: result.mvp || '',
      mvpNickName: result.mvpNickName || '',
      duration: result.duration || 0,
    });

    return info.lastInsertRowid;
  },

  // 获取排行榜列表
  getList(gameType = 'tug-of-war', limit = 50, offset = 0) {
    const stmt = db.prepare(`
      SELECT * FROM leaderboard
      WHERE game_type = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    const rows = stmt.all(gameType, limit, offset);

    return rows.map(row => ({
      id: row.id,
      winner: row.winner,
      tie: !!row.tie,
      teamAPlayers: JSON.parse(row.team_a_players || '[]'),
      teamBPlayers: JSON.parse(row.team_b_players || '[]'),
      teamAScore: row.team_a_score,
      teamBScore: row.team_b_score,
      mvp: row.mvp_user_id,
      mvpNickName: row.mvp_nick_name,
      duration: row.duration,
      createdAt: row.created_at,
    }));
  },

  // 获取个人统计
  getPlayerStats(userId) {
    const stmt = db.prepare(`
      SELECT
        COUNT(*) as totalGames,
        SUM(CASE WHEN winner = 'A' AND team_a_players LIKE ? THEN 1
                 WHEN winner = 'B' AND team_b_players LIKE ? THEN 1
                 ELSE 0 END) as wins,
        SUM(CASE WHEN mvp_user_id = ? THEN 1 ELSE 0 END) as mvpCount
      FROM leaderboard
      WHERE (team_a_players LIKE ? OR team_b_players LIKE ?)
        AND game_type = 'tug-of-war'
    `);

    const pattern = `%"${userId}"%`;
    const row = stmt.get(pattern, pattern, userId, pattern, pattern);

    return {
      totalGames: row.totalGames || 0,
      wins: row.wins || 0,
      mvpCount: row.mvpCount || 0,
    };
  },

  close() {
    db.close();
  },
};

module.exports = Leaderboard;
