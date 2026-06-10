const { MSG_TYPES, createMessage } = require('../../shared/protocol');
const { TEAMS, GAME_STATUS, COUNTDOWN_SECONDS } = require('../../shared/constants');

/**
 * 数字记忆王 - 团队记忆数字对决（多人版）
 * 规则：展示一串数字，5轮对决。显示阶段后进入输入阶段。
 * 任意队员答对即为团队赢得本轮。双方都答对时，先答对的队伍获胜。
 */
class MemoryGame {
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
    this.currentNumber = '';
    this.numberLength = 3;
    this.inputPhase = false;
    this.roundTimeout = null;
    this.winnerDecided = false;
    this.teamAFinished = false;
    this.teamBFinished = false;
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

  generateNumber() {
    let num = '';
    for (let i = 0; i < this.numberLength; i++) {
      num += Math.floor(Math.random() * 10).toString();
    }
    return num;
  }

  startRound() {
    if (this.roundCount >= this.maxRounds) {
      this.endGame();
      return;
    }

    this.roundCount++;
    this.currentNumber = this.generateNumber();
    this.inputPhase = false;
    this.winnerDecided = false;
    this.teamAFinished = false;
    this.teamBFinished = false;

    // 显示数字
    this.onBroadcast(createMessage('memory_round', {
      round: this.roundCount,
      maxRounds: this.maxRounds,
      teamAScore: this.teamAScore,
      teamBScore: this.teamBScore,
      phase: 'show_number',
      number: this.currentNumber,
      numberLength: this.numberLength,
      showDuration: this.numberLength * 500,
    }));

    // 显示后进入输入阶段
    const showTime = this.numberLength * 500 + 1000;
    setTimeout(() => {
      if (this.status !== GAME_STATUS.PLAYING) return;
      this.startInputPhase();
    }, showTime);
  }

  startInputPhase() {
    this.inputPhase = true;

    this.onBroadcast(createMessage('memory_round', {
      round: this.roundCount,
      maxRounds: this.maxRounds,
      teamAScore: this.teamAScore,
      teamBScore: this.teamBScore,
      phase: 'input',
      numberLength: this.numberLength,
    }));

    // 8秒输入超时
    this.roundTimeout = setTimeout(() => {
      this.endRound(null);
    }, 8000);
  }

  handleInput(userId, teamId, input) {
    if (!this.inputPhase || this.winnerDecided) return;
    if (this.status !== GAME_STATUS.PLAYING) return;
    if (!teamId || (teamId !== TEAMS.A && teamId !== TEAMS.B)) return;

    const player = this.room.getPlayer(userId);
    const nickName = player ? player.nickName : userId;
    const correct = input === this.currentNumber;

    // 广播该玩家的提交
    this.onBroadcast(createMessage('memory_answer', {
      teamId: teamId,
      userId: userId,
      nickName: nickName,
      input: input,
      correct: correct,
    }));

    if (correct) {
      // 答对了！该队获胜
      this.winnerDecided = true;
      if (this.roundTimeout) {
        clearTimeout(this.roundTimeout);
        this.roundTimeout = null;
      }

      const loserTeam = teamId === TEAMS.A ? TEAMS.B : TEAMS.A;
      this.endRound(teamId, loserTeam);
    } else {
      // 答错了，标记该队已尝试过
      if (teamId === TEAMS.A) {
        this.teamAFinished = true;
      } else {
        this.teamBFinished = true;
      }

      // 两队都答错了，结束本轮
      if (this.teamAFinished && this.teamBFinished) {
        this.winnerDecided = true;
        if (this.roundTimeout) {
          clearTimeout(this.roundTimeout);
          this.roundTimeout = null;
        }
        this.endRound(null);
      }
    }
  }

  handleTap(userId, teamId) {
    // Memory game uses input, not tap.
  }

  endRound(winnerTeam, loserTeam) {
    if (winnerTeam === TEAMS.A) this.teamAScore++;
    else if (winnerTeam === TEAMS.B) this.teamBScore++;

    this.onBroadcast(createMessage('memory_round_result', {
      round: this.roundCount,
      maxRounds: this.maxRounds,
      winner: winnerTeam,
      loser: loserTeam,
      teamAScore: this.teamAScore,
      teamBScore: this.teamBScore,
      correctNumber: this.currentNumber,
    }));

    // 每2轮增加1位数字
    if (this.roundCount % 2 === 0) {
      this.numberLength = Math.min(8, this.numberLength + 1);
    }

    // 延迟开始下一轮
    setTimeout(() => {
      if (this.status === GAME_STATUS.PLAYING) {
        this.startRound();
      }
    }, 2500);
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
      gameType: 'memory',
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

module.exports = MemoryGame;