const { MSG_TYPES, createMessage, parseMessage } = require('../../shared/protocol');
const { TEAMS, ROOM_STATUS, GAME_TYPES } = require('../../shared/constants');
const Room = require('../models/Room');
const TugOfWarGame = require('./games/tug-of-war');
const ReactionGame = require('./games/reaction');
const MemoryGame = require('./games/memory');
const DrawGuessGame = require('./games/draw-guess');

// 连接池: ws => { userId, roomId }
const connections = new Map();
// 断线待重连: userId => { roomId, timeout }
const pendingReconnect = new Map();

function handleConnection(ws, req) {
  const conn = { ws, userId: null, roomId: null };
  connections.set(ws, conn);

  ws.on('message', (data) => {
    const msg = parseMessage(data);
    if (!msg || !msg.type) return;
    handleMessage(ws, conn, msg.type, msg.payload || {});
  });

  ws.on('close', () => {
    handleDisconnect(ws, conn);
  });

  ws.on('error', () => {
    handleDisconnect(ws, conn);
  });

  // 发送欢迎消息
  ws.send(createMessage('connected', { message: 'Connected to game server' }));
}

function handleMessage(ws, conn, type, payload) {
  switch (type) {
    case MSG_TYPES.CREATE_ROOM:
      handleCreateRoom(ws, conn, payload);
      break;
    case MSG_TYPES.JOIN_ROOM:
      handleJoinRoom(ws, conn, payload);
      break;
    case MSG_TYPES.LEAVE_ROOM:
      handleLeaveRoom(ws, conn);
      break;
    case MSG_TYPES.START_GAME:
      handleStartGame(ws, conn, payload);
      break;
    case MSG_TYPES.SHAKE:
      handleShake(ws, conn, payload);
      break;
    case MSG_TYPES.TAP:
      handleTap(ws, conn, payload);
      break;
    case MSG_TYPES.RECONNECT:
      handleReconnect(ws, conn, payload);
      break;
    case MSG_TYPES.SWITCH_TEAM:
      handleSwitchTeam(ws, conn, payload);
      break;
    case MSG_TYPES.SET_NAME:
      handleSetName(ws, conn, payload);
      break;
    case MSG_TYPES.PLAYER_READY:
      handlePlayerReady(ws, conn, payload);
      break;
    case MSG_TYPES.PLAYER_UNREADY:
      handlePlayerUnready(ws, conn, payload);
      break;
    case MSG_TYPES.MEMORY_INPUT:
      handleMemoryInput(ws, conn, payload);
      break;
    case 'drawguess_draw':
      handleDrawGuessDraw(ws, conn, payload);
      break;
    case 'drawguess_clear':
      handleDrawGuessClear(ws, conn, payload);
      break;
    case 'drawguess_guess':
      handleDrawGuessGuess(ws, conn, payload);
      break;
    case 'get_room_info':
      handleGetRoomInfo(ws, conn, payload);
      break;
    default:
      ws.send(createMessage(MSG_TYPES.ERROR, { code: 'UNKNOWN_TYPE', message: `Unknown message type: ${type}` }));
  }
}

function handleCreateRoom(ws, conn, payload) {
  const { userId, nickName, roomName, teamSize, password, gameType } = payload;

  console.log('[handleCreateRoom] Received:', { userId, nickName, roomName, teamSize, gameType });

  if (!userId) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'INVALID_USER', message: '用户ID不能为空' }));
    return;
  }

  const teamSz = Math.max(1, Math.min(10, parseInt(teamSize) || 5));
  const room = Room.create(userId, nickName, gameType || GAME_TYPES.TUG_OF_WAR, {
    roomName: (roomName || '').trim() || undefined,
    teamSize: teamSz,
    password: (password || '').trim() || '',
  });

  console.log('[handleCreateRoom] Room created:', room.id);

  // 房主暂不加队，等客户端选择
  room.addPlayer(userId, nickName, TEAMS.A);

  conn.userId = userId;
  conn.roomId = room.id;

  ws.send(createMessage(MSG_TYPES.ROOM_JOINED, {
    roomId: room.id,
    roomName: room.roomName,
    gameType: room.gameType,
    status: room.status,
    hostUserId: room.hostUserId,
    teamSize: room.teamSize,
    hasPassword: !!room.password,
    players: Array.from(room.players.values()),
    teamAList: room.getTeamList(TEAMS.A),
    teamBList: room.getTeamList(TEAMS.B),
    isHost: true,
  }));
}

