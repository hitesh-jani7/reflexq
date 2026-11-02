// ReflexQ - live classroom MCQ quiz server
// Holds each game in memory. The teacher's browser also keeps its own copy of
// every response, so results can still be downloaded if the server restarts.

const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const HOST_PASSWORD = process.env.HOST_PASSWORD || '';
const MAX_PLAYERS = 400;

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 20000, pingTimeout: 40000, maxHttpBufferSize: 8e6 });

const pub = path.join(__dirname, 'public');
app.use(express.static(pub, { extensions: ['html'] }));
app.get('/vendor/xlsx.full.min.js', (req, res) => res.sendFile(require.resolve('xlsx/dist/xlsx.full.min.js')));
app.get('/health', (req, res) => res.send('ok'));

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}

function baseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const host = req.get('host') || '';
  if (/^(localhost|127\.0\.0\.1)(:|$)/.test(host)) {
    const ip = lanAddress();
    if (ip) return `http://${ip}:${PORT}`;
  }
  return `${req.protocol}://${host}`;
}

app.get('/info', (req, res) => res.json({ base: baseUrl(req), passwordRequired: !!HOST_PASSWORD }));

app.get('/qr/:pin.png', async (req, res) => {
  const pin = String(req.params.pin).replace(/\D/g, '').slice(0, 8);
  const url = `${baseUrl(req)}/play?pin=${pin}`;
  try {
    const png = await QRCode.toBuffer(url, { width: 700, margin: 1, errorCorrectionLevel: 'M' });
    res.type('png').set('Cache-Control', 'no-store').send(png);
  } catch (e) { res.status(500).send('QR error'); }
});

// ---------------------------------------------------------------- game state
const games = new Map();

function newPin() {
  let pin;
  do { pin = String(crypto.randomInt(100000, 1000000)); } while (games.has(pin));
  return pin;
}

function cleanText(s, max) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max); }

function sanitizeQuestions(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 200).map(q => {
    const options = (q.options || []).slice(0, 4).map(o => cleanText(o, 200));
    while (options.length && !options[options.length - 1]) options.pop();
    return {
      q: cleanText(q.q, 500),
      options,
      correct: Number(q.correct),
      time: Math.min(240, Math.max(5, Number(q.time) || 20)),
      image: /^https?:\/\//i.test(q.image || '') || /^data:image\//i.test(q.image || '') ? String(q.image) : ''
    };
  }).filter(q => q.q && q.options.length >= 2 && q.correct >= 0 && q.correct < q.options.length);
}

function playerList(g) {
  return [...g.players.values()].map(p => ({ id: p.id, name: p.name, roll: p.roll, score: p.score, connected: p.connected }));
}

function ranked(g) {
  return [...g.players.values()].sort((a, b) => b.score - a.score || a.totalTime - b.totalTime);
}

function touch(g) { g.lastActive = Date.now(); }

// Throttled lobby/player-count updates for the host (150 students join in seconds)
function pushPlayers(g) {
  if (g.pushTimer) return;
  g.pushTimer = setTimeout(() => {
    g.pushTimer = null;
    io.to(`host:${g.pin}`).emit('players', playerList(g));
  }, 400);
}

function pushAnswerCount(g) {
  if (g.countTimer) return;
  g.countTimer = setTimeout(() => {
    g.countTimer = null;
    const connected = [...g.players.values()].filter(p => p.connected).length;
    io.to(`host:${g.pin}`).emit('answerCount', { answered: g.answers.size, players: connected });
  }, 250);
}

function questionForHost(g) {
  const q = g.questions[g.current];
  return { index: g.current, total: g.questions.length, q: q.q, options: q.options, time: q.time, image: q.image,
    remainingMs: Math.max(0, g.qEnd - Date.now()) };
}

function questionForPlayer(g, p) {
  const q = g.questions[g.current];
  return { index: g.current, total: g.questions.length, nOptions: q.options.length,
    options: g.settings.showText ? q.options : null, q: g.settings.showText ? q.q : null,
    time: q.time, remainingMs: Math.max(0, g.qEnd - Date.now()), answered: p ? p.answers[g.current] != null : false };
}

function startQuestion(g) {
  g.current++;
  if (g.current >= g.questions.length) return finish(g);
  const q = g.questions[g.current];
  g.state = 'question';
  g.answers = new Map();
  g.qStart = Date.now() + 1500; // short "get ready" lead-in on screens
  g.qEnd = g.qStart + q.time * 1000;
  clearTimeout(g.timer);
  g.timer = setTimeout(() => endQuestion(g), g.qEnd - Date.now() + 400);
  io.to(`host:${g.pin}`).emit('question', questionForHost(g));
  for (const p of g.players.values()) if (p.socketId) io.to(p.socketId).emit('question', questionForPlayer(g, p));
  touch(g);
}

