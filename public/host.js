/* ReflexQ – teacher screen */
(() => {
  const $ = id => document.getElementById(id);
  const esc = window.RQ_esc, SH = window.RQ_SHAPES, L = window.RQ_LETTERS;
  const COLORS = ['var(--red)', 'var(--blue)', 'var(--yellow)', 'var(--green)'];
  const socket = io({ transports: ['websocket', 'polling'] });

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  let questions = [];
  let session = store.get('rq_session', null); // { pin, hostToken }
  let state = 'setup';
  let current = -1;
  let rec = null; // this game's local record of everything
  let tickTimer = null;
  let info = { base: location.origin, passwordRequired: false };
  let lockUntil = 0; // ignores an accidental double-press that would skip a fresh question

  // ------------------------------------------------------------ helpers
  function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
  }
  function saveRec() {
    if (!rec) return;
    if (!store.set('rq_rec_' + rec.pin, rec)) {
      // storage full (usually images) – keep results, drop images
      const slim = { ...rec, questions: rec.questions.map(q => ({ ...q, image: '' })) };
      store.set('rq_rec_' + rec.pin, slim);
    }
    const hist = store.get('rq_history', []).filter(p => p !== rec.pin);
    hist.unshift(rec.pin);
    for (const old of hist.splice(25)) store.del('rq_rec_' + old);
    store.set('rq_history', hist);
  }
  function fmtDate(d) { return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function toggleFs() {
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {});
  }
  $('fsBtn1').onclick = toggleFs; $('fsBtn2').onclick = toggleFs;

  // keep a free cloud server awake while this screen is open
  setInterval(() => fetch('/health', { cache: 'no-store' }).catch(() => {}), 4 * 60 * 1000);

  fetch('/info').then(r => r.json()).then(j => {
    info = j;
    $('pwField').classList.toggle('hidden', !j.passwordRequired);
  }).catch(() => {});

  // ------------------------------------------------------------ setup: loading questions
  const SAMPLE = [
    { q: 'The normal resting membrane potential of a ventricular muscle fibre is about:', options: ['-90 mV', '-70 mV', '-55 mV', '+30 mV'], correct: 0, time: 20 },
    { q: 'The normal pacemaker of the human heart is the:', options: ['AV node', 'SA node', 'Bundle of His', 'Purkinje fibres'], correct: 1, time: 20 },
    { q: 'Glucagon is secreted by which cells of the pancreatic islets?', options: ['Beta cells', 'Delta cells', 'Alpha cells', 'PP cells'], correct: 2, time: 20 },
    { q: 'Tidal volume of a healthy adult at rest is approximately:', options: ['150 mL', '500 mL', '1200 mL', '3000 mL'], correct: 1, time: 20 },
    { q: 'Most of the carbon dioxide in blood is transported as:', options: ['Dissolved CO2', 'Carbaminohaemoglobin', 'Carbonic acid', 'Bicarbonate ions'], correct: 3, time: 20 },
    { q: 'A rise in body temperature shifts the oxygen–haemoglobin dissociation curve to the right.', options: ['True', 'False'], correct: 0, time: 15 }
  ];

  function setQuestions(list, title, msg) {
    questions = list;
    if (title && !$('title').value) $('title').value = title;
    store.set('rq_lastQuiz', { title: $('title').value, questions }) ||
      store.set('rq_lastQuiz', { title: $('title').value, questions: questions.map(q => ({ ...q, image: /^data:/.test(q.image) ? '' : q.image })) });
    renderPreview();
    if (msg) $('parseMsg').innerHTML = msg;
  }

  function renderPreview() {
    $('previewCard').style.display = questions.length ? '' : 'none';
    $('qCountTitle').textContent = `${questions.length} question${questions.length === 1 ? '' : 's'}`;
    $('qlist').innerHTML = questions.map((q, i) => `
      <div class="qitem">
        <div class="n">${i + 1}</div>
        <div><div class="t">${esc(q.q)}</div>
          <div class="o">${q.options.map((o, k) => k === q.correct ? `<b>${L[k]}. ${esc(o)} ✓</b>` : `${L[k]}. ${esc(o)}`).join(' &nbsp; ')}</div>
          ${q.image ? `<img src="${esc(q.image)}" style="max-height:70px;margin-top:6px;border-radius:4px">` : ''}</div>
        <div style="display:grid;gap:6px;justify-items:end">
          <span class="tm">${q.time}s</span>
          <a href="#" class="link" style="font-size:13px" data-img="${i}">${q.image ? 'Change image' : 'Add image'}</a>
          ${q.image ? `<a href="#" class="link" style="font-size:13px;color:var(--bad)" data-noimg="${i}">Remove</a>` : ''}
        </div>
      </div>`).join('');
  }

  $('qlist').addEventListener('click', e => {
    const a = e.target.closest('a'); if (!a) return;
    e.preventDefault();
    if (a.dataset.noimg != null) { questions[+a.dataset.noimg].image = ''; setQuestions(questions); return; }
    const i = +a.dataset.img;
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => inp.files[0] && shrinkImage(inp.files[0]).then(url => { questions[i].image = url; setQuestions(questions); });
    inp.click();
  });

  function shrinkImage(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, 1280 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        res(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }

  function parseWorkbook(buf) {
    const wb = XLSX.read(buf, { type: 'array' });
    const name = wb.SheetNames.find(n => /question/i.test(n)) || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
    let start = 0;
    for (let i = 0; i < Math.min(10, rows.length); i++) if (/question/i.test(String(rows[i][0] || ''))) { start = i + 1; break; }
    const out = [], errs = [];
    const cell = (row, k) => String(row[k] == null ? '' : row[k]).trim();
    for (let r = start; r < rows.length; r++) {
      const row = rows[r] || [];
      if (row.every(c => String(c == null ? '' : c).trim() === '')) continue;
      const q = cell(row, 0);
      const opts = [1, 2, 3, 4].map(k => cell(row, k));
      while (opts.length && !opts[opts.length - 1]) opts.pop();
      if (!q) { errs.push(`Row ${r + 1}: the question is empty.`); continue; }
      if (opts.length < 2 || opts.some(o => !o)) { errs.push(`Row ${r + 1}: fill at least Option A and Option B, without gaps.`); continue; }
      const c = cell(row, 5);
      let idx = -1;
      if (/^[A-Da-d]$/.test(c)) idx = c.toUpperCase().charCodeAt(0) - 65;
      else if (/^[1-4]$/.test(c)) idx = +c - 1;
      else idx = opts.findIndex(o => o.toLowerCase() === c.toLowerCase());
      if (idx < 0 || idx >= opts.length) { errs.push(`Row ${r + 1}: correct answer "${c}" must be A, B, C or D (an option that is filled in).`); continue; }
      const t = parseInt(cell(row, 6), 10);
      out.push({ q, options: opts, correct: idx, time: t >= 5 && t <= 240 ? t : 20, image: cell(row, 7) });
    }
    return { out, errs };
  }

  function loadFile(file) {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const { out, errs } = parseWorkbook(new Uint8Array(fr.result));
        const base = file.name.replace(/\.(xlsx|xls|csv)$/i, '').replace(/[_-]+/g, ' ');
        if (!out.length) { $('parseMsg').innerHTML = `<div class="err">No questions could be read from ${esc(file.name)}.\n${esc(errs.slice(0, 8).join('\n'))}</div>`; return; }
        setQuestions(out, base === 'ReflexQ Questions Template' ? '' : base,
          `<div class="msg">Loaded ${out.length} questions from ${esc(file.name)}.</div>` +
          (errs.length ? `<div class="err" style="margin-top:6px">${errs.length} row(s) skipped:\n${esc(errs.slice(0, 8).join('\n'))}${errs.length > 8 ? '\n…' : ''}</div>` : ''));
      } catch (e) {
        $('parseMsg').innerHTML = `<div class="err">Could not read that file. Please use the ReflexQ Excel template.</div>`;
      }
    };
    fr.readAsArrayBuffer(file);
  }

  const drop = $('drop');
  drop.onclick = e => { if (!e.target.closest('a')) $('file').click(); };
  $('file').onchange = () => { if ($('file').files[0]) loadFile($('file').files[0]); $('file').value = ''; };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); };
  $('sampleLink').onclick = e => { e.preventDefault(); $('title').value = 'Sample – General Physiology'; setQuestions(SAMPLE.map(q => ({ ...q, image: '' })), '', '<div class="msg">Sample quiz loaded.</div>'); };
  $('title').oninput = () => store.set('rq_lastQuiz', { title: $('title').value, questions });

  const last = store.get('rq_lastQuiz', null);
  if (last && last.questions && last.questions.length) {
    $('title').value = last.title || '';
    questions = last.questions;
    renderPreview();
    $('parseMsg').innerHTML = `<div class="msg">Your last question set is loaded. Choose a new file to replace it.</div>`;
  }

  function renderHistory() {
    const hist = store.get('rq_history', []).map(p => store.get('rq_rec_' + p, null)).filter(Boolean);
    $('historyCard').style.display = hist.length ? '' : 'none';
    $('history').innerHTML = hist.map(r => `<a href="#" class="link" data-pin="${r.pin}">${esc(r.title || 'Untitled quiz')} — ${fmtDate(r.date)} — ${Object.keys(r.roster || {}).length} students · Download Excel</a>`).join('');
  }
  $('history').onclick = e => {
    const a = e.target.closest('a[data-pin]'); if (!a) return;
    e.preventDefault();
    const r = store.get('rq_rec_' + a.dataset.pin, null);
    if (r) exportExcel(r);
  };
  renderHistory();

  // ------------------------------------------------------------ create / resume
  $('createBtn').onclick = () => {
    if (!questions.length) return;
    $('createBtn').disabled = true; $('createErr').textContent = '';
    socket.timeout(15000).emit('host:create', {
      questions, password: $('password').value,
      settings: { showText: $('showText').checked, title: $('title').value.trim() }
    }, (err, res) => {
      $('createBtn').disabled = false;
      if (err) { $('createErr').textContent = 'The server did not respond. If it was asleep, wait a minute and try again.'; return; }
      if (res.error) { $('createErr').textContent = res.error; return; }
      session = { pin: res.pin, hostToken: res.hostToken };
      store.set('rq_session', session);
      rec = { pin: res.pin, title: $('title').value.trim(), date: Date.now(), questions: res.questions, responses: {}, roster: {}, final: null };
      saveRec();
      enterLobby([], $('showText').checked);
    });
  };

  function enterLobby(players, showText) {
    state = 'lobby';
    $('pin').textContent = session.pin;
    $('qr').src = `/qr/${session.pin}.png`;
    $('joinUrl').textContent = info.base.replace(/^https?:\/\//, '');
    $('lobbyTitle').textContent = (rec && rec.title) || 'ReflexQ';
    $('showText2').checked = !!showText;
    chips.clear(); $('names').innerHTML = '<div class="waiting" id="waitingText">Waiting for students to join…</div>';
    renderPlayers(players);
    show('lobby');
  }

  $('showText2').onchange = () => socket.emit('host:setShowText', $('showText2').checked);
  $('cancelBtn').onclick = () => {
    if (!confirm('Cancel this game? Students will be disconnected.')) return;
    socket.emit('host:end');
    endSession();
  };
  function endSession() {
    store.del('rq_session'); session = null; state = 'setup';
    clearInterval(tickTimer);
    renderHistory();
    show('setup');
  }

  socket.on('connect', () => {
    $('offline').classList.add('hidden');
    if (!session) return;
    socket.emit('host:resume', session, res => {
      if (!res || res.error) {
        const r = store.get('rq_rec_' + session.pin, null);
        store.del('rq_session'); session = null;
        if (r && Object.keys(r.responses).length) { rec = r; showFinal(); }
        else show('setup');
        return;
      }
      const s = res.snapshot;
      rec = store.get('rq_rec_' + s.pin, null) || { pin: s.pin, title: s.settings.title, date: Date.now(), questions: s.questions, responses: {}, roster: {}, final: null };
      current = s.current;
      if (s.state === 'lobby') enterLobby(s.players, s.settings.showText);
      else if (s.state === 'question') { renderPlayers(s.players); showQuestion(s.question); }
      else if (s.state === 'ended') showFinal();
      else {
        state = 'leaderboard';
        $('board').innerHTML = `<h2>Quiz paused</h2><div class="lrow" style="justify-content:center">Press “Next” to continue from question ${current + 2 > s.questions.length ? s.questions.length : current + 2}</div>`;
        $('lbNext').textContent = current >= s.questions.length - 1 ? 'Show final results ▸' : 'Next question ▸';
        show('leader');
      }
    });
  });
  socket.on('disconnect', () => { if (session) $('offline').classList.remove('hidden'); });

  // ------------------------------------------------------------ lobby players
  const chips = new Map();
  let playersCache = [];
  function renderPlayers(list) {
    playersCache = list;
    const n = list.length;
    $('pcount').textContent = n;
    $('startBtn').disabled = n === 0;
    if (state !== 'lobby') return;
    const names = $('names');
    const w = $('waitingText'); if (w) w.style.display = n ? 'none' : '';
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      let el = chips.get(p.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'chip'; el.dataset.id = p.id;
        el.innerHTML = `${esc(p.name)}<small>${esc(p.roll)}</small>`;
        el.title = 'Click to remove';
        names.appendChild(el); chips.set(p.id, el);
      }
      el.classList.toggle('off', !p.connected);
    }
    for (const [id, el] of chips) if (!seen.has(id)) { el.remove(); chips.delete(id); }
  }
  $('names').onclick = e => {
    const c = e.target.closest('.chip'); if (!c) return;
    const p = playersCache.find(x => x.id === c.dataset.id);
    if (p && confirm(`Remove ${p.name} (${p.roll}) from the game?`)) socket.emit('host:kick', p.id);
  };
  socket.on('players', renderPlayers);
  $('startBtn').onclick = () => socket.emit('host:next');

  // ------------------------------------------------------------ question
  function showQuestion(q) {
    state = 'question'; current = q.index;
    show('question');
    $('qtext').textContent = q.q;
    $('qnum').textContent = `${q.index + 1} / ${q.total}`;
    $('qhint').textContent = 'Press Space or → to stop the timer early';
    $('qNext').textContent = 'Skip ▸';
    $('timer').style.visibility = '';
    $('rightBox').innerHTML = `<div class="big" id="acount">0</div>Answers`;
    $('qmid').innerHTML = q.image ? `<img src="${esc(q.image)}" alt="">` : '';
    $('tiles').innerHTML = q.options.map((o, k) => `<div class="tile c${k}" data-k="${k}">${SH[k]}<span>${esc(o)}</span><span class="mark"></span></div>`).join('');
    const end = Date.now() + q.remainingMs;
    const lead = q.remainingMs - q.time * 1000;
    lockUntil = Date.now() + Math.max(0, lead) + 2000;
    if (lead > 200) {
      $('grLabel').textContent = `Question ${q.index + 1} of ${q.total}`;
      $('getready').classList.remove('hidden');
      setTimeout(() => $('getready').classList.add('hidden'), lead);
    } else $('getready').classList.add('hidden');
    clearInterval(tickTimer);
    const tick = () => {
      const rem = Math.max(0, end - Date.now());
      const secs = Math.ceil(Math.min(rem, q.time * 1000) / 1000);
      $('timer').textContent = secs;
      $('timer').classList.toggle('low', secs <= 5 && secs > 0);
      if (rem <= 0) clearInterval(tickTimer);
    };
    tick(); tickTimer = setInterval(tick, 200);
  }
  socket.on('question', showQuestion);
  socket.on('answerCount', d => { const el = $('acount'); if (el) el.textContent = d.answered; });

  socket.on('reveal', d => {
    state = 'reveal'; current = d.index;
    clearInterval(tickTimer);
    $('timer').textContent = '0'; $('timer').classList.remove('low'); $('timer').style.visibility = 'hidden';
    $('getready').classList.add('hidden');
    show('question');
    const q = rec.questions[d.index] || { options: d.counts.map((_, k) => L[k]) };
    if (!$('tiles').children.length) {
      $('qtext').textContent = q.q || '';
      $('tiles').innerHTML = q.options.map((o, k) => `<div class="tile c${k}">${SH[k]}<span>${esc(o)}</span><span class="mark"></span></div>`).join('');
    }
    [...$('tiles').children].forEach((t, k) => {
      t.classList.toggle('dim', k !== d.correct);
      t.querySelector('.mark').textContent = k === d.correct ? '✔' : '✖';
    });
    const max = Math.max(1, ...d.counts);
    $('qmid').innerHTML = `<div class="chart">${d.counts.map((c, k) => `
      <div class="bar ${k === d.correct ? '' : 'wrong'}">
        <div class="val">${k === d.correct ? '✔ ' : ''}${c}</div>
        <div class="fill c${k}" data-h="${Math.round(c / max * 100)}"></div>
        <div class="foot c${k}">${SH[k]}</div>
      </div>`).join('')}</div>`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      for (const f of $('qmid').querySelectorAll('.fill')) f.style.height = `calc((100% - 90px) * ${f.dataset.h / 100})`;
    }));
    const pct = d.players ? Math.round(d.correctCount / d.players * 100) : 0;
    $('rightBox').innerHTML = `<div class="summary">${pct}%<small>correct<br>${d.correctCount} of ${d.players}</small></div>`;
    const lastQ = d.index >= rec.questions.length - 1;
    $('qNext').textContent = lastQ ? 'Final results ▸' : 'Next ▸';
    $('qhint').textContent = `${d.answered} answered · ${d.players - d.answered} did not answer`;

    rec.responses[d.index] = d.responses;
    for (const p of d.roster) rec.roster[p.id] = { name: p.name, roll: p.roll };
    saveRec();
  });

  $('qNext').onclick = () => {
    if (state === 'question' && Date.now() < lockUntil) return;
    socket.emit('host:next');
  };

  // ------------------------------------------------------------ leaderboard
  socket.on('leaderboard', d => {
    state = 'leaderboard';
    $('board').innerHTML = `<h2>Scoreboard</h2>` + (d.top.length ? d.top.map((p, i) =>
      `<div class="lrow" style="animation-delay:${i * 60}ms"><span class="rk">${i + 1}</span><span>${esc(p.name)} <span class="roll">${esc(p.roll)}</span></span><span class="sc">${p.score}</span></div>`).join('')
      : '<div class="lrow">No students yet</div>');
    $('lbProgress').textContent = `${d.index + 1} of ${d.total} done`;
    $('lbNext').textContent = 'Next question ▸';
    show('leader');
  });
  $('lbNext').onclick = () => socket.emit('host:next');

  // ------------------------------------------------------------ final
  socket.on('final', d => {
    rec.final = d.players.map(p => ({ id: p.id, name: p.name, roll: p.roll, score: p.score, answers: p.answers }));
    for (const p of d.players) rec.roster[p.id] = { name: p.name, roll: p.roll };
    saveRec();
    store.del('rq_session'); session = null;
    showFinal();
  });

  function computeResults(r) {
    const nQ = r.questions.length;
    const students = new Map();
    const ensure = (id, name, roll) => {
      if (!students.has(id)) students.set(id, { id, name, roll, score: 0, answers: {}, time: 0 });
      return students.get(id);
    };
    if (r.final) {
      for (const p of r.final) {
        const s = ensure(p.id, p.name, p.roll);
        s.answers = p.answers || {};
      }
    }
    for (const [qi, list] of Object.entries(r.responses || {})) {
      for (const a of list) {
        const s = ensure(a.id, a.name, a.roll);
        if (!s.answers[qi]) s.answers[qi] = { choice: a.choice, correct: a.correct, ms: a.ms, points: a.points };
      }
    }
    for (const [id, p] of Object.entries(r.roster || {})) ensure(id, p.name, p.roll);
    const list = [...students.values()];
    for (const s of list) {
      const a = Object.values(s.answers);
      s.score = a.reduce((t, x) => t + (x.points || 0), 0);
      s.correct = a.filter(x => x.correct).length;
      s.attempted = a.length;
      s.time = a.reduce((t, x) => t + (x.ms || 0), 0);
    }
    list.sort((a, b) => b.score - a.score || a.time - b.time);
    list.forEach((s, i) => s.rank = i + 1);
    const asked = Object.keys(r.responses || {}).map(Number).concat(r.final ? r.questions.map((_, i) => i) : []);
    const askedSet = new Set(asked.filter(i => i < nQ));
    const perQ = r.questions.map((q, i) => {
      const counts = q.options.map(() => 0); let correct = 0, answered = 0, ms = 0;
      for (const s of list) { const a = s.answers[i]; if (a) { answered++; counts[a.choice]++; ms += a.ms || 0; if (a.correct) correct++; } }
      return { i, q, counts, correct, answered, avgMs: answered ? ms / answered : 0, asked: askedSet.has(i),
        pct: list.length ? Math.round(correct / list.length * 100) : 0 };
    });
    return { list, perQ };
  }

  function showFinal() {
    state = 'ended';
    clearInterval(tickTimer);
    const { list, perQ } = computeResults(rec);
    $('finalTitle').textContent = rec.title || 'ReflexQ';
    const top = [list[1], list[0], list[2]];
    const heights = [190, 250, 150], medals = ['#9aa3ad', '#d4a017', '#b0703c'], places = [2, 1, 3];
    $('podium').innerHTML = top.map((p, k) => p ? `
      <div class="pod"><div class="who">${esc(p.name)}<small>${esc(p.roll)}</small></div>
        <div class="block" style="height:${heights[k]}px;animation-delay:${[300, 700, 0][k]}ms">
          <div class="medal" style="background:${medals[k]}">${places[k]}</div><div class="pts">${p.score}</div></div></div>` : '<div class="pod"></div>').join('');
    const askedQ = perQ.filter(x => x.asked);
    const avgScore = list.length ? Math.round(list.reduce((t, s) => t + s.score, 0) / list.length) : 0;
    const acc = list.length && askedQ.length ? Math.round(list.reduce((t, s) => t + s.correct, 0) / (list.length * askedQ.length) * 100) : 0;
    const kpi = (v, l) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`;
    $('kpis').innerHTML = kpi(list.length, 'Students') + kpi(`${askedQ.length}/${rec.questions.length}`, 'Questions asked') + kpi(`${acc}%`, 'Class accuracy') + kpi(avgScore, 'Average score');
    $('qbars').innerHTML = askedQ.map(x => {
      const col = x.pct >= 70 ? 'var(--green)' : x.pct >= 40 ? 'var(--yellow)' : 'var(--red)';
      return `<div class="qbar" title="${esc(x.q.q)}"><span class="lab">Q${x.i + 1}</span>
        <div class="track"><div class="fillq" style="width:0;background:${col}" data-w="${x.pct}"></div></div>
        <span class="pct">${x.pct}%</span></div>`;
    }).join('') || '<div class="legend">No questions were answered.</div>';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      for (const f of $('qbars').querySelectorAll('.fillq')) f.style.width = f.dataset.w + '%';
    }));
    renderTable(list, askedQ.length);
    $('search').value = '';
    $('search').oninput = () => {
      const t = $('search').value.toLowerCase();
      renderTable(list.filter(s => s.name.toLowerCase().includes(t) || s.roll.toLowerCase().includes(t)), askedQ.length);
    };
    show('final');
  }

  function renderTable(list, nAsked) {
    $('fullTable').innerHTML = `<tr><th>Rank</th><th>Name</th><th>Roll no.</th><th class="num">Score</th><th class="num">Correct</th><th class="num">Answered</th><th class="num">Accuracy</th></tr>` +
      list.map(s => `<tr><td>${s.rank}</td><td>${esc(s.name)}</td><td>${esc(s.roll)}</td><td class="num">${s.score}</td><td class="num">${s.correct}</td><td class="num">${s.attempted}/${nAsked}</td><td class="num">${nAsked ? Math.round(s.correct / nAsked * 100) : 0}%</td></tr>`).join('');
  }

  $('dlBtn').onclick = () => exportExcel(rec);
  $('newBtn').onclick = () => { rec = null; endSession(); };

  // ------------------------------------------------------------ Excel export
  function exportExcel(r) {
    const { list, perQ } = computeResults(r);
    const askedQ = perQ.filter(x => x.asked);
    const nAsked = askedQ.length;
    const wb = XLSX.utils.book_new();

    const s1 = [['Rank', 'Name', 'Roll No.', 'Score', 'Correct', 'Answered', `Accuracy % (of ${nAsked})`, 'Avg answer time (s)']]
      .concat(list.map(s => [s.rank, s.name, s.roll, s.score, s.correct, s.attempted, nAsked ? Math.round(s.correct / nAsked * 100) : 0,
        s.attempted ? +(s.time / s.attempted / 1000).toFixed(1) : '']));
    const ws1 = XLSX.utils.aoa_to_sheet(s1);
    ws1['!cols'] = [{ wch: 6 }, { wch: 28 }, { wch: 14 }, { wch: 8 }, { wch: 9 }, { wch: 10 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws1, 'Students');

    const s2 = [['Q No.', 'Question', 'Correct answer', 'Students', 'Answered', 'Correct', '% correct', 'Avg time (s)', 'Chose A', 'Chose B', 'Chose C', 'Chose D']]
      .concat(askedQ.map(x => [x.i + 1, x.q.q, `${L[x.q.correct]}. ${x.q.options[x.q.correct]}`, list.length, x.answered, x.correct, x.pct,
        +(x.avgMs / 1000).toFixed(1), x.counts[0] ?? '', x.counts[1] ?? '', x.counts[2] ?? '', x.counts[3] ?? '']));
    const ws2 = XLSX.utils.aoa_to_sheet(s2);
    ws2['!cols'] = [{ wch: 6 }, { wch: 60 }, { wch: 28 }, { wch: 9 }, { wch: 9 }, { wch: 8 }, { wch: 9 }, { wch: 11 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Question analysis');

    const head = ['Roll No.', 'Name'].concat(askedQ.map(x => `Q${x.i + 1}`), ['Total correct', 'Score']);
    const s3 = [head].concat([...list].sort((a, b) => a.roll.localeCompare(b.roll, undefined, { numeric: true })).map(s =>
      [s.roll, s.name].concat(askedQ.map(x => { const a = s.answers[x.i]; return a ? `${L[a.choice]} ${a.correct ? '✓' : '✗'}` : '–'; }), [s.correct, s.score])));
    const ws3 = XLSX.utils.aoa_to_sheet(s3);
    ws3['!cols'] = [{ wch: 14 }, { wch: 26 }].concat(askedQ.map(() => ({ wch: 6 })), [{ wch: 12 }, { wch: 8 }]);
    XLSX.utils.book_append_sheet(wb, ws3, 'Answer sheet');

    const s4 = [['Q No.', 'Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct', 'Time (s)']]
      .concat(r.questions.map((q, i) => [i + 1, q.q, q.options[0] || '', q.options[1] || '', q.options[2] || '', q.options[3] || '', L[q.correct], q.time]));
    const ws4 = XLSX.utils.aoa_to_sheet(s4);
    ws4['!cols'] = [{ wch: 6 }, { wch: 60 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 8 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws4, 'Questions');

    const d = new Date(r.date);
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const safe = (r.title || 'Quiz').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 50) || 'Quiz';
    XLSX.writeFile(wb, `ReflexQ_${safe}_${stamp}.xlsx`);
  }

  // ------------------------------------------------------------ keyboard
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea')) return;
    if (![' ', 'Enter', 'ArrowRight'].includes(e.key)) return;
    const btn = state === 'lobby' ? $('startBtn') : (state === 'question' || state === 'reveal') ? $('qNext') : state === 'leaderboard' ? $('lbNext') : null;
    if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
  });

  if (!session) show('setup');
})();