function handleSetName(ws, conn, payload) {
  // 纯客户端操作，服务端暂不需要
  // 昵称通过 join_room/create_room 携带
}

function handleGetRoomInfo(ws, conn, payload) {
  const { roomId } = payload;
  
  console.log('[handleGetRoomInfo] Received:', { roomId, connRoomId: conn.roomId });
  
  // 使用连接中保存的房间ID
  const actualRoomId = roomId || conn.roomId;
  
  if (!actualRoomId) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'NO_ROOM_ID', message: '未指定房间ID' }));
    return;
  }

  const room = Room.get(actualRoomId);
  if (!room) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'ROOM_NOT_FOUND', message: '房间不存在或已过期' }));
    return;
  }

  // 发送房间信息
  ws.send(createMessage('room_updated', {
    roomId: room.id,
    roomName: room.roomName,
    status: room.status,
    hostUserId: room.hostUserId,
    teamSize: room.teamSize,
    teamAList: room.getTeamList(TEAMS.A),
    teamBList: room.getTeamList(TEAMS.B),
    readyPlayers: room.getReadyPlayerIds(),
    isHost: room.hostUserId === conn.userId,
  }));
}

function handleJoinRoom(ws, conn, payload) {
  const { roomId, userId, nickName, password } = payload;

  console.log('[handleJoinRoom] Received:', { roomId, userId, nickName });

  if (!userId) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'INVALID_USER', message: '用户ID不能为空' }));
    return;
  }

  if (!roomId) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'NO_ROOM_ID', message: '请输入房间号' }));
    return;
  }

  const normalizedRoomId = roomId.trim().toUpperCase();
  console.log('[handleJoinRoom] Looking for room:', normalizedRoomId);
  
  const room = Room.get(normalizedRoomId);
  console.log('[handleJoinRoom] Room found:', room ? room.id : null);
  
  if (!room) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'ROOM_NOT_FOUND', message: '房间不存在或已过期' }));
    return;
  }

  // 检查是否是重连
  const pending = pendingReconnect.get(userId);
  if (pending && pending.roomId === normalizedRoomId) {
    // 清除重连计时
    clearTimeout(pending.timeout);
    pendingReconnect.delete(userId);
    console.log('[handleJoinRoom] User reconnecting:', userId);
    
    // 更新连接信息
    conn.userId = userId;
    conn.roomId = room.id;

    // 发送房间信息
    ws.send(createMessage(MSG_TYPES.ROOM_JOINED, {
      roomId: room.id,
      roomName: room.roomName,
      gameType: room.gameType,
      status: room.status,
      hostUserId: room.hostUserId,
      teamSize: room.teamSize,
      hasPassword: !!room.password,
      players: Array.from(room.players.values()),
      teamAList: room.getTeamList(TEAMS.A),
      teamBList: room.getTeamList(TEAMS.B),
      isHost: room.hostUserId === userId,
    }));

    // 广播玩家重新加入（只有当玩家之前不在房间时才广播）
    if (!room.getPlayer(userId)) {
      room.addPlayer(userId, nickName, TEAMS.A);
      broadcastToRoom(room, createMessage(MSG_TYPES.PLAYER_JOINED, {
        userId,
        nickName: room.getPlayer(userId)?.nickName || nickName,
        teamId: room.getPlayer(userId)?.teamId,
      }));
    } else {
      console.log('[handleJoinRoom] Player already in room:', userId);
    }

    return;
  }

  // 如果玩家已在房间中（创建房间后跳转、刷新等），视为重新进入
  if (room.getPlayer(userId)) {
    console.log('[handleJoinRoom] Player already in room (WAITING), treating as re-entry:', userId);
    conn.userId = userId;
    conn.roomId = room.id;

    ws.send(createMessage(MSG_TYPES.ROOM_JOINED, {
      roomId: room.id,
      roomName: room.roomName,
      gameType: room.gameType,
      status: room.status,
      hostUserId: room.hostUserId,
      teamSize: room.teamSize,
      hasPassword: !!room.password,
      players: Array.from(room.players.values()),
      teamAList: room.getTeamList(TEAMS.A),
      teamBList: room.getTeamList(TEAMS.B),
      isHost: room.hostUserId === userId,
      readyPlayers: room.getReadyPlayerIds(),
    }));
    return;
  }

  if (room.status !== ROOM_STATUS.WAITING) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'ROOM_CLOSED', message: '游戏已经开始或已结束' }));
    return;
  }

  // 密码校验
  if (!room.verifyPassword(password || '')) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'WRONG_PASSWORD', message: '房间密码错误' }));
    return;
  }

  // 自动分配到人少的队伍
  var chosenTeam = room.teamA.length <= room.teamB.length ? TEAMS.A : TEAMS.B;
  if (room.teamA.length >= room.teamSize && room.teamB.length >= room.teamSize) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'ROOM_FULL', message: '房间已满' }));
    return;
  }

  if (!room.addPlayer(userId, nickName, chosenTeam)) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'JOIN_FAILED', message: '加入房间失败' }));
    return;
  }

  conn.userId = userId;
  conn.roomId = room.id;

  ws.send(createMessage(MSG_TYPES.ROOM_JOINED, {
    roomId: room.id,
    roomName: room.roomName,
    gameType: room.gameType,
    status: room.status,
    hostUserId: room.hostUserId,
    teamSize: room.teamSize,
    hasPassword: !!room.password,
    players: Array.from(room.players.values()),
    teamAList: room.getTeamList(TEAMS.A),
    teamBList: room.getTeamList(TEAMS.B),
    isHost: room.hostUserId === userId,
  }));

  broadcastToRoom(room, createMessage(MSG_TYPES.PLAYER_JOINED, {
    userId,
    nickName: room.getPlayer(userId) ? room.getPlayer(userId).nickName : nickName,
    teamId: room.getPlayer(userId) ? room.getPlayer(userId).teamId : chosenTeam,
  }), [userId]);

  broadcastToRoom(room, createMessage(MSG_TYPES.ROOM_UPDATED, {
    players: Array.from(room.players.values()),
    teamAList: room.getTeamList(TEAMS.A),
    teamBList: room.getTeamList(TEAMS.B),
  }));
}

