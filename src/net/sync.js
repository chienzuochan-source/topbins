// Online play is host-run. The host's browser runs the match and sends a
// snapshot about 30 times a second. The guest copies each snapshot into its
// own Match object and draws that. Between snapshots the guest slides
// everything along at its current speed, so movement stays smooth.

import * as P from '../game/pitch.js';

const r2 = (v) => Math.round(v * 100) / 100;
const idx = (m, p) => (p ? m.players.indexOf(p) : -1);

export function snapshot(m, events = []) {
  const b = m.ball;
  return {
    t: 'snap',
    st: m.state,
    stT: r2(m.stateT),
    time: r2(m.time),
    len: m.length,
    sc: [m.teams[0].score, m.teams[1].score],
    lg: m.lastGoal ?? null,
    rl: idx(m, m.restartLock),
    rk: m.restartKind || null,
    ctl: m.ctl.map((p) => idx(m, p)),
    sz: m.steerZ.map(r2),
    mt: m.meters.map((s) => [s.phase, r2(s.power), r2(s.needle), r2(s.baseWindow), s.overswung ? 1 : 0]),
    pl: m.players.map((p) => [
      r2(p.pos.x), r2(p.pos.z), r2(p.vel.x), r2(p.vel.z), r2(p.face),
      r2(p.stamina), r2(p.stun), r2(p.kickAnim), r2(p.diveT), p.diveDir, r2(p.slideT), r2(p.slideDir),
    ]),
    b: [r2(b.pos.x), r2(b.pos.y), r2(b.pos.z), r2(b.vel.x), r2(b.vel.y), r2(b.vel.z), idx(m, b.owner)],
    bp: b.pass ? [r2(b.pass.point.x), r2(b.pass.point.z)] : null,
    ev: events,
  };
}

export function applySnapshot(m, s) {
  m.state = s.st;
  m.stateT = s.stT;
  m.time = s.time;
  m.length = s.len;
  m.teams[0].score = s.sc[0];
  m.teams[1].score = s.sc[1];
  m.lastGoal = s.lg;
  m.restartLock = s.rl >= 0 ? m.players[s.rl] : null;
  m.restartKind = s.rk;
  m.ctl = s.ctl.map((i) => (i >= 0 ? m.players[i] : null));
  m.steerZ = s.sz;
  s.mt.forEach(([phase, power, needle, baseWindow, overswung], i) => {
    Object.assign(m.meters[i], { phase, power, needle, baseWindow, overswung: !!overswung });
  });
  s.pl.forEach((a, i) => {
    const p = m.players[i];
    p.pos.x = a[0];
    p.pos.z = a[1];
    p.vel.x = a[2];
    p.vel.z = a[3];
    p.face = a[4];
    p.stamina = a[5];
    p.stun = a[6];
    p.kickAnim = a[7];
    p.diveT = a[8];
    p.diveDir = a[9];
    p.slideT = a[10];
    p.slideDir = a[11];
  });
  const b = m.ball;
  b.pos = { x: s.b[0], y: s.b[1], z: s.b[2] };
  b.vel = { x: s.b[3], y: s.b[4], z: s.b[5] };
  b.owner = s.b[6] >= 0 ? m.players[s.b[6]] : null;
  b.pass = s.bp ? { point: { x: s.bp[0], z: s.bp[1] } } : null;
}

// Move things along between snapshots.
export function extrapolate(m, dt) {
  for (const p of m.players) {
    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;
    p.run += Math.hypot(p.vel.x, p.vel.z) * dt * 1.9;
    p.kickAnim = Math.max(0, p.kickAnim - dt);
    if (p.stun > 0) p.stun -= dt;
    if (p.slideT > 0) p.slideT -= dt;
    if (p.diveT > 0) p.diveT -= dt;
  }
  const b = m.ball;
  if (b.owner) return;
  b.pos.x += b.vel.x * dt;
  b.pos.z += b.vel.z * dt;
  if (b.pos.y > P.BALL_R || b.vel.y > 0) {
    b.vel.y -= P.G * dt;
    b.pos.y = Math.max(P.BALL_R, b.pos.y + b.vel.y * dt);
  }
}

// The guest's buttons, gathered between sends so a quick tap is never lost.
export class InputBuffer {
  constructor() {
    this.reset();
  }

  reset() {
    this.edges = { pass: false, loft: false, shootPressed: false, shootReleased: false, slide: false, switch: false };
  }

  add(input) {
    this.latest = input;
    for (const k of Object.keys(this.edges)) if (input[k]) this.edges[k] = true;
  }

  // The message to send, then start gathering again.
  take() {
    const l = this.latest || { move: { x: 0, z: 0 }, sprint: false };
    const msg = { t: 'in', mv: [r2(l.move.x), r2(l.move.z)], sp: !!l.sprint, ...this.edges };
    this.reset();
    return msg;
  }
}

// What the host feeds the match for the guest's side: movement carries on
// until the next message, button presses count once.
export class RemoteInput {
  constructor() {
    this.move = { x: 0, z: 0 };
    this.sprint = false;
    this.pending = {};
  }

  receive(msg) {
    this.move = { x: msg.mv[0], z: msg.mv[1] };
    this.sprint = msg.sp;
    for (const k of ['pass', 'loft', 'shootPressed', 'shootReleased', 'slide', 'switch']) if (msg[k]) this.pending[k] = true;
  }

  take() {
    const out = {
      move: this.move, sprint: this.sprint,
      pass: false, loft: false, shootPressed: false, shootReleased: false, slide: false, switch: false,
    };
    // A press and a release of shoot in the same message are applied a frame apart.
    if (this.pending.shootPressed && this.pending.shootReleased) {
      out.shootPressed = true;
      delete this.pending.shootPressed;
    } else {
      Object.assign(out, this.pending);
      this.pending = {};
    }
    return out;
  }
}
