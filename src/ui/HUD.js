// DOM heads-up display: scoreboard, each player's stamina and shot meters
// (power and strike, as in Fairgreens), big announcements and a radar.

import { OVERSWING_MAX, SWEET_CENTER, PURE_FRAC, NEEDLE_END } from '../game/ShotMeter.js';
import * as P from '../game/pitch.js';

const ROLES = { LB: 'Left back', RB: 'Right back', CM: 'Midfield', LF: 'Left wing', RF: 'Right wing', GK: 'Keeper' };

export class HUD {
  constructor(root, match) {
    this.root = root;
    this.match = match;
    root.innerHTML = `
      <div class="scorebug glass">
        <span class="team red"><i></i>REDS</span>
        <span class="score mono"><b class="s0">0</b><em>–</em><b class="s1">0</b></span>
        <span class="team blue">BLUES<i></i></span>
        <span class="clock mono">0'</span>
      </div>
      <button class="pause-btn glass" aria-label="Pause">II</button>
      <div class="people"></div>
      <div class="banner"><div class="big"></div><div class="small"></div></div>
      <canvas class="radar glass" width="180" height="116"></canvas>
      <div class="help mono"></div>
    `;
    const $ = (s) => root.querySelector(s);
    this.els = {
      s0: $('.s0'), s1: $('.s1'), clock: $('.clock'), people: $('.people'),
      banner: $('.banner'), big: $('.banner .big'), small: $('.banner .small'),
      radar: $('.radar'), help: $('.help'), pause: $('.pause-btn'),
    };
    this.bannerT = 0;
    this.setPeople([{ side: 0, name: 'You', keys: 'solo' }]);
  }

  // Who's playing on this screen: [{ side, name, keys: 'solo' | 'p1' | 'p2' | 'touch' }].
  setPeople(people) {
    this.people = people.map((who) => this.#panel(who));
    this.els.people.className = `people n${people.length}`;
    const keys = people.length > 1 ? 'two' : people[0]?.keys;
    this.els.help.innerHTML =
      keys === 'two'
        ? '<b class="red-t">Reds</b> <kbd>WASD</kbd> <kbd>L-Shift</kbd> <kbd>E</kbd> pass <kbd>Q</kbd> lob <kbd>Space</kbd> shoot <kbd>T</kbd> slide <kbd>C</kbd> switch &nbsp;·&nbsp; <b class="blue-t">Blues</b> <kbd>Arrows</kbd> <kbd>R-Shift</kbd> <kbd>K</kbd> pass <kbd>J</kbd> lob <kbd>L</kbd> shoot <kbd>U</kbd> slide <kbd>I</kbd> switch'
        : '<kbd>WASD</kbd> run · <kbd>Shift</kbd> sprint · <kbd>E</kbd> pass · <kbd>Q</kbd> lob · <kbd>Space</kbd> shoot · <kbd>T</kbd> slide · <kbd>C</kbd> switch · <kbd>P</kbd> pause · <kbd>M</kbd> mute';
  }

  #panel(who) {
    const el = document.createElement('div');
    el.className = `person side${who.side}`;
    const shootKey = who.keys === 'p2' ? 'L' : who.keys === 'touch' ? 'Shoot' : 'Space';
    el.innerHTML = `
      <div class="you glass">
        <div class="you-name"><span class="who">${who.name}</span><span class="num mono">8</span><span class="role">Midfield</span></div>
        <div class="stamina"><div class="bar"><div class="fill"></div></div></div>
      </div>
      <div class="shot glass">
        <div class="meter power"><span class="lbl">Power</span><div class="bar"><div class="over"></div><div class="fill"></div><div class="tick100"></div></div><span class="mono pct">0%</span></div>
        <div class="meter strike"><span class="lbl">Strike</span><div class="bar"><div class="band"></div><div class="pure"></div><div class="needle"></div><div class="mark"></div></div><span class="mono pct state">—</span></div>
        <div class="callout"></div>
      </div>`;
    this.els.people.appendChild(el);
    const $ = (s) => el.querySelector(s);
    const full = (1 / OVERSWING_MAX) * 100;
    $('.power .over').style.left = `${full}%`;
    $('.power .over').style.width = `${100 - full}%`;
    $('.power .tick100').style.left = `${full}%`;
    return {
      ...who,
      shootKey,
      el,
      num: $('.num'), role: $('.role'), stam: $('.stamina .fill'),
      shot: $('.shot'), powerFill: $('.power .fill'), powerPct: $('.power .pct'),
      band: $('.band'), pure: $('.pure'), needle: $('.needle'), mark: $('.mark'),
      state: $('.state'), callout: $('.callout'),
      flashT: 0, seen: null,
    };
  }

  clearPeople() {
    this.els.people.innerHTML = '';
  }

  announce(big, small = '', secs = 1.8, tone = '') {
    this.els.big.textContent = big;
    this.els.small.textContent = small;
    this.els.banner.dataset.tone = tone;
    this.els.banner.classList.remove('show');
    void this.els.banner.offsetWidth; // restart the pop animation
    this.els.banner.classList.add('show');
    this.bannerT = secs;
  }

  update(dt) {
    const m = this.match, e = this.els;
    e.s0.textContent = m.teams[0].score;
    e.s1.textContent = m.teams[1].score;
    e.clock.textContent = `${m.clock}'`;

    this.bannerT -= dt;
    if (this.bannerT <= 0) e.banner.classList.remove('show');

    for (const pp of this.people) {
      const h = m.ctl[pp.side];
      if (h) {
        pp.num.textContent = h.number;
        pp.role.textContent = ROLES[h.role] || '';
        pp.stam.style.width = `${Math.round(h.stamina * 100)}%`;
        pp.stam.classList.toggle('low', h.stamina < 0.25);
      }
      this.drawMeters(pp, dt);
    }
    this.drawRadar();
  }

