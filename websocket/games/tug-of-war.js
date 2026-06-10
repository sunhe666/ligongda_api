const { GAME_STATUS, GAME_DURATION, ROPE_THRESHOLD, TEAMS, COUNTDOWN_SECONDS } = require('../../shared/constants');
const { MSG_TYPES, createMessage } = require('../../shared/protocol');
const Leaderboard = require('../../models/Leaderboard');

/**
 * 拔河比赛游戏逻辑
 * 管理一局游戏的状态、力量汇总、胜负判定
 */
class TugOfWarGame {
  constructor(room, onBroadcast) {
    this.room = room;
    this.onBroadcast = onBroadcast;  // (message) => 广播给房间所有人
    this.status = GAME_STATUS.WAITING;
    this.timeLeft = GAME_DURATION;
    this.ropeOffset = 0;              // 绳子偏移量（>0偏向A队，<0偏向B队）
    this.teamAPower = 0;              // A队当前力量
    this.teamBPower = 0;              // B队当前力量
    this.teamAShakes = {};            // { userId: totalPower }
    this.teamBShakes = {};            // { userId: totalPower }
    this.teamAScore = 0;              // A队累计力量
    this.teamBScore = 0;              // B队累计力量
    this.tickInterval = null;
    this.countdownInterval = null;
    this.gameEndTimeout = null;       // 游戏结束备用定时器
    this.countdownValue = COUNTDOWN_SECONDS;
    this.startTime = null;
    this.tickCount = 0;               // tick计数器，用于跟踪时间
  }

  // 开始倒计时
  startCountdown() {
    this.status = GAME_STATUS.COUNTDOWN;
    this.countdownValue = COUNTDOWN_SECONDS;

    this.onBroadcast(createMessage(MSG_TYPES.GAME_STARTING, {
      countdown: this.countdownValue,
    }));

    this.countdownInterval = setInterval(() => {
      this.countdownValue--;
      if (this.countdownValue > 0) {
        this.onBroadcast(createMessage(MSG_TYPES.GAME_STARTING, {
          countdown: this.countdownValue,
        }));
      } else {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
        this.startGame();
      }
    }, 1000);
  }

  // 正式开始游戏
  startGame() {
    this.status = GAME_STATUS.PLAYING;
    this.startTime = Date.now();
    console.log('[TugOfWar] startGame - startTime:', this.startTime, 'current time:', Date.now());
    this.timeLeft = GAME_DURATION;  // 重置剩余时间
    this.tickCount = 0;             // 重置tick计数器
    this.teamAPower = 0;
    this.teamBPower = 0;
    this.ropeOffset = 0;
    this.teamAShakes = {};
    this.teamBShakes = {};

    // 发送游戏开始消息，让前端跳转到游戏页面
    this.onBroadcast(createMessage(MSG_TYPES.GAME_START, {
      roomId: this.room.id,
    }));

    // 每200ms tick 更新游戏状态
    this.tickInterval = setInterval(() => {
      this.tick();
    }, 200);
    console.log('[TugOfWar] startGame - tickInterval started');

    // 添加备用游戏结束定时器（确保游戏一定能结束）
    const gameDurationMs = GAME_DURATION * 1000 + 1000; // 多加1秒缓冲
    this.gameEndTimeout = setTimeout(() => {
      console.log('[TugOfWar] gameEndTimeout triggered - force ending game');
      if (this.status === GAME_STATUS.PLAYING) {
        this.endGame(this.ropeOffset > 0 ? TEAMS.B : this.ropeOffset < 0 ? TEAMS.A : null);
      }
    }, gameDurationMs);
    console.log('[TugOfWar] startGame - gameEndTimeout set for', gameDurationMs, 'ms');
  }

  // 接收玩家摇一摇数据
  handleShake(userId, power) {
    console.log('[TugOfWar] handleShake - userId:', userId, 'power:', power, 'status:', this.status);
    if (this.status !== GAME_STATUS.PLAYING) return;

    const player = this.room.getPlayer(userId);
    if (!player) return;

    const cappedPower = Math.min(power, 100);

    if (player.teamId === TEAMS.A) {
      this.teamAPower += cappedPower;
      this.teamAShakes[userId] = (this.teamAShakes[userId] || 0) + cappedPower;
      this.teamAScore += cappedPower;
    } else {
      this.teamBPower += cappedPower;
      this.teamBShakes[userId] = (this.teamBShakes[userId] || 0) + cappedPower;
      this.teamBScore += cappedPower;
    }
  }