function handleLeaveRoom(ws, conn) {
  if (!conn.roomId || !conn.userId) return;

  const room = Room.get(conn.roomId);
  if (!room) return;

  room.removePlayer(conn.userId);

  broadcastToRoom(room, createMessage(MSG_TYPES.PLAYER_LEFT, {
    userId: conn.userId,
  }));

  if (room.players.size === 0) {
    Room.delete(room.id);
  } else {
    broadcastToRoom(room, createMessage(MSG_TYPES.ROOM_UPDATED, {
      players: Array.from(room.players.values()),
      teamAList: room.getTeamList(TEAMS.A),
      teamBList: room.getTeamList(TEAMS.B),
      hostUserId: room.hostUserId,
    }));
  }

  conn.roomId = null;
  conn.userId = null;
}

function handleStartGame(ws, conn, payload) {
  if (!conn.roomId || !conn.userId) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'NOT_IN_ROOM', message: '您不在房间中' }));
    return;
  }

  const room = Room.get(conn.roomId);
  if (!room) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'ROOM_NOT_FOUND', message: '房间不存在' }));
    return;
  }

  if (room.hostUserId !== conn.userId) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'NOT_HOST', message: '只有执行人可以开始游戏' }));
    return;
  }

  if (!room.canStart()) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'CANNOT_START', message: 'AB两队至少各需1名玩家' }));
    return;
  }

  // 检查是否所有玩家都已准备
  if (!room.allPlayersReady()) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'WAITING_PLAYERS', message: '等待其他玩家准备...' }));
    return;
  }

  room.status = ROOM_STATUS.PLAYING;

  // 根据游戏类型创建游戏实例
  var game;
  var gameType = room.gameType || GAME_TYPES.TUG_OF_WAR;

  if (gameType === GAME_TYPES.REACTION) {
    game = new ReactionGame(room, function(msg) {
      broadcastToRoom(room, msg);
    });
  } else if (gameType === GAME_TYPES.MEMORY) {
    game = new MemoryGame(room, function(msg) {
      broadcastToRoom(room, msg);
    });
  } else if (gameType === GAME_TYPES.DRAW_GUESS) {
    game = new DrawGuessGame(room, function(msg) {
      broadcastToRoom(room, msg);
    }, function(userId, msg) {
      // 发送给指定用户（画手看词）
      sendToUser(userId, msg);
    });
  } else {
    // 默认拔河
    game = new TugOfWarGame(room, function(msg) {
      broadcastToRoom(room, msg);
    });
  }

  room.gameInstance = game;

  // 游戏结束后更新房间状态
  game.onEnd = function() {
    room.status = ROOM_STATUS.FINISHED;
  };

  game.startCountdown();
}

