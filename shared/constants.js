// 共享常量
const GAME_TYPES = {
  TUG_OF_WAR: 'tug-of-war',
  REACTION: 'reaction',
  MEMORY: 'memory',
  DRAW_GUESS: 'draw-guess',
};

const TEAMS = {
  A: 'A',
  B: 'B',
  NONE: null,
};

const ROOM_STATUS = {
  WAITING: 'waiting',       // 等待玩家加入
  READY: 'ready',           // 准备阶段（所有玩家已准备）
  PLAYING: 'playing',       // 游戏进行中
  FINISHED: 'finished',     // 游戏结束
};

const GAME_STATUS = {
  WAITING: 'waiting',       // 等待开始
  COUNTDOWN: 'countdown',   // 倒计时
  PLAYING: 'playing',       // 进行中
  FINISHED: 'finished',     // 已结束
};

const PLAYER_LIMITS = {
  TUG_OF_WAR: {
    TEAM_SIZE: 5,           // 每队5人
    TOTAL: 10,              // 总共10人
  },
  REACTION: {
    TEAM_SIZE: 5,           // 每队5人
    TOTAL: 10,              // 总共10人
  },
  MEMORY: {
    TEAM_SIZE: 5,           // 每队5人
    TOTAL: 10,              // 总共10人
  },
  DRAW_GUESS: {
    TEAM_SIZE: 5,           // 每队5人
    TOTAL: 10,              // 总共10人
  },
};

const GAME_DURATION = 30;  // 游戏时长（秒）
const COUNTDOWN_SECONDS = 3;
const ROPE_THRESHOLD = 500; // 绳子偏移阈值（px），一方到达即获胜（增加阈值让游戏更持久）

module.exports = {
  GAME_TYPES,
  TEAMS,
  ROOM_STATUS,
  GAME_STATUS,
  PLAYER_LIMITS,
  GAME_DURATION,
  COUNTDOWN_SECONDS,
  ROPE_THRESHOLD,
};