  // 每 tick 更新
  tick() {
    try {
      console.log('[TugOfWar] tick called - status:', this.status, 'tickCount:', this.tickCount, 'timeLeft:', this.timeLeft);
      
      if (this.status !== GAME_STATUS.PLAYING) {
        console.log('[TugOfWar] tick skipped - not playing, status:', this.status);
        return;
      }

      // 使用tick计数器计算时间（每200ms一个tick，5个tick=1秒）
      this.tickCount++;
      const elapsedSeconds = Math.floor(this.tickCount / 5); // 每5个tick = 1秒
      const newTimeLeft = Math.max(0, GAME_DURATION - elapsedSeconds);
      
      // 记录时间变化
      if (newTimeLeft !== this.timeLeft) {
        console.log('[TugOfWar] tick - timeLeft changed:', this.timeLeft, '->', newTimeLeft, 'tickCount:', this.tickCount);
      }
      this.timeLeft = newTimeLeft;

      // 力量差 → 绳子偏移（降低速度让游戏更持久）
      const powerDiff = this.teamBPower - this.teamAPower;
      this.ropeOffset += powerDiff * 0.05;  // 降低偏移速度从0.3到0.05
      this.ropeOffset = Math.max(-ROPE_THRESHOLD, Math.min(ROPE_THRESHOLD, this.ropeOffset));

      // 检查胜负
      let winner = null;
      if (this.ropeOffset >= ROPE_THRESHOLD) { winner = TEAMS.B; }
      else if (this.ropeOffset <= -ROPE_THRESHOLD) { winner = TEAMS.A; }

      if (this.timeLeft <= 0 && !winner) {
        winner = this.ropeOffset > 0 ? TEAMS.B : this.ropeOffset < 0 ? TEAMS.A : null;
      }

      // 广播游戏状态（使用累计分数作为力量显示）
      this.onBroadcast(createMessage(MSG_TYPES.GAME_STATE, {
        ropeOffset: 0, // 固定为0，不晃动
        teamAPower: Math.round(this.teamAScore), // 使用累计分数
        teamBPower: Math.round(this.teamBScore), // 使用累计分数
        teamAShakes: this.teamAShakes,
        teamBShakes: this.teamBShakes,
        teamAList: this.room.getTeamList(TEAMS.A) || [],
        teamBList: this.room.getTeamList(TEAMS.B) || [],
        timeLeft: this.timeLeft,
        status: this.status,
      }));

      // 不重置力量，让分数持续累积

      // 游戏结束判定
      if (winner !== null || this.timeLeft <= 0) {
        console.log('[TugOfWar] tick triggering endGame - winner:', winner, 'timeLeft:', this.timeLeft);
        this.endGame(winner);
      }
    } catch(err) {
      console.error('[TugOfWar] tick error:', err);
    }
  }

  // 游戏结束
  endGame(winner) {
    console.log('[TugOfWar] endGame called - winner:', winner, 'current status:', this.status);
    
    // 先清理定时器，防止继续 tick
    if (this.tickInterval) {
      console.log('[TugOfWar] clearing tickInterval');
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.countdownInterval) {
      console.log('[TugOfWar] clearing countdownInterval');
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    // 清理备用游戏结束定时器
    if (this.gameEndTimeout) {
      console.log('[TugOfWar] clearing gameEndTimeout');
      clearTimeout(this.gameEndTimeout);
      this.gameEndTimeout = null;
    }

    // 立即更新状态，防止重复调用
    if (this.status === GAME_STATUS.FINISHED) {
      console.log('[TugOfWar] endGame already finished, returning');
      return;
    }
    this.status = GAME_STATUS.FINISHED;
    console.log('[TugOfWar] status updated to FINISHED');

    // 计算 MVP（摇动总力量最大的玩家）
    const allShakes = { ...this.teamAShakes, ...this.teamBShakes };
    let mvpUserId = null;
    let maxPower = 0;
    for (const [uid, power] of Object.entries(allShakes)) {
      if (power > maxPower) {
        maxPower = power;
        mvpUserId = uid;
      }
    }

    const mvpPlayer = mvpUserId ? this.room.getPlayer(mvpUserId) : null;

    const result = {
      winner,
      tie: winner === null,
      teamAScore: this.teamAScore,
      teamBScore: this.teamBScore,
      mvp: mvpUserId,
      mvpNickName: mvpPlayer ? mvpPlayer.nickName : '',
      teamAPlayers: this.room.getTeamPlayers(TEAMS.A),
      teamBPlayers: this.room.getTeamPlayers(TEAMS.B),
      duration: GAME_DURATION - this.timeLeft,
    };

    // 先广播结果，确保客户端收到
    console.log('[TugOfWar] broadcasting GAME_OVER message');
    this.onBroadcast(createMessage(MSG_TYPES.GAME_OVER, result));
    this.result = result;
    console.log('[TugOfWar] GAME_OVER broadcast complete, result:', result);

    // 最后保存排行榜（失败不影响游戏流程）
    try {
      console.log('[TugOfWar] saving to leaderboard');
      Leaderboard.save(Object.assign({}, result, { roomId: this.room.id }));
      console.log('[TugOfWar] leaderboard save complete');
    } catch(e) {
      console.error('[Game] 保存排行榜失败:', e);
    }
    
    // 调用 onEnd 回调更新房间状态
    if (this.onEnd) {
      console.log('[TugOfWar] calling onEnd callback');
      this.onEnd();
    }
  }

  destroy() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }
}

module.exports = TugOfWarGame;