function endQuestion(g) {
  if (g.state !== 'question') return;
  clearTimeout(g.timer);
  g.state = 'reveal';
  const q = g.questions[g.current];
  const counts = q.options.map(() => 0);
  const responses = [];
  for (const [pid, a] of g.answers) {
    counts[a.choice]++;
    const p = g.players.get(pid);
    if (p) responses.push({ id: pid, name: p.name, roll: p.roll, choice: a.choice, correct: a.correct, ms: a.ms, points: a.points });
  }
  // Players who did not answer lose their streak
  for (const p of g.players.values()) if (p.answers[g.current] == null) p.streak = 0;

  const order = ranked(g);
  const rankOf = new Map(order.map((p, i) => [p.id, i + 1]));
  const correctCount = responses.filter(r => r.correct).length;
  io.to(`host:${g.pin}`).emit('reveal', {
    index: g.current, counts, correct: q.correct, answered: g.answers.size, players: g.players.size,
    correctCount, responses,
    roster: order.map(p => ({ id: p.id, name: p.name, roll: p.roll, score: p.score }))
  });
  for (const p of g.players.values()) {
    if (!p.socketId) continue;
    const a = p.answers[g.current];
    io.to(p.socketId).emit('result', {
      index: g.current, answered: a != null, correct: a ? a.correct : false, points: a ? a.points : 0,
      score: p.score, rank: rankOf.get(p.id), players: g.players.size, streak: p.streak,
      correctOption: q.correct, correctText: q.options[q.correct]
    });
  }
  touch(g);
}

function leaderboard(g) {
  g.state = 'leaderboard';
  const top = ranked(g).slice(0, 10).map(p => ({ name: p.name, roll: p.roll, score: p.score }));
  io.to(`host:${g.pin}`).emit('leaderboard', { index: g.current, total: g.questions.length, top });
  touch(g);
}

function finish(g) {
  clearTimeout(g.timer);
  g.state = 'ended';
  const order = ranked(g);
  io.to(`host:${g.pin}`).emit('final', {
    players: order.map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, roll: p.roll, score: p.score, answers: p.answers }))
  });
  order.forEach((p, i) => {
    if (p.socketId) io.to(p.socketId).emit('final', { rank: i + 1, score: p.score, players: order.length,
      correct: Object.values(p.answers).filter(a => a.correct).length, total: g.questions.length });
  });
  touch(g);
}

function hostSnapshot(g) {
  const snap = { pin: g.pin, state: g.state, settings: g.settings, questions: g.questions, current: g.current, players: playerList(g) };
  if (g.state === 'question') snap.question = questionForHost(g);
  return snap;
}

