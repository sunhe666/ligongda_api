// WebSocket 消息协议定义
// 所有消息格式: { type: string, payload: object }

const MSG_TYPES = {
  // 客户端 → 服务器
  CREATE_ROOM: 'create_room',       // { userId, nickName, roomName, teamSize, password }
  JOIN_ROOM: 'join_room',           // { roomId, userId, nickName, password }
  LEAVE_ROOM: 'leave_room',         // { roomId, userId }
  START_GAME: 'start_game',         // { roomId } (仅执行人)
  SHAKE: 'shake',                   // { power, userId } (摇一摇力量值) - 兼容旧版
  TAP: 'tap',                       // { power, userId } (点击力量值)
  RECONNECT: 'reconnect',           // { userId, roomId } (断线重连)
  SWITCH_TEAM: 'switch_team',       // { roomId, userId, teamId } (切换队伍)
  SET_NAME: 'set_name',             // { userId, nickName } (设置昵称)
  PLAYER_READY: 'player_ready',     // { roomId, userId } (玩家准备)
  PLAYER_UNREADY: 'player_unready', // { roomId, userId } (玩家取消准备)
  MEMORY_INPUT: 'memory_input',     // { input: string } (记忆游戏输入)

  // 服务器 → 客户端
  ROOM_JOINED: 'room_joined',       // { roomId, roomName, teamSize, playerCount, players, teamAList, teamBList, hostUserId, hasPassword, readyPlayers }
  PLAYER_JOINED: 'player_joined',   // { userId, nickName, teamId }
  PLAYER_LEFT: 'player_left',       // { userId }
  ROOM_UPDATED: 'room_updated',     // { players, teamAList, teamBList, readyPlayers, canStart }
  ROOM_LIST: 'room_list',           // { rooms: [{ roomId, roomName, teamSize, playerCount }] }
  GAME_STARTING: 'game_starting',   // { countdown: 3 }
  GAME_START: 'game_start',         // { roomId } - 游戏正式开始，跳转到游戏页面
  GAME_STATE: 'game_state',         // { ropeOffset, teamAPower, teamBPower, teamAShakes, teamBShakes, timeLeft }
  GAME_OVER: 'game_over',           // { winner, scores, mvp, mvpNickName, teamAScore, teamBScore }
  LEADERBOARD: 'leaderboard',       // { rankings: [] }
  ERROR: 'error',                   // { code, message }
};

function createMessage(type, payload) {
  return JSON.stringify({ type, payload });
}

function parseMessage(data) {
  try {
    const parsed = JSON.parse(data);
    return {
      type: parsed.type,
      payload: parsed.payload || {}
    };
  } catch (e) {
    console.error('[parseMessage] Failed to parse:', data, e);
    return null;
  }
}

module.exports = { MSG_TYPES, createMessage, parseMessage };
