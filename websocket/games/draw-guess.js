const { MSG_TYPES, createMessage } = require('../../shared/protocol');
const { TEAMS, GAME_STATUS, COUNTDOWN_SECONDS } = require('../../shared/constants');

// 词库
const WORD_BANK = [
  '太阳', '月亮', '星星', '大树', '花朵', '小鸟', '鱼', '猫', '狗', '兔子',
  '苹果', '西瓜', '香蕉', '草莓', '葡萄', '蛋糕', '冰淇淋', '汉堡', '披萨', '面条',
  '汽车', '飞机', '自行车', '轮船', '火箭', '手机', '电脑', '电视', '钟表', '雨伞',
  '眼镜', '帽子', '鞋子', '书包', '足球', '篮球', '吉他', '钢琴', '话筒', '相机',
  '房子', '桥梁', '长城', '金字塔', '埃菲尔铁塔', '雪山', '海滩', '彩虹', '闪电', '龙卷风',
  '笑脸', '哭脸', '爱心', '星星', '月亮', '太阳', '比心', '赞', '拳头', '胜利',
  '天使', '恶魔', '超人', '海盗', '忍者', '国王', '公主', '机器人', '外星人', '恐龙',
];

/**
 * 你画我猜 - 一人画两队猜
 * 规则：每轮选一个画手，实时在画布上画，两队猜词，先猜对得1分
 */
class DrawGuessGame {
  constructor(room, onBroadcast, sendToUser) {
    this.room = room;
    this.onBroadcast = onBroadcast;
    this.sendToUser = sendToUser || onBroadcast;
    this.status = GAME_STATUS.WAITING;
    this.startTime = 0;
    this.countdownInterval = null;
    this.finished = false;
    this.roundCount = 0;
    this.maxRounds = 5;
    this.teamAScore = 0;
    this.teamBScore = 0;
    this.currentWord = '';
    this.drawerUserId = null;
    this.drawerNickName = '';
    this.guessTimeout = null;
    this.winnerDecided = false;
    this.onEnd = null;
  }

  pickRandomWord() {
    const available = WORD_BANK.filter(w => w !== this.currentWord || WORD_BANK.length === 1);
    return available[Math.floor(Math.random() * available.length)];
  }

  pickDrawer() {
    const allPlayers = Array.from(this.room.getAllPlayers());
    if (allPlayers.length === 0) return null;
    // 轮流当画手
    const idx = this.roundCount % allPlayers.length;
    return allPlayers[idx];
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
    this.currentWord = this.pickRandomWord();
    this.winnerDecided = false;

    // 选画手
    const drawer = this.pickDrawer();
    if (!drawer) {
      this.endGame();
      return;
    }
    this.drawerUserId = drawer.userId;
    this.drawerNickName = drawer.nickName;

    // 告诉猜的人（不含画手）：画手是谁、提示字数
    this.onBroadcast(createMessage('drawguess_round', {
      round: this.roundCount,
      maxRounds: this.maxRounds,
      teamAScore: this.teamAScore,
      teamBScore: this.teamBScore,
      phase: 'drawing',
      isDrawer: false,
      drawerNickName: this.drawerNickName,
      hint: this.currentWord.length + '个字',
    }));

    // 单独告诉画手：词语内容
    this.sendToUser(this.drawerUserId, createMessage('drawguess_round', {
      round: this.roundCount,
      maxRounds: this.maxRounds,
      teamAScore: this.teamAScore,
      teamBScore: this.teamBScore,
      phase: 'drawing',
      isDrawer: true,
      word: this.currentWord,
      drawerNickName: this.drawerNickName,
      hint: this.currentWord.length + '个字',
    }));

    // 60秒超时
    this.guessTimeout = setTimeout(() => {
      this.endRound(null);
    }, 60000);
  }

  handleDraw(userId, drawData) {
    if (this.status !== GAME_STATUS.PLAYING) return;
    if (userId !== this.drawerUserId) return;

    // 广播画图数据给所有人（画手本地已绘制，服务端广播会再绘制，无视觉影响）
    this.onBroadcast(createMessage('drawguess_draw', drawData));
  }

  handleClear(userId) {
    if (this.status !== GAME_STATUS.PLAYING) return;
    if (userId !== this.drawerUserId) return;

    this.onBroadcast(createMessage('drawguess_clear', {
      userId: userId,
    }));
  }

  handleGuess(userId, teamId, guess) {
    if (this.status !== GAME_STATUS.PLAYING || this.winnerDecided) return;
    if (userId === this.drawerUserId) return; // 画手不能猜
    if (!teamId || (teamId !== TEAMS.A && teamId !== TEAMS.B)) return;

    const player = this.room.getPlayer(userId);
    const nickName = player ? player.nickName : userId;

    // 检查是否猜对（不区分大小写、忽略空格）
    const guessClean = guess.trim().replace(/\s+/g, '');
    const wordClean = this.currentWord.trim().replace(/\s+/g, '');

    if (guessClean === wordClean) {
      this.winnerDecided = true;
      if (this.guessTimeout) {
        clearTimeout(this.guessTimeout);
        this.guessTimeout = null;
      }

      const loserTeam = teamId === TEAMS.A ? TEAMS.B : TEAMS.A;

      // 广播猜对事件
      this.onBroadcast(createMessage('drawguess_correct', {
        teamId: teamId,
        userId: userId,
        nickName: nickName,
        word: this.currentWord,
        guess: guess,
      }));

      this.endRound(teamId, loserTeam);
    } else {
      // 广播猜测记录
      this.onBroadcast(createMessage('drawguess_attempt', {
        teamId: teamId,
        userId: userId,
        nickName: nickName,
        guess: guess,
      }));
    }
  }

  endRound(winnerTeam, loserTeam) {
    if (winnerTeam === TEAMS.A) this.teamAScore++;
    else if (winnerTeam === TEAMS.B) this.teamBScore++;

    this.onBroadcast(createMessage('drawguess_round_result', {
      round: this.roundCount,
      maxRounds: this.maxRounds,
      winner: winnerTeam,
      loser: loserTeam,
      teamAScore: this.teamAScore,
      teamBScore: this.teamBScore,
      correctWord: this.currentWord,
      drawerNickName: this.drawerNickName,
    }));

    // 延迟开始下一轮
    setTimeout(() => {
      if (this.status === GAME_STATUS.PLAYING) {
        this.startRound();
      }
    }, 4000);
  }

  endGame() {
    this.status = GAME_STATUS.FINISHED;

    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    if (this.guessTimeout) {
      clearTimeout(this.guessTimeout);
      this.guessTimeout = null;
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
      gameType: 'drawguess',
    }));

    if (this.onEnd) {
      this.onEnd();
    }
  }

  stop() {
    if (this.countdownInterval) clearInterval(this.countdownInterval);
    if (this.guessTimeout) clearTimeout(this.guessTimeout);
    this.status = GAME_STATUS.FINISHED;
  }

  handleTap(userId, teamId) {
    // 你画我猜不需要点击
  }

  handleInput(userId, teamId, input) {
    // 你画我猜使用猜测，不使用通用输入
  }
}

module.exports = DrawGuessGame;