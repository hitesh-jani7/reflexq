/* ReflexQ – student phone */
(() => {
  const $ = id => document.getElementById(id);
  const esc = window.RQ_esc, SH = window.RQ_SHAPES, L = window.RQ_LETTERS;
  const socket = io({ transports: ['websocket', 'polling'] });
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  const urlPin = (new URLSearchParams(location.search).get('pin') || '').replace(/\D/g, '');
  let saved = store.get('rq_player');
  if (saved && urlPin && saved.pin !== urlPin) saved = null;
  let me = null;           // { pin, playerId, name, roll }
  let score = 0;
  let curQ = null;
  let tick = null, readyT = null;

  function show(id) { for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id); }
  function setScore(v) { score = v; for (const id of ['wScore', 'qScore', 'sScore', 'rScore', 'fScore']) $(id).textContent = v; }
  function setName() { for (const id of ['wName', 'sName', 'rName', 'fName']) $(id).textContent = `${me.name} · ${me.roll}`; }
  function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }
  let wakeLock = null;
  async function keepAwake() { try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => wakeLock = null); } } catch (e) {} }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && me) keepAwake(); });

  // ------------------------------------------------------------ join
  if (urlPin) { $('pinIn').value = urlPin; $('pinIn').style.display = 'none'; }
  const lastId = store.get('rq_identity');
  if (lastId) { $('nameIn').value = lastId.name || ''; $('rollIn').value = lastId.roll || ''; }

  $('joinForm').onsubmit = e => {
    e.preventDefault();
    const pin = $('pinIn').value.replace(/\D/g, '');
    const name = $('nameIn').value.trim(), roll = $('rollIn').value.trim();
    if (!pin) return err('Enter the Game PIN shown on the screen.');
    if (!name) return err('Enter your name.');
    if (!roll) return err('Enter your roll number.');
    $('joinBtn').disabled = true; err('');
    join({ pin, name, roll }, true);
  };
  function err(t) { $('joinErr').textContent = t; }

  function join(data, fromForm) {
    socket.timeout(15000).emit('player:join', data, (e, res) => {
      $('joinBtn').disabled = false;
      if (e) { if (fromForm) err('The server is not responding. Please try again.'); return; }
      if (res.error) {
        if (fromForm) { err(res.error); show('joinScreen'); }
        else { store.del('rq_player'); me = null; show('joinScreen'); if (res.error.startsWith('Game not found')) message('Game ended', 'This quiz is no longer running.'); }
        return;
      }
      me = { pin: data.pin, playerId: res.playerId, name: res.name, roll: res.roll };
      store.set('rq_player', me);
      store.set('rq_identity', { name: res.name, roll: res.roll });
      setName(); setScore(res.score || 0);
      keepAwake();
      applyState(res);
    });
  }

  function applyState(res) {
    if (res.state === 'question' && res.question) onQuestion(res.question);
    else if (res.state === 'ended' && res.final) onFinal(res.final);
    else if (res.state === 'lobby') { $('wTitle').textContent = "You're in!"; $('wMsg').textContent = 'See your name on the screen?'; show('waitScreen'); }
    else { $('wTitle').textContent = "You're in!"; $('wMsg').textContent = 'Look at the screen – the next question is coming.'; show('waitScreen'); }
  }

  socket.on('connect', () => {
    $('offline').classList.add('hidden');
    const s = me || saved;
    if (s && s.playerId) join({ pin: s.pin, playerId: s.playerId, name: s.name, roll: s.roll }, false);
    saved = null;
  });
  socket.on('disconnect', () => { if (me) $('offline').classList.remove('hidden'); });

  // ------------------------------------------------------------ questions
  function onQuestion(q) {
    curQ = q;
    clearInterval(tick); clearTimeout(readyT);
    const end = Date.now() + q.remainingMs;
    $('qNum').textContent = `${q.index + 1} of ${q.total}`;
    if (q.answered) { showSent(null); return; }
    const box = $('answers');
    box.className = 'answers' + (q.options ? ' text' : q.nOptions === 2 ? ' two' : '');
    box.innerHTML = Array.from({ length: q.nOptions }, (_, k) =>
      `<button class="ans c${k}" data-k="${k}">${SH[k]}${q.options ? `<span>${esc(q.options[k])}</span>` : ''}</button>`).join('');
    $('qTxt').classList.toggle('hidden', !q.q);
    $('qTxt').textContent = q.q || '';
    const t = () => {
      const rem = Math.max(0, end - Date.now());
      $('tLeft').textContent = Math.ceil(Math.min(rem, q.time * 1000) / 1000);
      if (rem <= 0) { clearInterval(tick); for (const b of box.children) b.disabled = true; }
    };
    t(); tick = setInterval(t, 200);
    const lead = q.remainingMs - q.time * 1000;
    if (lead > 200) {
      $('rNum').textContent = `Question ${q.index + 1} of ${q.total}`;
      show('readyScreen');
      readyT = setTimeout(() => show('qScreen'), lead);
    } else show('qScreen');
  }
  socket.on('question', onQuestion);

  $('answers').addEventListener('click', e => {
    const b = e.target.closest('.ans'); if (!b || b.disabled || !curQ) return;
    const k = +b.dataset.k;
    for (const x of $('answers').children) x.disabled = true;
    vibrate(30);
    showSent(k);
    socket.timeout(8000).emit('player:answer', { index: curQ.index, choice: k }, (e2, res) => {
      if (e2) {
        // not acknowledged – re-enable so the student can try again if time is left
        for (const x of $('answers').children) x.disabled = false;
        show('qScreen');
        return;
      }
      if (res && res.error) { $('sTitle').textContent = res.error === 'Too late' ? "Time's up!" : res.error; }
    });
  });

  function showSent(k) {
    clearTimeout(readyT);
    $('sTitle').textContent = 'Answer locked in';
    $('chosen').className = 'chosen' + (k != null ? ` c${k}` : '');
    $('chosen').innerHTML = k != null ? SH[k] : '';
    $('chosen').style.display = k != null ? '' : 'none';
    show('sentScreen');
  }

  // ------------------------------------------------------------ results
  const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  socket.on('result', r => {
    clearInterval(tick); clearTimeout(readyT);
    setScore(r.score);
    const scr = $('resScreen');
    scr.className = 'screen ' + (!r.answered ? 'none' : r.correct ? 'ok' : 'bad');
    $('resTitle').textContent = !r.answered ? "Time's up" : r.correct ? 'Correct' : 'Incorrect';
    $('resIcon').textContent = r.correct ? '✔' : '✖';
    $('resPts').textContent = r.correct ? `+ ${r.points}` : '+ 0';
    $('resStreak').textContent = r.correct && r.streak >= 2 ? `Answer streak: ${r.streak}` : '';
    $('resAns').innerHTML = r.correct ? '' : `Correct answer: <b>${L[r.correctOption]}. ${esc(r.correctText)}</b>`;
    $('resRank').textContent = `You are in ${ordinal(r.rank)} place of ${r.players}`;
    vibrate(r.correct ? [40, 60, 40] : 200);
    show('resScreen');
  });

  function onFinal(f) {
    clearInterval(tick);
    setScore(f.score);
    $('fRank').textContent = ordinal(f.rank);
    $('fOf').textContent = `of ${f.players} students`;
    $('fPts').textContent = `${f.score} points`;
    $('fCorrect').textContent = `${f.correct} of ${f.total} correct`;
    show('finalScreen');
  }
  socket.on('final', onFinal);

  function message(title, text) {
    $('mTitle').textContent = title; $('mText').textContent = text;
    show('msgScreen');
  }
  $('mBtn').onclick = () => { location.href = '/play'; };
  socket.on('kicked', () => { store.del('rq_player'); me = null; message('Removed', 'The teacher removed you from this game.'); });
  socket.on('gameClosed', () => { store.del('rq_player'); me = null; message('Game closed', 'The teacher has closed this game.'); });
  socket.on('replaced', () => { me = null; message('Joined elsewhere', 'You are now playing from another device or tab.'); });

  if (!saved) show('joinScreen');
  else { show('waitScreen'); $('wTitle').textContent = 'Reconnecting…'; $('wMsg').textContent = ''; }
})();