function handleShake(ws, conn, payload) {
  if (!conn.roomId || !conn.userId) return;

  const room = Room.get(conn.roomId);
  if (!room || !room.gameInstance) return;

  if (room.gameInstance.handleShake) {
    room.gameInstance.handleShake(conn.userId, payload.power || 0);
  }
}

function handleTap(ws, conn, payload) {
  if (!conn.roomId || !conn.userId) return;

  const room = Room.get(conn.roomId);
  if (!room || !room.gameInstance) return;

  // 使用通用的 handleTap 方法
  if (room.gameInstance.handleTap) {
    var player = room.getPlayer(conn.userId);
    var teamId = player ? player.teamId : null;
    room.gameInstance.handleTap(conn.userId, teamId);
  }
  
  // 兼容旧的 handleShake 方法
  if (room.gameInstance.handleShake) {
    room.gameInstance.handleShake(conn.userId, payload.power || 1);
  }
}

function handleSwitchTeam(ws, conn, payload) {
  if (!conn.roomId || !conn.userId) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'NOT_IN_ROOM', message: '您不在房间中' }));
    return;
  }

  const room = Room.get(conn.roomId);
  if (!room) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'ROOM_NOT_FOUND', message: '房间不存在' }));
    return;
  }

  const { teamId } = payload;
  if (!teamId || (teamId !== TEAMS.A && teamId !== TEAMS.B)) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'INVALID_TEAM', message: '无效的队伍' }));
    return;
  }

  const player = room.getPlayer(conn.userId);
  if (!player) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'NOT_IN_ROOM', message: '您不在房间中' }));
    return;
  }

  // 如果已经在目标队伍，不需要切换
  if (player.teamId === teamId) return;

  // 检查目标队伍是否已满
  const targetTeam = teamId === TEAMS.A ? room.teamA : room.teamB;
  if (targetTeam.length >= room.teamSize) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'TEAM_FULL', message: '该队伍已满' }));
    return;
  }

  room.switchTeam(conn.userId);
  
  // 切换队伍后取消准备状态
  room.setPlayerReady(conn.userId, false);

  broadcastToRoom(room, createMessage(MSG_TYPES.ROOM_UPDATED, {
    players: Array.from(room.players.values()),
    teamAList: room.getTeamList(TEAMS.A),
    teamBList: room.getTeamList(TEAMS.B),
    hostUserId: room.hostUserId,
    readyPlayers: room.getReadyPlayerIds(),
    canStart: room.canStart() && room.allPlayersReady(),
  }));
}

/**
 * 玩家准备
 */
function handlePlayerReady(ws, conn, payload) {
  if (!conn.roomId || !conn.userId) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'NOT_IN_ROOM', message: '您不在房间中' }));
    return;
  }

  const room = Room.get(conn.roomId);
  if (!room) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'ROOM_NOT_FOUND', message: '房间不存在' }));
    return;
  }

  if (room.status !== ROOM_STATUS.WAITING) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'GAME_STARTED', message: '游戏已经开始' }));
    return;
  }

  const player = room.getPlayer(conn.userId);
  if (!player) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'NOT_IN_ROOM', message: '您不在房间中' }));
    return;
  }

  room.setPlayerReady(conn.userId, payload.ready !== false);

  broadcastToRoom(room, createMessage(MSG_TYPES.ROOM_UPDATED, {
    players: Array.from(room.players.values()),
    teamAList: room.getTeamList(TEAMS.A),
    teamBList: room.getTeamList(TEAMS.B),
    hostUserId: room.hostUserId,
    readyPlayers: room.getReadyPlayerIds(),
    canStart: room.canStart() && room.allPlayersReady(),
  }));
}

