const { MSG_TYPES, createMessage } = require('../../../shared/protocol');
const { TEAMS, GAME_STATUS, COUNTDOWN_SECONDS } = require('../../../shared/constants');

/**
 * 反应大比拼 - 团队反应速度对决（多人版）
 * 规则：屏幕变绿后，双方队员任意一人最快点击的队伍获胜
 * 谁先点谁赢，抢跑判负
 */
class ReactionGame {
  constructor(room, onBroadcast) {
    this.room = room;
    this.onBroadcast = onBroadcast;
    this.status = GAME_STATUS.WAITING;
    this.startTime = 0;
    this.countdownInterval = null;
    this.finished = false;
    this.roundCount = 0;
    this.maxRounds = 5;
    this.teamAScore = 0;
    this.teamBScore = 0;
    this.greenLightTime = 0;
    this.roundTimeout = null;
    this.ready = false;       // 是否可以点击
    this.winnerDecided = false; // 本轮已决出胜负
    this.onEnd = null;
  }

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

  startGame() {
    this.status = GAME_STATUS.PLAYING;
    this.startTime = Date.now();

    this.onBroadcast(createMessage(MSG_TYPES.GAME_START, {
      roomId: this.room.id,
    }));

    this.startRound();
  }

  startRound() {
    if (this.roundCount >= this.maxRounds) {
      this.endGame();
      return;
    }

    this.roundCount++;
    this.ready = false;
    this.winnerDecided = false;
    this.greenLightTime = 0;

    // 告诉前端进入等待状态（红灯）
    this.onBroadcast(createMessage('reaction_round', {
      round: this.roundCount,
      maxRounds: this.maxRounds,
      teamAScore: this.teamAScore,
      teamBScore: this.teamBScore,
      phase: 'waiting',
      teamAPlayers: this.room.getTeamPlayers(TEAMS.A),
      teamBPlayers: this.room.getTeamPlayers(TEAMS.B),
    }));

    // 随机1.5-4秒后变绿
    const delay = 1500 + Math.random() * 2500;
    setTimeout(() => {
      if (this.status !== GAME_STATUS.PLAYING || this.winnerDecided) return;
      this.setGreenLight();
    }, delay);
  }

  setGreenLight() {
    if (this.status !== GAME_STATUS.PLAYING || this.winnerDecided) return;

    this.greenLightTime = Date.now();
    this.ready = true;

    this.onBroadcast(createMessage('reaction_round', {
      round: this.roundCount,
      maxRounds: this.maxRounds,
      teamAScore: this.teamAScore,
      teamBScore: this.teamBScore,
      phase: 'green_light',
    }));

    // 3秒超时（没人点算平局）
    this.roundTimeout = setTimeout(() => {
      this.endRound(null, null);
    }, 3000);
  }

  handleTap(userId, teamId) {
    if (this.status !== GAME_STATUS.PLAYING || this.winnerDecided) return;
    if (!teamId || (teamId !== TEAMS.A && teamId !== TEAMS.B)) return;

    const now = Date.now();
    const player = this.room.getPlayer(userId);
    const nickName = player ? player.nickName : userId;

    if (!this.ready) {
      // 抢跑！还没变绿就点了
      this.winnerDecided = true;
      if (this.roundTimeout) clearTimeout(this.roundTimeout);

      const loserTeam = teamId; // 抢跑的队伍输
      const winnerTeam = teamId === TEAMS.A ? TEAMS.B : TEAMS.A;

      this.onBroadcast(createMessage('reaction_tap', {
        teamId: teamId,
        userId: userId,
        nickName: nickName,
        earlyStart: true,
      }));

      this.endRound(winnerTeam, loserTeam, true);
      return;
    }

    // 正常点击 - 这一队赢了
    this.winnerDecided = true;
    if (this.roundTimeout) clearTimeout(this.roundTimeout);

    const reactionTime = now - this.greenLightTime;

    this.onBroadcast(createMessage('reaction_tap', {
      teamId: teamId,
      userId: userId,
      nickName: nickName,
      reactionTime: reactionTime,
    }));

    const loserTeam = teamId === TEAMS.A ? TEAMS.B : TEAMS.A;
    this.endRound(teamId, loserTeam, false);
  }

  endRound(winnerTeam, loserTeam, isEarlyStart) {
    if (winnerTeam === TEAMS.A) this.teamAScore++;
    else if (winnerTeam === TEAMS.B) this.teamBScore++;

    this.onBroadcast(createMessage('reaction_round_result', {
      round: this.roundCount,
      maxRounds: this.maxRounds,
      winner: winnerTeam,
      loser: loserTeam,
      earlyStart: !!isEarlyStart,
      teamAScore: this.teamAScore,
      teamBScore: this.teamBScore,
    }));

    // 延迟开始下一轮
    setTimeout(() => {
      if (this.status === GAME_STATUS.PLAYING) {
        this.startRound();
      }
    }, 2000);
  }

  endGame() {
    this.status = GAME_STATUS.FINISHED;

    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    if (this.roundTimeout) {
      clearTimeout(this.roundTimeout);
      this.roundTimeout = null;
    }

    let winner = null;
    if (this.teamAScore > this.teamBScore) winner = TEAMS.A;
    else if (this.teamBScore > this.teamAScore) winner = TEAMS.B;

    this.onBroadcast(createMessage(MSG_TYPES.GAME_OVER, {
      winner: winner,
      tie: this.teamAScore === this.teamBScore,
      teamAScore: this.teamAScore,
      teamBScore: this.teamBScore,
      teamAPlayers: this.room.getTeamPlayers(TEAMS.A),
      teamBPlayers: this.room.getTeamPlayers(TEAMS.B),
      duration: Math.floor((Date.now() - this.startTime) / 1000),
      gameType: 'reaction',
    }));

    if (this.onEnd) {
      this.onEnd();
    }
  }

  stop() {
    if (this.countdownInterval) clearInterval(this.countdownInterval);
    if (this.roundTimeout) clearTimeout(this.roundTimeout);
    this.status = GAME_STATUS.FINISHED;
  }
}

module.exports = ReactionGame;