// ---------------------------------------------------------------- sockets
io.on('connection', socket => {
  let role = null, game = null, me = null;

  socket.on('host:create', (data, cb) => {
    cb = typeof cb === 'function' ? cb : () => {};
    if (HOST_PASSWORD && (data || {}).password !== HOST_PASSWORD) return cb({ error: 'Wrong teacher password.' });
    const questions = sanitizeQuestions((data || {}).questions);
    if (!questions.length) return cb({ error: 'No valid questions were found.' });
    const g = {
      pin: newPin(), hostToken: crypto.randomBytes(16).toString('hex'), questions,
      settings: { showText: !!(data.settings || {}).showText, title: cleanText((data.settings || {}).title, 120) },
      state: 'lobby', current: -1, players: new Map(), answers: new Map(), lastActive: Date.now()
    };
    games.set(g.pin, g);
    role = 'host'; game = g; socket.join(`host:${g.pin}`);
    cb({ pin: g.pin, hostToken: g.hostToken, questions: g.questions });
  });

  socket.on('host:resume', (data, cb) => {
    cb = typeof cb === 'function' ? cb : () => {};
    const g = games.get(String((data || {}).pin));
    if (!g || g.hostToken !== data.hostToken) return cb({ error: 'gone' });
    role = 'host'; game = g; socket.join(`host:${g.pin}`);
    cb({ ok: true, snapshot: hostSnapshot(g) });
  });

  const hostOnly = fn => (...args) => { if (role === 'host' && game) fn(game, ...args); };

  socket.on('host:next', hostOnly(g => {
    if (g.state === 'lobby' || g.state === 'leaderboard') startQuestion(g);
    else if (g.state === 'question') endQuestion(g);
    else if (g.state === 'reveal') {
      if (g.current >= g.questions.length - 1) finish(g); else leaderboard(g);
    }
  }));
  socket.on('host:skipToNext', hostOnly(g => { if (g.state === 'reveal') startQuestion(g); }));
  socket.on('host:finish', hostOnly(g => finish(g)));
  socket.on('host:setShowText', hostOnly((g, v) => { g.settings.showText = !!v; }));
  socket.on('host:kick', hostOnly((g, pid) => {
    const p = g.players.get(pid);
    if (!p) return;
    if (p.socketId) io.to(p.socketId).emit('kicked');
    g.players.delete(pid);
    pushPlayers(g);
  }));
  socket.on('host:end', hostOnly(g => {
    for (const p of g.players.values()) if (p.socketId) io.to(p.socketId).emit('gameClosed');
    clearTimeout(g.timer);
    games.delete(g.pin);
  }));

  socket.on('player:join', (data, cb) => {
    cb = typeof cb === 'function' ? cb : () => {};
    data = data || {};
    const g = games.get(String(data.pin || '').trim());
    if (!g) return cb({ error: 'Game not found. Check the PIN on the screen.' });
    const name = cleanText(data.name, 40);
    const roll = cleanText(data.roll, 30).toUpperCase();
    let p = data.playerId && g.players.get(data.playerId);
    if (!p) {
      if (!name || !roll) return cb({ error: 'Please enter your name and roll number.' });
      if (g.state === 'ended') return cb({ error: 'This quiz has already finished.' });
      const same = [...g.players.values()].find(x => x.roll === roll);
      if (same) {
        if (same.connected) return cb({ error: 'This roll number has already joined. Ask your teacher if this is a mistake.' });
        p = same; // same student re-joining from another phone or a cleared browser
      } else {
        if (g.players.size >= MAX_PLAYERS) return cb({ error: 'This game is full.' });
        p = { id: crypto.randomBytes(8).toString('hex'), name, roll, score: 0, streak: 0, totalTime: 0, answers: {}, connected: true };
        g.players.set(p.id, p);
      }
    }
    if (p.socketId && p.socketId !== socket.id) io.to(p.socketId).emit('replaced');
    p.socketId = socket.id; p.connected = true;
    role = 'player'; game = g; me = p;
    pushPlayers(g); touch(g);
    const state = { state: g.state };
    if (g.state === 'question') state.question = questionForPlayer(g, p);
    if (g.state === 'ended') {
      const order = ranked(g);
      state.final = { rank: order.indexOf(p) + 1, score: p.score, players: order.length,
        correct: Object.values(p.answers).filter(a => a.correct).length, total: g.questions.length };
    }
    cb({ ok: true, playerId: p.id, name: p.name, roll: p.roll, score: p.score, title: g.settings.title, ...state });
  });

  socket.on('player:answer', (data, cb) => {
    cb = typeof cb === 'function' ? cb : () => {};
    const g = game, p = me;
    if (role !== 'player' || !g || !p || !g.players.has(p.id)) return cb({ error: 'Not in a game' });
    if (g.state !== 'question' || Number(data && data.index) !== g.current) return cb({ error: 'Too late' });
    if (g.answers.has(p.id)) return cb({ ok: true, duplicate: true });
    const now = Date.now();
    if (now > g.qEnd + 300) return cb({ error: 'Too late' });
    const q = g.questions[g.current];
    const choice = Number(data.choice);
    if (!(choice >= 0 && choice < q.options.length)) return cb({ error: 'Bad choice' });
    const ms = Math.max(0, now - g.qStart);
    const correct = choice === q.correct;
    // Kahoot-style speed scoring: 1000 for an instant answer, falling to 500 at the buzzer
    let points = 0;
    if (correct) {
      const frac = Math.min(1, ms / (q.time * 1000));
      points = Math.round(1000 * (1 - frac / 2));
      p.streak++;
    } else p.streak = 0;
    const a = { choice, correct, ms, points };
    p.answers[g.current] = a;
    p.score += points;
    p.totalTime += ms;
    g.answers.set(p.id, a);
    cb({ ok: true });
    pushAnswerCount(g);
    const connected = [...g.players.values()].filter(x => x.connected).length;
    if (g.answers.size >= connected) setTimeout(() => endQuestion(g), 600);
  });

  socket.on('disconnect', () => {
    if (role === 'player' && game && me && me.socketId === socket.id) {
      me.connected = false; me.socketId = null;
      pushPlayers(game);
      if (game.state === 'question') pushAnswerCount(game);
    }
  });
});

// Remove games idle for more than 8 hours
setInterval(() => {
  const cutoff = Date.now() - 8 * 3600 * 1000;
  for (const [pin, g] of games) if (g.lastActive < cutoff) { clearTimeout(g.timer); games.delete(pin); }
}, 15 * 60 * 1000);

server.listen(PORT, () => {
  const ip = lanAddress();
  console.log(`ReflexQ is running.\n  Teacher screen: http://localhost:${PORT}/host` + (ip ? `\n  Students (same Wi-Fi): http://${ip}:${PORT}` : ''));
});