/**
 * 玩家取消准备
 */
function handlePlayerUnready(ws, conn, payload) {
  if (!conn.roomId || !conn.userId) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'NOT_IN_ROOM', message: '您不在房间中' }));
    return;
  }

  const room = Room.get(conn.roomId);
  if (!room) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'ROOM_NOT_FOUND', message: '房间不存在' }));
    return;
  }

  if (room.status !== ROOM_STATUS.WAITING) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'GAME_STARTED', message: '游戏已经开始' }));
    return;
  }

  room.setPlayerReady(conn.userId, false);

  broadcastToRoom(room, createMessage(MSG_TYPES.ROOM_UPDATED, {
    players: Array.from(room.players.values()),
    teamAList: room.getTeamList(TEAMS.A),
    teamBList: room.getTeamList(TEAMS.B),
    hostUserId: room.hostUserId,
    readyPlayers: room.getReadyPlayerIds(),
    canStart: room.canStart() && room.allPlayersReady(),
  }));
}

/**
 * 断线重连 - 玩家重新连接
 */
function handleReconnect(ws, conn, payload) {
  const { userId, roomId } = payload;
  if (!userId || !roomId) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'INVALID_RECONNECT', message: '重连信息不完整' }));
    return;
  }

  const room = Room.get(roomId);
  if (!room) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'ROOM_NOT_FOUND', message: '房间已过期' }));
    return;
  }

  // 清除待重连标记
  const pending = pendingReconnect.get(userId);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingReconnect.delete(userId);
  }

  // 如果玩家已被移出房间（重连超时），重新加入
  if (!room.getPlayer(userId)) {
    ws.send(createMessage(MSG_TYPES.ERROR, { code: 'RECONNECT_TIMEOUT', message: '重连超时，请重新加入' }));
    return;
  }

  // 更新连接映射
  conn.userId = userId;
  conn.roomId = roomId;
  connections.set(ws, conn);

  // 发送房间当前状态
  ws.send(createMessage(MSG_TYPES.ROOM_JOINED, {
    roomId: room.id,
    gameType: room.gameType,
    status: room.status,
    hostUserId: room.hostUserId,
    players: Array.from(room.players.values()),
    teamAList: room.getTeamList(TEAMS.A),
    teamBList: room.getTeamList(TEAMS.B),
    isHost: room.hostUserId === userId,
  }));

  // 如果游戏中，发送当前游戏状态
  if (room.gameInstance && room.status === ROOM_STATUS.PLAYING) {
    var game = room.gameInstance;
    var stateData = {
      status: game.status,
    };

    // 拔河游戏状态
    if (room.gameType === GAME_TYPES.TUG_OF_WAR) {
      stateData.ropeOffset = Math.round((game.ropeOffset || 0) * 100) / 100;
      stateData.teamAPower = Math.round(game.teamAPower || 0);
      stateData.teamBPower = Math.round(game.teamBPower || 0);
      stateData.teamAShakes = game.teamAShakes || 0;
      stateData.teamBShakes = game.teamBShakes || 0;
      stateData.timeLeft = game.timeLeft;
    }

    ws.send(createMessage(MSG_TYPES.GAME_STATE, stateData));
  }

  broadcastToRoom(room, createMessage(MSG_TYPES.PLAYER_JOINED, {
    userId,
    nickName: room.getPlayer(userId)?.nickName,
    teamId: room.getPlayer(userId)?.teamId,
    reconnected: true,
  }), [userId]);
}

/**
 * 断开连接（支持游戏中重连）
 */