  drawMeters(pp, dt) {
    const m = this.match, sw = m.meters[pp.side], h = m.ctl[pp.side];
    const owns = !!h && m.ball.owner === h && m.state === 'play';
    const restart = owns && m.restartLock === h;
    // Show how the last strike went for a moment after it.
    const lastShot = m.lastShots[pp.side];
    if (lastShot && lastShot !== pp.seen) {
      pp.seen = lastShot;
      pp.flashT = 1.4;
    }
    pp.flashT -= dt;
    if (sw.phase !== 'idle') pp.flashT = 0;
    const last = pp.flashT > 0 ? pp.seen : null;
    const canShoot = !restart || m.restartKind === 'free kick';
    const showing = owns || sw.active || pp.flashT > 0;
    pp.shot.classList.toggle('visible', showing);
    pp.shot.classList.toggle('meters-off', restart && !canShoot);

    const p = sw.power / OVERSWING_MAX;
    pp.powerFill.style.width = `${Math.min(100, p * 100)}%`;
    pp.powerFill.classList.toggle('hot', sw.power > 1);
    pp.powerPct.textContent = `${Math.round(sw.power * 100)}%`;

    const [lo, hi] = sw.band;
    const pureHalf = (sw.window / 2) * PURE_FRAC;
    const toPct = (v) => `${(v / NEEDLE_END) * 100}%`;
    pp.band.style.left = toPct(lo);
    pp.band.style.width = `${((hi - lo) / NEEDLE_END) * 100}%`;
    pp.pure.style.left = toPct(SWEET_CENTER - pureHalf);
    pp.pure.style.width = `${((2 * pureHalf) / NEEDLE_END) * 100}%`;
    const showNeedle = sw.phase === 'strike';
    pp.needle.style.display = showNeedle ? 'block' : 'none';
    pp.needle.style.left = toPct(Math.min(sw.needle, NEEDLE_END));
    pp.needle.classList.toggle('in', showNeedle && sw.needle >= lo && sw.needle <= hi);

    if (last && last.needle != null) {
      pp.mark.style.display = 'block';
      pp.mark.style.left = toPct(last.needle);
    } else pp.mark.style.display = 'none';

    const K = pp.shootKey;
    const pass = pp.keys === 'p2' ? 'K' : pp.keys === 'touch' ? 'Pass' : 'E';
    const lob = pp.keys === 'p2' ? 'J' : pp.keys === 'touch' ? 'Lob' : 'Q';
    let text, tone = '';
    if (restart && !canShoot) {
      const what = { 'kick-off': 'Your kick-off', 'throw-in': 'Your throw-in', corner: 'Your corner' }[m.restartKind] || 'Your ball';
      text = `${what}: ${pass} to pass, ${lob} to go long`;
    } else if (sw.phase === 'windup') {
      if (sw.power > 1) (text = 'Too much! Let go!'), (tone = 'hot');
      else text = `Let go of ${K} to swing your leg`;
    } else if (sw.phase === 'strike') {
      text = `Press ${K} in the green!`;
      tone = 'now';
    } else if (last) {
      text = last.label;
      tone = last.kind === 'pure' ? 'pure' : last.kind === 'good' ? '' : 'bad';
    } else text = restart ? `Free kick: hold ${K} to shoot, or pass` : `Hold ${K} to shoot`;
    pp.callout.textContent = text;
    pp.callout.dataset.tone = tone;
    pp.state.textContent = sw.phase === 'strike' ? 'NOW' : last ? last.kind.toUpperCase() : '—';
  }

  drawRadar() {
    const c = this.els.radar, g = c.getContext('2d'), m = this.match;
    const w = c.width, h = c.height, pad = 6;
    const sx = (w - 2 * pad) / (2 * P.HALF_L), sz = (h - 2 * pad) / (2 * P.HALF_W);
    const X = (x) => pad + (x + P.HALF_L) * sx, Z = (z) => pad + (z + P.HALF_W) * sz;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 1;
    g.strokeRect(X(-P.HALF_L), Z(-P.HALF_W), 2 * P.HALF_L * sx, 2 * P.HALF_W * sz);
    g.beginPath();
    g.moveTo(X(0), Z(-P.HALF_W));
    g.lineTo(X(0), Z(P.HALF_W));
    g.stroke();
    g.beginPath();
    g.arc(X(0), Z(0), P.CENTRE_R * sx, 0, Math.PI * 2);
    g.stroke();
    for (const e of [-1, 1]) {
      const x0 = e > 0 ? P.HALF_L - P.BOX_DEPTH : -P.HALF_L;
      g.strokeRect(X(x0), Z(-P.BOX_HALF_W), P.BOX_DEPTH * sx, 2 * P.BOX_HALF_W * sz);
    }
    for (const p of m.players) {
      const mine = m.ctl[p.team.side] === p;
      g.fillStyle = p.team.side === 0 ? '#ff5a63' : '#5a9bff';
      g.beginPath();
      g.arc(X(p.pos.x), Z(p.pos.z), mine ? 4 : 3, 0, Math.PI * 2);
      g.fill();
      if (mine) {
        g.strokeStyle = p.team.side === 0 ? '#ffe066' : '#7ff0ff';
        g.lineWidth = 2;
        g.stroke();
        g.lineWidth = 1;
        g.strokeStyle = 'rgba(255,255,255,0.35)';
      }
    }
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(X(m.ball.pos.x), Z(m.ball.pos.z), 2.2, 0, Math.PI * 2);
    g.fill();
  }
}
