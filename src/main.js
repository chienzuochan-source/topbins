import { Match, SKILL, NO_INPUT } from './game/Match.js';
import { Input, TouchControls, isTouch } from './game/Input.js';
import { Scene } from './render/Scene.js';
import { HUD } from './ui/HUD.js';
import { Sfx } from './audio/Sfx.js';
import { Online, normalizeCode } from './net/Online.js';
import { snapshot, applySnapshot, extrapolate, InputBuffer, RemoteInput } from './net/sync.js';

const $ = (s) => document.querySelector(s);

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

// Saved settings. Storage can be missing (private windows), so never rely on it.
const store = {
  get(k, d) {
    try {
      return localStorage.getItem(`topbins.${k}`) ?? d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(`topbins.${k}`, v);
    } catch {
      // Not saved; fine.
    }
  },
};

const SKILL_WORDS = {
  easy: 'Slower players, soft tackles, wild shooting and a shaky keeper.',
  normal: 'A fair game.',
  hard: 'Quicker, sharper, tackles hard and slides in. Their keeper stops more.',
  legend: 'Fast, clinical, tackles like a wall. Good luck.',
};
const SEND_MS = 33; // online: ~30 messages a second each way

if (!webglAvailable()) {
  $('#home').classList.remove('show');
  $('#nogl').classList.add('show');
} else {
  const touch = isTouch();
  document.body.classList.toggle('touch', touch);

  // Behind the menus, the computer plays itself.
  let match = new Match({ demo: true });
  const scene = new Scene($('#scene'), match, { lite: touch });
  const hud = new HUD($('#hud'), match);
  const input = new Input();
  const touchUI = new TouchControls($('#touch'), input);
  const sfx = new Sfx();

  // mode: 'demo' | 'cpu' | 'local2' | 'host' | 'guest'
  let mode = 'demo', paused = false, mySide = 0;
  let online = null, remote = null, outBuf = null, lastSend = 0, eventsOut = [];
  window.topBins = { get match() { return match; }, get mode() { return mode; } }; // handy from the console

  // ---------------------------------------------------------------- settings
  let skill = store.get('skill', 'normal');
  let length = Number(store.get('length', 240));
  if (!SKILL[skill]) skill = 'normal';
  if (![120, 240, 360].includes(length)) length = 240;
  const seg = (id, get, set) => {
    const btns = [...$(id).querySelectorAll('button')];
    const show = () => btns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === String(get()))));
    btns.forEach((b) => b.addEventListener('click', () => (set(b.dataset.v), show())));
    show();
  };
  const showSkill = () => ($('#skill-desc').textContent = SKILL_WORDS[skill]);
  seg('#skill', () => skill, (v) => ((skill = v), store.set('skill', v), showSkill()));
  seg('#length', () => length, (v) => ((length = Number(v)), store.set('length', v)));
  showSkill();

  // ---------------------------------------------------------------- screens
  const SCREENS = ['#home', '#multi', '#lobby', '#howto', '#paused', '#fulltime', '#notice'];
  const show = (id) => {
    for (const s of SCREENS) $(s).classList.toggle('show', s === id);
  };
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]')?.dataset.go;
    if (!go) return;
    sfx.unlock();
    if (go === 'cpu') startLocal('cpu');
    else if (go === 'local2') startLocal('local2');
    else show(`#${go}`);
  });

  const setMatch = (m) => {
    match = m;
    scene.match = m;
    hud.match = m;
  };

  const enterPlay = () => {
    paused = false;
    show(null);
    document.body.classList.add('playing');
    document.body.classList.toggle('show-touch', touch && mode !== 'local2');
    input.releaseAll();
  };

  function startLocal(which) {
    stopOnline();
    mode = which;
    mySide = 0;
    if (which === 'cpu') {
      setMatch(new Match({ sides: [0], skill, seconds: length }));
      hud.clearPeople();
      hud.setPeople([{ side: 0, name: 'You', keys: touch ? 'touch' : 'solo' }]);
      hud.announce('Kick off', `Reds v Blues · computer on ${SKILL[skill].label}`);
    } else {
      setMatch(new Match({ sides: [0, 1], seconds: length }));
      hud.clearPeople();
      hud.setPeople([
        { side: 0, name: 'Reds', keys: 'p1' },
        { side: 1, name: 'Blues', keys: 'p2' },
      ]);
      hud.announce('Kick off', 'Reds v Blues');
    }
    enterPlay();
  }

  const toMenu = () => {
    stopOnline();
    mode = 'demo';
    paused = false;
    setMatch(new Match({ demo: true }));
    hud.clearPeople();
    document.body.classList.remove('playing', 'show-touch');
    show('#home');
  };

  // ---------------------------------------------------------------- online
  const status = (text, bad = false) => {
    const el = $('#mp-status');
    el.textContent = text;
    el.classList.toggle('bad', bad);
  };
  const inviteLink = (code) => {
    const u = new URL(location.href);
    u.search = `?room=${code}`;
    u.hash = '';
    return u.toString();
  };

  function stopOnline() {
    if (online) online.close();
    online = null;
    remote = null;
    outBuf = null;
  }

  const onlineFailed = (text) => {
    const inGame = mode === 'host' || mode === 'guest';
    stopOnline();
    if (inGame) {
      $('#notice-title').textContent = 'Connection lost';
      $('#notice-text').textContent = text;
      show('#notice');
      mode = 'demo';
      document.body.classList.remove('playing', 'show-touch');
    } else {
      show('#multi');
      status(text, true);
    }
  };

  const hostStart = () => {
    mode = 'host';
    mySide = 0;
    setMatch(new Match({ sides: [0, 1], seconds: length }));
    hud.clearPeople();
    hud.setPeople([{ side: 0, name: 'You', keys: touch ? 'touch' : 'solo' }]);
    online.send({ t: 'start', len: length });
    hud.announce('Kick off', 'You are the Reds');
    enterPlay();
  };

  $('#mp-create').addEventListener('click', () => {
    sfx.unlock();
    stopOnline();
    status('');
    $('#lobby-title').textContent = 'Your room';
    $('#lobby-code').textContent = '····';
    $('#lobby-text').textContent = 'Opening a room…';
    $('#lobby-share').hidden = true;
    $('#lobby-link').textContent = '';
    show('#lobby');
    remote = new RemoteInput();
    online = new Online({
      onReady: (code) => {
        $('#lobby-code').textContent = code;
        $('#lobby-text').textContent = 'Tell your friend the code, or send them the link. Waiting for them to join…';
        $('#lobby-share').hidden = false;
        $('#lobby-link').textContent = inviteLink(code);
      },
      onConnected: () => {
        if (mode === 'host') {
          // They came back: carry on where we were.
          hud.announce('Your friend is back', '', 1.6, 'soft');
          online.send({ t: 'start', len: match.length, resume: true });
        } else hostStart();
      },
      onMessage: (msg) => {
        if (msg.t === 'in') remote.receive(msg);
      },
      onClosed: (why) => {
        // The room stays open: the friend can rejoin with the same code.
        hud.announce('Friend disconnected', 'They can rejoin with the same code', 3, 'bad');
        void why;
      },
      onError: onlineFailed,
    });
    online.host();
  });

  const join = (raw) => {
    const code = normalizeCode(raw);
    if (code.length < 4) return status('Type the 4-letter room code your friend gave you.', true);
    sfx.unlock();
    stopOnline();
    $('#lobby-title').textContent = 'Joining';
    $('#lobby-code').textContent = code;
    $('#lobby-text').textContent = 'Connecting to your friend…';
    $('#lobby-share').hidden = true;
    $('#lobby-link').textContent = '';
    show('#lobby');
    outBuf = new InputBuffer();
    online = new Online({
      onConnected: () => ($('#lobby-text').textContent = 'Connected. Waiting for the host to kick off…'),
      onMessage: (msg) => {
        if (msg.t === 'start') {
          if (mode !== 'guest' || !msg.resume) {
            mode = 'guest';
            mySide = 1;
            setMatch(new Match({ sides: [0, 1], seconds: msg.len }));
            hud.clearPeople();
            hud.setPeople([{ side: 1, name: 'You', keys: touch ? 'touch' : 'solo' }]);
            hud.announce('Kick off', 'You are the Blues, attacking left');
          }
          enterPlay();
        } else if (msg.t === 'snap' && mode === 'guest') {
          applySnapshot(match, msg);
          handleEvents(msg.ev);
        }
      },
      onClosed: (why) => onlineFailed(why),
      onError: onlineFailed,
    });
    online.join(code);
  };
  $('#mp-join').addEventListener('click', () => join($('#mp-code').value));
  $('#mp-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join($('#mp-code').value);
  });
  $('#lobby-cancel').addEventListener('click', () => {
    stopOnline();
    show('#multi');
  });
  $('#copy-link').addEventListener('click', async () => {
    const text = $('#lobby-link').textContent;
    try {
      await navigator.clipboard.writeText(text);
      $('#copy-link').textContent = 'Copied';
    } catch {
      // Select it so it can be copied by hand.
      const r = document.createRange();
      r.selectNodeContents($('#lobby-link'));
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      $('#copy-link').textContent = 'Select and copy the link below';
    }
    setTimeout(() => ($('#copy-link').textContent = 'Copy invite link'), 2000);
  });
  // An invite link goes straight to joining.
  const invited = new URLSearchParams(location.search).get('room');
  if (invited) {
    show('#multi');
    $('#mp-code').value = normalizeCode(invited);
  }

  // ---------------------------------------------------------------- pause & end
  const setPaused = (v) => {
    paused = v;
    show(v ? '#paused' : null);
  };
  hud.els.pause.addEventListener('click', () => setPaused(true));
  $('#resume').addEventListener('click', () => setPaused(false));
  $('#quit').addEventListener('click', toMenu);
  $('#menu').addEventListener('click', toMenu);
  $('#notice-ok').addEventListener('click', toMenu);
  $('#again').addEventListener('click', () => {
    if (mode === 'host') hostStart();
    else if (mode === 'guest') $('#fulltime .verdict').textContent = 'Waiting for the host to start a rematch…';
    else startLocal(mode === 'local2' ? 'local2' : 'cpu');
  });

  // ---------------------------------------------------------------- events
  const RESTART_WORDS = { 'throw-in': 'Throw-in', corner: 'Corner', 'goal kick': 'Goal kick', 'free kick': 'Free kick' };
  const teamName = (side) => (side === 0 ? 'Reds' : 'Blues');
  // Is this side played by someone on this screen?
  const ours = (side) => (mode === 'local2' ? true : side === mySide);

  function handleEvents(events) {
    for (const e of events) {
      if (mode === 'demo') continue;
      switch (e.type) {
        case 'kick':
          sfx.kick(e.speed);
          break;
        case 'touch':
          sfx.touch();
          break;
        case 'whistle':
          sfx.whistle(e.short);
          break;
        case 'woodwork':
          sfx.woodwork();
          sfx.groan();
          hud.announce('Off the woodwork!', '', 1.4, 'bad');
          break;
        case 'save':
          sfx.roar(0.5, 1.6);
          hud.announce(e.caught ? 'Great catch!' : 'What a save!', '', 1.3);
          break;
        case 'slide':
          sfx.touch();
          break;
        case 'tackle':
          sfx.touch();
          if (e.slide) hud.announce('Slide tackle!', '', 1, 'soft');
          sfx.roar(0.2, 1);
          break;
        case 'foul':
          sfx.whistle(true);
          sfx.groan();
          hud.announce('Foul!', `Free kick to the ${teamName(1 - e.by)}`, 1.6, 'bad');
          break;
        case 'goal': {
          sfx.whistle();
          const good = mode === 'local2' || ours(e.team);
          sfx.roar(good ? 1 : 0.5, 3.5);
          const title = mode === 'local2' ? `${teamName(e.team)} score!` : good ? 'GOAL!' : `${teamName(e.team)} score`;
          hud.announce(title, `${e.own ? 'Own goal! ' : ''}Reds ${e.score[0]} – ${e.score[1]} Blues`, 3, good ? 'pure' : 'bad');
          break;
        }
        case 'restart':
          if (RESTART_WORDS[e.kind] && e.kind !== 'free kick') hud.announce(RESTART_WORDS[e.kind], teamName(e.team), 1.3, 'soft');
          break;
        case 'strike':
          if (e.result.kind === 'whiff') sfx.groan();
          if (mode === 'guest') match.lastShots[e.side] = e.result;
          break;
        case 'fulltime': {
          sfx.whistle();
          setTimeout(() => sfx.whistle(), 450);
          const [r, b] = e.score;
          $('#fulltime .final').textContent = `Reds ${r} – ${b} Blues`;
          let verdict;
          if (r === b) verdict = 'Honours even: a draw.';
          else if (mode === 'local2') verdict = `The ${r > b ? 'Reds' : 'Blues'} win!`;
          else {
            const won = (r > b) === (mySide === 0);
            verdict = won ? 'You win!' : `The ${r > b ? 'Reds' : 'Blues'} take it this time.`;
          }
          $('#fulltime .verdict').textContent = verdict;
          $('#again').textContent = mode === 'guest' ? 'Ready for a rematch' : 'Play again';
          setTimeout(() => show('#fulltime'), 1200);
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------- loop
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const playing = mode !== 'demo';
    const online2 = mode === 'host' || mode === 'guest';
    if (playing && (input.took('KeyP') || input.took('Escape'))) setPaused(!paused);
    if (input.took('KeyM')) sfx.toggleMute();

    // Online games keep going while you look at the pause menu.
    const run = !paused || online2;
    if (mode === 'guest') {
      const inp = input.read();
      outBuf.add(paused ? NO_INPUT : inp);
      extrapolate(match, dt);
      if (now - lastSend > SEND_MS && online?.connected) {
        online.send(outBuf.take());
        lastSend = now;
      }
    } else if (run) {
      let inp;
      if (mode === 'cpu') inp = input.read();
      else if (mode === 'local2') inp = input.readTwo();
      else if (mode === 'host') inp = [paused ? undefined : input.read(), online?.connected ? remote.take() : undefined];
      else inp = undefined;
      match.update(dt, inp);
      if (mode === 'demo' && match.state === 'fulltime' && match.stateT > 3) setMatch(new Match({ demo: true }));
      const evs = match.drainEvents();
      handleEvents(evs);
      if (mode === 'host') {
        eventsOut.push(...evs);
        if (now - lastSend > SEND_MS && online?.connected) {
          online.send(snapshot(match, eventsOut));
          eventsOut = [];
          lastSend = now;
        }
      }
    } else input.read();

    scene.render(paused && !online2 ? 0 : dt, now / 1000);
    if (playing) {
      hud.update(dt);
      touchUI.update(match, mySide);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