function handleDisconnect(ws, conn) {
  if (conn.roomId && conn.userId) {
    const room = Room.get(conn.roomId);

    if (room && room.status === ROOM_STATUS.PLAYING) {
      // 游戏中断线 - 保留玩家位置，等待重连
      const userId = conn.userId;

      // 清除旧重连计时
      const old = pendingReconnect.get(userId);
      if (old) clearTimeout(old.timeout);

      // 30秒重连窗口
      const timeout = setTimeout(() => {
        pendingReconnect.delete(userId);
        if (room.getPlayer(userId)) {
          handleLeaveRoom(ws, conn);
          // 广播玩家掉线
          broadcastToRoom(room, createMessage(MSG_TYPES.PLAYER_LEFT, {
            userId,
            reason: 'reconnect_timeout',
          }));
        }
      }, 30000);

      pendingReconnect.set(userId, { roomId: conn.roomId, timeout });

      broadcastToRoom(room, createMessage(MSG_TYPES.PLAYER_LEFT, {
        userId: conn.userId,
        reason: 'disconnected',
        reconnectIn: 30,
      }));
    } else if (room && room.hostUserId === conn.userId) {
      // 房主在等待状态断线 - 给予短时间重连窗口（页面跳转场景）
      const userId = conn.userId;

      // 清除旧重连计时
      const old = pendingReconnect.get(userId);
      if (old) clearTimeout(old.timeout);

      // 10秒重连窗口
      const timeout = setTimeout(() => {
        pendingReconnect.delete(userId);
        if (room.getPlayer(userId)) {
          handleLeaveRoom(ws, conn);
          broadcastToRoom(room, createMessage(MSG_TYPES.PLAYER_LEFT, {
            userId,
            reason: 'reconnect_timeout',
          }));
        }
      }, 10000);

      pendingReconnect.set(userId, { roomId: conn.roomId, timeout });
      console.log('[handleDisconnect] Host disconnected, waiting for reconnect:', userId, 'room:', room.id);
    } else {
      // 非游戏中直接离开
      handleLeaveRoom(ws, conn);
    }
  }
  connections.delete(ws);
}

// 广播消息给房间内所有人（可排除某些用户）
function broadcastToRoom(room, message, excludeUserIds = []) {
  const excludeSet = new Set(excludeUserIds);
  let sentCount = 0;
  for (const [ws, conn] of connections) {
    if (conn.roomId === room.id && !excludeSet.has(conn.userId)) {
      try {
        ws.send(message);
        sentCount++;
        console.log('[WS] sent message to user:', conn.userId, 'type:', JSON.parse(message).type);
      } catch(e) {
        console.error('[WS] send failed to user:', conn.userId, 'error:', e);
      }
    }
  }
  console.log('[WS] broadcastToRoom - room:', room.id, 'sent to', sentCount, 'users');
}

/**
 * 记忆游戏 - 处理玩家输入
 */
function handleMemoryInput(ws, conn, payload) {
  if (!conn.roomId || !conn.userId) return;

  const room = Room.get(conn.roomId);
  if (!room || !room.gameInstance) return;

  if (room.gameInstance.handleInput) {
    var player = room.getPlayer(conn.userId);
    var teamId = player ? player.teamId : null;
    room.gameInstance.handleInput(conn.userId, teamId, payload.input || '');
  }
}

/**
 * 你画我猜 - 画图数据同步
 */
function handleDrawGuessDraw(ws, conn, payload) {
  if (!conn.roomId || !conn.userId) return;

  const room = Room.get(conn.roomId);
  if (!room || !room.gameInstance) return;

  if (room.gameInstance.handleDraw) {
    room.gameInstance.handleDraw(conn.userId, payload);
  }
}

/**
 * 你画我猜 - 清空画布
 */
function handleDrawGuessClear(ws, conn, payload) {
  if (!conn.roomId || !conn.userId) return;

  const room = Room.get(conn.roomId);
  if (!room || !room.gameInstance) return;

  if (room.gameInstance.handleClear) {
    room.gameInstance.handleClear(conn.userId);
  }
}

/**
 * 你画我猜 - 猜测
 */
function handleDrawGuessGuess(ws, conn, payload) {
  if (!conn.roomId || !conn.userId) return;

  const room = Room.get(conn.roomId);
  if (!room || !room.gameInstance) return;

  if (room.gameInstance.handleGuess) {
    var player = room.getPlayer(conn.userId);
    var teamId = player ? player.teamId : null;
    room.gameInstance.handleGuess(conn.userId, teamId, payload.guess || '');
  }
}

/**
 * 发送消息给指定用户
 */
function sendToUser(userId, message) {
  for (const [ws, conn] of connections) {
    if (conn.userId === userId) {
      try {
        ws.send(message);
      } catch(e) {
        console.error('[WS] sendToUser failed:', userId, e);
      }
      return;
    }
  }
}

module.exports = {
  handleConnection,
  broadcastToRoom,
};
