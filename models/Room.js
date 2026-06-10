const { v4: uuidv4 } = require('uuid');
const { TEAMS, ROOM_STATUS, PLAYER_LIMITS } = require('../../shared/constants');

// 内存中的房间存储（生产环境可换 Redis）
const rooms = new Map();

class Room {
  constructor(hostUserId, hostNickName, gameType, opts) {
    opts = opts || {};
    this.id = this._generateId();
    this.roomName = opts.roomName || ('房间' + this.id.slice(0, 4));
    this.password = opts.password || '';
    this.gameType = gameType || 'tug-of-war';
    this.teamSize = opts.teamSize || PLAYER_LIMITS.TUG_OF_WAR.TEAM_SIZE;
    this.status = ROOM_STATUS.WAITING;
    this.hostUserId = hostUserId;
    this.players = new Map();
    this.teamA = [];
    this.teamB = [];
    this.readyPlayers = new Set(); // 准备好的玩家ID集合
    this.createdAt = Date.now();
    this.gameInstance = null;
  }

  _generateId() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
  }

  addPlayer(userId, nickName, teamId, avatarUrl) {
    if (this.players.has(userId)) return false;
    if (this.status !== ROOM_STATUS.WAITING) return false;

    var team = teamId === TEAMS.A ? this.teamA : this.teamB;
    if (team.length >= this.teamSize) return false;

    // 如果指定队伍满了，自动分配到有空位的队伍
    if (team.length >= this.teamSize) {
      teamId = teamId === TEAMS.A ? TEAMS.B : TEAMS.A;
      team = teamId === TEAMS.A ? this.teamA : this.teamB;
      if (team.length >= this.teamSize) return false;
    }

    var player = {
      userId: userId,
      nickName: nickName || ('玩家' + String(userId).slice(0, 4)),
      avatarUrl: avatarUrl || '',
      teamId: teamId,
      joinedAt: Date.now(),
    };

    this.players.set(userId, player);
    team.push(userId);
    return true;
  }

  removePlayer(userId) {
    if (!this.players.has(userId)) return false;

    const player = this.players.get(userId);
    const team = player.teamId === TEAMS.A ? this.teamA : this.teamB;
    const idx = team.indexOf(userId);
    if (idx !== -1) team.splice(idx, 1);

    this.players.delete(userId);
    this.readyPlayers.delete(userId); // 同时移除准备状态

    // 如果房主离开，转移房主
    if (userId === this.hostUserId && this.players.size > 0) {
      this.hostUserId = this.players.keys().next().value;
    }

    return true;
  }

  getPlayer(userId) {
    return this.players.get(userId) || null;
  }

  switchTeam(userId) {
    var player = this.players.get(userId);
    if (!player) return false;

    var newTeam = player.teamId === TEAMS.A ? TEAMS.B : TEAMS.A;
    var newTeamArr = newTeam === TEAMS.A ? this.teamA : this.teamB;
    if (newTeamArr.length >= this.teamSize) return false;

    var oldTeamArr = player.teamId === TEAMS.A ? this.teamA : this.teamB;
    var idx = oldTeamArr.indexOf(userId);
    if (idx !== -1) oldTeamArr.splice(idx, 1);

    newTeamArr.push(userId);
    player.teamId = newTeam;
    return true;
  }

  getTeamList(teamId) {
    const ids = teamId === TEAMS.A ? this.teamA : this.teamB;
    return ids.map(id => {
      const player = this.players.get(id);
      if (!player) return null;
      return {
        ...player,
        ready: this.readyPlayers.has(id)
      };
    }).filter(Boolean);
  }

  getTeamPlayers(teamId) {
    return teamId === TEAMS.A ? [...this.teamA] : [...this.teamB];
  }

  getAllPlayers() {
    return Array.from(this.players.values());
  }

  isFull() {
    return this.teamA.length >= this.teamSize && this.teamB.length >= this.teamSize;
  }

  canStart() {
    return this.teamA.length >= 1 && this.teamB.length >= 1 && this.status === ROOM_STATUS.WAITING;
  }

  // 检查是否所有玩家都已准备
  allPlayersReady() {
    return this.players.size > 0 && this.readyPlayers.size === this.players.size;
  }

  // 设置玩家准备状态
  setPlayerReady(userId, ready) {
    if (!this.players.has(userId)) return false;
    if (this.status !== ROOM_STATUS.WAITING) return false;
    
    if (ready) {
      this.readyPlayers.add(userId);
    } else {
      this.readyPlayers.delete(userId);
    }
    return true;
  }

  // 检查玩家是否已准备
  isPlayerReady(userId) {
    return this.readyPlayers.has(userId);
  }

  // 获取准备好的玩家ID列表
  getReadyPlayerIds() {
    return Array.from(this.readyPlayers);
  }

  // 清空所有准备状态（游戏结束后重置）
  clearAllReady() {
    this.readyPlayers.clear();
  }

  verifyPassword(inputPwd) {
    if (!this.password) return true;
    return inputPwd === this.password;
  }

  toJSON() {
    return {
      id: this.id,
      roomName: this.roomName,
      gameType: this.gameType,
      status: this.status,
      hostUserId: this.hostUserId,
      playerCount: this.players.size,
      teamSize: this.teamSize,
      hasPassword: !!this.password,
      teamA: this.getTeamList(TEAMS.A),
      teamB: this.getTeamList(TEAMS.B),
      createdAt: this.createdAt,
    };
  }

  static create(hostUserId, hostNickName, gameType, opts) {
    var room = new Room(hostUserId, hostNickName, gameType, opts);
    rooms.set(room.id, room);
    return room;
  }

  static listAll() {
    var list = [];
    rooms.forEach(function(room) {
      if (room.status === ROOM_STATUS.WAITING) {
        list.push({
          roomId: room.id,
          roomName: room.roomName,
          teamSize: room.teamSize,
          playerCount: room.players.size,
          hasPassword: !!room.password,
        });
      }
    });
    return list;
  }

  static get(roomId) {
    return rooms.get(roomId) || null;
  }

  static delete(roomId) {
    return rooms.delete(roomId);
  }

  static cleanup() {
    const now = Date.now();
    const timeout = 30 * 60 * 1000; // 30分钟无活动自动清理
    for (const [id, room] of rooms) {
      if (now - room.createdAt > timeout) {
        rooms.delete(id);
      }
    }
  }
}

// 每小时清理过期房间
setInterval(Room.cleanup, 60 * 60 * 1000);

module.exports = Room;
