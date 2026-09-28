// The match: two teams of six, one ball, and the rules that tie them together.
// Pure logic with no rendering, so it runs the same in the browser and in tests.
//
// You control one Reds player at a time (the Reds attack +x). Everyone else,
// both keepers included, is run by the AI below.

import { Ball, groundPassSpeed, groundTravelTime, loftTime } from './Ball.js';
import { ShotMeter, evaluateShot, SWEET_CENTER, OVERSWING_MAX } from './ShotMeter.js';
import * as P from './pitch.js';
import { clamp } from '../core/math.js';

export const MATCH_SECONDS = 240; // real seconds for the full 90 minutes
export const JOG = 6.0;
export const SPRINT = 8.4;
const ACCEL = 22;
const REACH = 0.75; // how close you need to be to take the ball
const KEEPER_REACH = 1.15;
const DIVE_REACH = 1.4;
const TACKLE_RANGE = 1.0;

export const NO_INPUT = Object.freeze({
  move: { x: 0, z: 0 },
  sprint: false,
  pass: false,
  loft: false,
  shootPressed: false,
  shootReleased: false,
  switch: false,
  slide: false,
});

// How good the computer is. It changes the computer's players and keeper:
// how fast they run, how often they win tackles, how well they shoot and how
// many shots their keeper stops.
export const SKILL = {
  easy: { label: 'Easy', speed: 0.86, tackle: 0.8, save: -0.2, shotNoise: 0.32, range: 16, think: 0.45, slide: 0 },
  normal: { label: 'Normal', speed: 1, tackle: 1.8, save: 0, shotNoise: 0.2, range: 20, think: 0.25, slide: 0.15 },
  hard: { label: 'Hard', speed: 1.06, tackle: 2.6, save: 0.06, shotNoise: 0.14, range: 22, think: 0.18, slide: 0.3 },
  legend: { label: 'Legend', speed: 1.12, tackle: 3.4, save: 0.12, shotNoise: 0.09, range: 24, think: 0.12, slide: 0.45 },
};
const SLIDE_TIME = 0.55;
const SLIDE_SPEED = 9.5;

// Six a side. ax is metres along the attacking direction, z is across.
const FORMATION = [
  { role: 'GK', ax: -33, z: 0 },
  { role: 'LB', ax: -20, z: -9 },
  { role: 'RB', ax: -20, z: 9 },
  { role: 'CM', ax: -7, z: 0 },
  { role: 'LF', ax: 8, z: -10 },
  { role: 'RF', ax: 8, z: 10 },
];

export class Player {
  constructor(team, idx, spot) {
    this.team = team;
    this.idx = idx;
    this.role = spot.role;
    this.base = spot;
    this.number = [1, 3, 2, 8, 11, 9][idx];
    this.pos = { x: 0, z: 0 };
    this.vel = { x: 0, z: 0 };
    this.want = { x: 0, z: 0 };
    this.face = 0; // radians, atan2(z, x)
    this.sprint = false;
    this.stamina = 1;
    this.stun = 0; // seconds knocked off balance
    this.kickCd = 0; // can't touch the ball again straight after kicking it
    this.protect = 0; // can't be tackled straight after winning the ball
    this.kickAnim = 0;
    this.diveT = 0;
    this.diveDir = 0;
    this.slideT = 0; // sliding in for a tackle
    this.slideDir = 0;
    this.slideHit = false;
    this.holdT = 0;
    this.think = 0;
    this.run = 0; // stride phase, for the legs
  }

  get isKeeper() {
    return this.role === 'GK';
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }
}

function makeTeam(side, name, attack, skill) {
  const team = { side, name, attack, score: 0, players: [], skill: SKILL[skill] || SKILL.normal };
  team.players = FORMATION.map((spot, i) => new Player(team, i, spot));
  return team;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class Match {
  // sides: which teams people play (0 = Reds, 1 = Blues). [0] is you against
  // the computer, [0, 1] is two players, [] is computer v computer.
  // skill: how good the computer's team is (see SKILL).
  constructor({ seconds = MATCH_SECONDS, rng = Math.random, demo = false, sides = demo ? [] : [0], skill = 'normal' } = {}) {
    this.rng = rng;
    this.sides = sides;
    this.length = seconds;
    const cpu = (side) => (sides.includes(side) ? 'normal' : skill);
    this.teams = [makeTeam(0, 'Reds', 1, cpu(0)), makeTeam(1, 'Blues', -1, cpu(1))];
    this.players = [...this.teams[0].players, ...this.teams[1].players];
    this.ball = new Ball();
    this.meters = [new ShotMeter(), new ShotMeter()];
    this.ctl = [null, null]; // the player each person controls
    this.lastShots = [null, null];
    this.steerZ = [0, 0];
    this.switchT = [0, 0];
    this.manualT = [0, 0]; // after you press C, auto-switching waits a moment
    this.events = [];
    this.time = 0;
    this.restartLock = null; // the player taking a kick-off, throw-in, corner or goal kick
    this.kickoff(0);
  }

  // The first person's player and shot meter.
  get human() {
    return this.sides.length ? this.ctl[this.sides[0]] : null;
  }

  get meter() {
    return this.meters[this.sides[0] ?? 0];
  }

  get lastShot() {
    return this.lastShots[this.sides[0] ?? 0];
  }

  isHuman(p) {
    return this.ctl[p.team.side] === p;
  }

  humanSide(side) {
    return this.sides.includes(side);
  }

  get clock() {
    return Math.min(90, Math.floor((this.time / this.length) * 90));
  }

  other(team) {
    return this.teams[1 - team.side];
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  setState(s) {
    this.state = s;
    this.stateT = 0;
  }

  // ---------------------------------------------------------------- restarts

  kickoff(side) {
    const kickTeam = this.teams[side];
    for (const p of this.players) {
      const A = p.team.attack;
      let ax = Math.min(-2, p.base.ax * 0.6 - 3);
      let z = p.base.z;
      if (p.isKeeper) ax = -P.HALF_L + 1;
      // The side not kicking off stays out of the centre circle.
      if (p.team !== kickTeam && Math.hypot(ax, z) < P.CENTRE_R + 1) ax = -(P.CENTRE_R + 1);
      p.pos = { x: ax * A, z };
      p.vel = { x: 0, z: 0 };
      p.face = A > 0 ? 0 : Math.PI;
      p.stun = p.kickCd = p.diveT = p.holdT = 0;
    }
    const kicker = kickTeam.players[3];
    kicker.pos = { x: -0.7 * kickTeam.attack, z: 0 };
    this.ball.place(0, 0);
    this.ball.owner = kicker;
    this.ball.lastTouch = kicker;
    // Nobody from the other side comes near until the kicker plays it.
    this.restartLock = kicker;
    this.restartKind = 'kick-off';
    for (const m of this.meters) m.reset();
    for (const s of this.sides) this.ctl[s] = s === side ? kicker : this.teams[s].players[3];
    this.setState('kickoff');
    this.emit('kickoff', { team: side });
  }

  restart(kind, team, x, z, who = null) {
    const b = this.ball;
    let taker = who;
    if (taker) {
      // Free kick: taken where the foul was.
    } else if (kind === 'goal kick') {
      taker = team.players[0];
    } else {
      taker = team.players
        .filter((p) => !p.isKeeper)
        .reduce((best, p) => (dist(p.pos, { x, z }) < dist(best.pos, { x, z }) ? p : best));
    }
    // The taker stands just behind the ball, facing into the pitch.
    const inX = kind === 'corner' ? -Math.sign(x) : kind === 'goal kick' || kind === 'free kick' ? team.attack : 0;
    const inZ = kind === 'goal kick' || kind === 'free kick' ? 0 : -Math.sign(z);
    const n = Math.hypot(inX, inZ) || 1;
    taker.pos = { x: x - (inX / n) * 0.6, z: z - (inZ / n) * 0.6 };
    taker.vel = { x: 0, z: 0 };
    taker.face = Math.atan2(inZ, inX);
    taker.holdT = 0;
    // Nobody crowds the taker: anyone too close steps back, onto the pitch.
    const cx = -taker.pos.x, cz = -taker.pos.z, cd = Math.hypot(cx, cz) || 1;
    let k = 0;
    for (const p of this.other(team).players) {
      if (dist(p.pos, taker.pos) >= 4.5) continue;
      const side = (k++ % 2 ? 1 : -1) * Math.ceil(k / 2) * 1.5;
      p.pos = {
        x: clamp(taker.pos.x + (cx / cd) * 5 - (cz / cd) * side, -P.HALF_L + 1, P.HALF_L - 1),
        z: clamp(taker.pos.z + (cz / cd) * 5 + (cx / cd) * side, -P.HALF_W + 1, P.HALF_W - 1),
      };
      p.vel = { x: 0, z: 0 };
    }
    b.place(x, z);
    b.owner = taker;
    b.lastTouch = taker;
    this.restartLock = taker;
    this.restartKind = kind;
    for (const m of this.meters) m.reset();
    if (!taker.isKeeper) this.control(taker);
    this.emit('restart', { kind, team: team.side });
    this.emit('whistle', { short: true });
  }

  // ---------------------------------------------------------------- the loop

  // input: what the first person is pressing, or an array of inputs by side.
  update(dt, input = NO_INPUT) {
    dt = Math.min(dt, 0.05);
    const inputs = Array.isArray(input) ? input : this.sides.length ? { [this.sides[0]]: input } : {};
    this.stateT += dt;

    if (this.state === 'fulltime') {
      for (const p of this.players) (p.want = { x: 0, z: 0 }), this.move(p, dt);
      this.stepBall(dt);
      return;
    }
    if (this.state === 'kickoff') {
      if (this.stateT < 1.1) return;
      this.setState('play');
      this.emit('whistle', {});
    }
    if (this.state === 'goal') {
      for (const p of this.players) {
        p.want = { x: 0, z: 0 };
        this.move(p, dt);
      }
      this.stepBall(dt);
      if (this.stateT > 3.2) {
        if (this.time >= this.length) this.fullTime();
        else this.kickoff(1 - this.lastGoal);
      }
      return;
    }

    this.time += dt;
    for (const s of this.sides) this.handleHuman(s, dt, inputs[s] || NO_INPUT);
    for (const p of this.players) if (!this.isHuman(p)) this.ai(p, dt);
    for (const p of this.players) this.move(p, dt);
    this.separate();
    this.dribble();
    if (this.stepBall(dt)) return; // a goal, or out of play
    this.checkPossession(dt);
    this.checkSlides();
    this.checkTackles(dt);
    for (const s of this.sides) this.autoSwitch(s, dt);

    if (this.time >= this.length && !this.ball.shot && this.state === 'play') this.fullTime();
  }

  fullTime() {
    this.setState('fulltime');
    for (const m of this.meters) m.reset();
    this.emit('fulltime', { score: this.teams.map((t) => t.score) });
  }

  // ---------------------------------------------------------------- you

  handleHuman(side, dt, input) {
    const b = this.ball;
    if (input.switch) this.switchPlayer(side, true);
    const h = this.ctl[side];
    if (!h) return;
    const meter = this.meters[side];
    if (input.slide) this.slide(h, input.move);

    let { x: mx, z: mz } = input.move;
    // Receiving a pass with no keys held: run onto it for you.
    if (!mx && !mz && b.pass && b.pass.to === h && !b.owner) {
      const t = dist(h.pos, b.pos) < 6 ? b.pos : b.pass.point;
      const dx = t.x - h.pos.x, dz = t.z - h.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.3) (mx = dx / d), (mz = dz / d);
    }
    h.want = { x: mx, z: mz };
    h.sprint = input.sprint;
    this.steerZ[side] = input.move.z;

    const owns = b.owner === h;
    if (!owns && meter.phase !== 'idle') meter.reset();
    if (owns && meter.phase === 'idle') {
      if (input.pass) return this.humanPass(h, input, false);
      if (input.loft) return this.humanPass(h, input, true);
      if (input.shootPressed && (this.restartLock !== h || this.restartKind === 'free kick')) {
        const press = this.pressure(h);
        meter.setup({ window: press < 2 ? 0.22 : 0.3, tempo: 0.55 });
        meter.press();
      }
    } else if (owns && meter.phase === 'strike' && input.shootPressed) {
      meter.strike();
    }
    if (input.shootReleased && meter.phase === 'windup') meter.release();

    const res = meter.update(dt);
    if (res) {
      meter.reset();
      this.lastShots[side] = res;
      this.emit('strike', { side, result: res });
      if (res.kind === 'whiff') {
        // Swung at fresh air and fell over.
        h.stun = 0.6;
        h.kickCd = 0.5;
        this.loose(h);
        b.vel = { x: h.vel.x * 0.4, y: 0, z: h.vel.z * 0.4 };
      } else {
        this.shoot(h, this.aimZ(h, input.move.z), res);
      }
    }
  }

  // Where your shot is aimed across the goal mouth. Hold W or S while you
  // strike it to pick the far-side or near-side post; otherwise it goes for
  // the far post.
  aimZ(p, steerZ = 0) {
    const post = P.GOAL_HALF_W - 0.75;
    if (steerZ < -0.35) return -post;
    if (steerZ > 0.35) return post;
    if (Math.abs(p.pos.z) > 1.5) return -Math.sign(p.pos.z) * post;
    return (p.idx % 2 ? 1 : -1) * post;
  }

  humanPass(p, input, loft) {
    let dx = input.move.x, dz = input.move.z;
    if (!dx && !dz) (dx = Math.cos(p.face)), (dz = Math.sin(p.face));
    const n = Math.hypot(dx, dz);
    dx /= n;
    dz /= n;
    let best = null, bestS = -Infinity;
    for (const m of p.team.players) {
      if (m === p) continue;
      const vx = m.pos.x - p.pos.x, vz = m.pos.z - p.pos.z, d = Math.hypot(vx, vz);
      if (d < 2) continue;
      const cos = (vx * dx + vz * dz) / d;
      if (cos < 0.45) continue;
      let s = cos * 1.8 - d / 45;
      if (!loft && this.laneBlocked(p.pos, m.pos, p.team)) s -= 0.7;
      if (m.isKeeper) s -= 0.5;
      if (s > bestS) (bestS = s), (best = m);
    }
    if (best) this.passTo(p, best, loft);
    else {
      // Nobody that way: knock it into space.
      const len = loft ? 24 : 12;
      const tx = clamp(p.pos.x + dx * len, -P.HALF_L, P.HALF_L);
      const tz = clamp(p.pos.z + dz * len, -P.HALF_W, P.HALF_W);
      if (loft) this.loftBall(p, tx, tz, null);
      else this.groundBall(p, tx, tz, null);
    }
  }

  // ---------------------------------------------------------------- kicks

  release(p, vx, vy, vz, { kind = 'pass', spin = 0, to = null, point = null } = {}) {
    const b = this.ball;
    b.owner = null;
    b.vel = { x: vx, y: vy, z: vz };
    b.spin = spin;
    b.lastTouch = p;
    b.shot = kind === 'shot' ? { team: p.team.side, age: 0, beaten: false, tried: new Set() } : null;
    b.pass = to ? { to, point, team: p.team.side } : null;
    p.kickCd = 0.35;
    p.kickAnim = 0.3;
    p.holdT = 0;
    if (this.restartLock === p) this.restartLock = null;
    this.emit('kick', { kind, speed: Math.hypot(vx, vy, vz) });
  }

  loose(p) {
    const b = this.ball;
    b.owner = null;
    b.lastTouch = p;
    if (this.restartLock === p) this.restartLock = null;
  }

  groundBall(p, tx, tz, to) {
    const b = this.ball, dx = tx - b.pos.x, dz = tz - b.pos.z, d = Math.hypot(dx, dz) || 1;
    const v = groundPassSpeed(d);
    this.release(p, (dx / d) * v, 0, (dz / d) * v, { to, point: { x: tx, z: tz } });
  }

  loftBall(p, tx, tz, to) {
    const b = this.ball, dx = tx - b.pos.x, dz = tz - b.pos.z, d = Math.hypot(dx, dz) || 1;
    const t = loftTime(d), vh = d / t;
    this.release(p, (dx / d) * vh, (P.G * t) / 2, (dz / d) * vh, { to, point: { x: tx, z: tz } });
  }

  // Pass to a teammate, leading them if they're on the move.
  passTo(p, mate, loft) {
    const b = this.ball;
    let pt = { ...mate.pos };
    for (let i = 0; i < 2; i++) {
      const d = dist(b.pos, pt);
      const t = loft ? loftTime(d) : groundTravelTime(d, groundPassSpeed(d));
      pt = {
        x: clamp(mate.pos.x + mate.vel.x * t * 0.8, -P.HALF_L + 1, P.HALF_L - 1),
        z: clamp(mate.pos.z + mate.vel.z * t * 0.8, -P.HALF_W + 1, P.HALF_W - 1),
      };
    }
    if (loft) this.loftBall(p, pt.x, pt.z, mate);
    else this.groundBall(p, pt.x, pt.z, mate);
    if (!mate.isKeeper) this.control(mate);
  }

  // Strike at goal. res comes from the shot meter (or a pretend one, for the AI).
  shoot(p, aimZ, res) {
    const b = this.ball;
    const gx = P.HALF_L * p.team.attack;
    const pw = Math.min(res.power, 1);
    const over = Math.max(0, res.power - 1) / (OVERSWING_MAX - 1);
    const speed = (14 + 16 * pw + 4 * over) * res.dist;
    const h = Math.max(0.15, 0.3 + 1.5 * pw + 2.4 * over + res.loft);
    const dx = gx - b.pos.x, dz = aimZ - b.pos.z, d = Math.hypot(dx, dz);
    const ang = Math.atan2(dz, dx) - res.yaw;
    const t = d / speed;
    const vy = clamp((h - b.pos.y + 0.5 * P.G * t * t) / t, 0, 16);
    this.release(p, Math.cos(ang) * speed, vy, Math.sin(ang) * speed, { kind: 'shot', spin: res.curve * 1.5 });
  }

  // The ball's aim point on the goal, for the HUD's target marker.
  shotTarget(side) {
    const h = this.ctl[side];
    if (!h || !this.meters[side].active) return null;
    return { x: P.HALF_L * h.team.attack, z: this.aimZ(h, this.steerZ[side] || 0) };
  }

  // ---------------------------------------------------------------- slide tackles

  slide(p, move) {
    if (p.stun > 0 || p.slideT > 0 || p.diveT > 0 || this.ball.owner === p || this.restartLock) return;
    let dx = move.x, dz = move.z;
    if (!dx && !dz) (dx = Math.cos(p.face)), (dz = Math.sin(p.face));
    p.slideDir = Math.atan2(dz, dx);
    p.face = p.slideDir;
    p.slideT = SLIDE_TIME;
    p.slideHit = false;
    this.emit('slide', { team: p.team.side });
  }

  // A slide that reaches the ball knocks it away. One that hits the man and
  // not the ball is a foul: a free kick to the other side.
  checkSlides() {
    const b = this.ball;
    for (const p of this.players) {
      if (p.slideT <= 0 || p.slideHit || b.pos.y > 0.7) continue;
      const fx = p.pos.x + Math.cos(p.slideDir) * 0.6, fz = p.pos.z + Math.sin(p.slideDir) * 0.6;
      const o = b.owner;
      if (o && o.team === p.team) continue;
      if (o && (o.protect > 0.3 || this.restartLock === o)) continue;
      const toBall = Math.hypot(b.pos.x - fx, b.pos.z - fz);
      if (toBall < 1.0) {
        p.slideHit = true;
        if (o) {
          o.stun = 0.7;
          o.kickCd = 0.5;
          if (this.isHuman(o)) this.meters[o.team.side].reset();
          this.loose(o);
        }
        const sp = 6 + p.speed * 0.3;
        b.vel = { x: Math.cos(p.slideDir) * sp, y: 0.5, z: Math.sin(p.slideDir) * sp };
        b.spin = 0;
        b.shot = null;
        b.pass = null;
        b.lastTouch = p;
        this.emit('tackle', { by: p.team.side, slide: true });
      } else if (o && dist(o.pos, { x: fx, z: fz }) < 0.8) {
        p.slideHit = true;
        o.stun = 0.9;
        this.emit('foul', { by: p.team.side });
        this.freeKick(this.other(p.team), o);
        return;
      }
    }
  }

  freeKick(team, fouled) {
    const x = clamp(fouled.pos.x, -P.HALF_L + 2, P.HALF_L - 2);
    const z = clamp(fouled.pos.z, -P.HALF_W + 1, P.HALF_W - 1);
    fouled.stun = 0;
    this.restart('free kick', team, x, z, fouled);
  }

  // ---------------------------------------------------------------- movement

  move(p, dt) {
    if (p.stun > 0) {
      p.stun -= dt;
      p.want = { x: 0, z: 0 };
    }
    if (this.restartLock === p || this.state === 'kickoff') p.want = { x: 0, z: 0 };
    let wx = p.want.x, wz = p.want.z;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) (wx /= wl), (wz /= wl);

    const canSprint = p.sprint && p.stamina > 0.05;
    let max = canSprint ? SPRINT : JOG;
    if (p.isKeeper) max = canSprint ? 7.5 : 5.5;
    if (this.ball.owner === p) max *= 0.9;
    if (this.isHuman(p) && this.meters[p.team.side].active) max *= 0.55;
    if (!this.humanSide(p.team.side)) max *= p.team.skill.speed;

    if (p.slideT > 0) {
      // Sliding in: fast at first, then grinding to a halt, then get up.
      p.slideT -= dt;
      const v = SLIDE_SPEED * (0.3 + 0.7 * Math.max(0, p.slideT / SLIDE_TIME));
      p.vel.x = Math.cos(p.slideDir) * v;
      p.vel.z = Math.sin(p.slideDir) * v;
      if (p.slideT <= 0) {
        p.vel = { x: 0, z: 0 };
        p.stun = 0.4;
      }
    } else if (p.diveT > 0) {
      p.diveT -= dt;
      p.vel.x *= 0.9;
      p.vel.z = p.diveDir * 6.5 * Math.max(0, p.diveT / 0.55);
    } else {
      const tx = wx * max, tz = wz * max;
      const dx = tx - p.vel.x, dz = tz - p.vel.z, d = Math.hypot(dx, dz), a = ACCEL * dt;
      if (d <= a) (p.vel.x = tx), (p.vel.z = tz);
      else (p.vel.x += (dx / d) * a), (p.vel.z += (dz / d) * a);
    }
    p.pos.x = clamp(p.pos.x + p.vel.x * dt, -P.HALF_L - 2, P.HALF_L + 2);
    p.pos.z = clamp(p.pos.z + p.vel.z * dt, -P.HALF_W - 2, P.HALF_W + 2);
    // At a kick-off the other side stays in its own half and out of the circle.
    const k = this.restartLock;
    if (k && this.restartKind === 'kick-off' && p.team !== k.team) {
      const A = p.team.attack;
      if (p.pos.x * A > -0.5) p.pos.x = -0.5 * A;
      const d = Math.hypot(p.pos.x, p.pos.z);
      if (d < P.CENTRE_R + 0.5) {
        const r = (P.CENTRE_R + 0.5) / (d || 1);
        p.pos.x = d ? p.pos.x * r : -(P.CENTRE_R + 0.5) * A;
        p.pos.z *= d ? r : 1;
      }
    }

    const sp = p.speed;
    if (canSprint && sp > JOG * 0.8) p.stamina = Math.max(0, p.stamina - 0.16 * dt);
    else p.stamina = Math.min(1, p.stamina + 0.08 * dt);

    if (sp > 0.4 && p.diveT <= 0 && p.slideT <= 0) {
      const target = Math.atan2(p.vel.z, p.vel.x);
      let diff = target - p.face;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const rate = (this.ball.owner === p ? 9 : 14) * dt;
      p.face += clamp(diff, -rate, rate);
    }
    p.run += sp * dt * 1.9;
    p.kickCd = Math.max(0, p.kickCd - dt);
    p.protect = Math.max(0, p.protect - dt);
    p.kickAnim = Math.max(0, p.kickAnim - dt);
  }

  // Players don't stand inside each other.
  separate() {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i].pos, b = ps[j].pos;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d < 0.7 && d > 1e-4) {
          const push = (0.7 - d) / 2 / d;
          a.x -= dx * push;
          a.z -= dz * push;
          b.x += dx * push;
          b.z += dz * push;
        }
      }
    }
  }

  // Ball at the owner's feet.
  dribble() {
    const b = this.ball, p = b.owner;
    if (!p) return;
    const lead = p.isKeeper && this.restartLock !== p ? 0.3 : 0.55;
    b.pos.x = p.pos.x + Math.cos(p.face) * lead;
    b.pos.z = p.pos.z + Math.sin(p.face) * lead;
    b.pos.y = p.isKeeper && this.restartLock !== p ? 1.0 : P.BALL_R;
    b.vel = { x: p.vel.x, y: 0, z: p.vel.z };
  }

  // ---------------------------------------------------------------- ball

  // Steps the ball in small pieces so a hard shot can't pass through a post.
  // Returns true when the ball went in or out of play.
  stepBall(dt) {
    const b = this.ball;
    if (b.shot) b.shot.age += dt;
    if (b.owner) return this.state === 'play' && this.checkOut();
    const steps = Math.max(1, Math.ceil((Math.hypot(b.speed, b.vel.y) * dt) / 0.08));
    for (let i = 0; i < steps; i++) {
      b.step(dt / steps);
      this.collideGoalFrame();
      if (this.state === 'goal' || this.state === 'fulltime') this.collideNet();
      else if (this.state === 'play' && this.checkOut()) return true;
    }
    if (b.shot && (b.speed < 4 || b.shot.age > 3)) b.shot = null;
    if (b.pass && b.speed < 1) b.pass = null;
    return false;
  }

  collideGoalFrame() {
    const b = this.ball, p = b.pos, v = b.vel, R = P.BALL_R + P.POST_R;
    for (const end of [-1, 1]) {
      const lx = end * P.HALF_L;
      if (Math.abs(p.x - lx) > 1) continue;
      let hit = false;
      // Posts.
      if (p.y < P.GOAL_H + R) {
        for (const pz of [-P.GOAL_HALF_W, P.GOAL_HALF_W]) {
          const dx = p.x - lx, dz = p.z - pz, d = Math.hypot(dx, dz);
          if (d < R && d > 1e-6) {
            const nx = dx / d, nz = dz / d, vn = v.x * nx + v.z * nz;
            if (vn < 0) {
              v.x -= 1.6 * vn * nx;
              v.z -= 1.6 * vn * nz;
              hit = true;
            }
            p.x = lx + nx * R;
            p.z = pz + nz * R;
          }
        }
      }
      // Crossbar.
      if (Math.abs(p.z) < P.GOAL_HALF_W) {
        const dx = p.x - lx, dy = p.y - P.GOAL_H, d = Math.hypot(dx, dy);
        if (d < R && d > 1e-6) {
          const nx = dx / d, ny = dy / d, vn = v.x * nx + v.y * ny;
          if (vn < 0) {
            v.x -= 1.6 * vn * nx;
            v.y -= 1.6 * vn * ny;
            hit = true;
          }
          p.x = lx + nx * R;
          p.y = P.GOAL_H + ny * R;
        }
      }
      if (hit) {
        b.spin = 0;
        this.emit('woodwork');
      }
    }
  }

  // After a goal the net catches the ball.
  collideNet() {
    const b = this.ball, p = b.pos, v = b.vel;
    const end = Math.sign(p.x);
    const ax = p.x * end; // distance past the centre toward this end
    if (ax < P.HALF_L || Math.abs(p.z) > P.GOAL_HALF_W + 0.5) return;
    const back = P.HALF_L + P.GOAL_DEPTH - P.BALL_R;
    if (ax > back) {
      p.x = back * end;
      v.x *= -0.15;
      v.z *= 0.4;
      if (v.y > 0) v.y *= 0.3;
    }
    if (p.y > P.GOAL_H - P.BALL_R) {
      p.y = P.GOAL_H - P.BALL_R;
      v.y = -Math.abs(v.y) * 0.2;
    }
    const side = P.GOAL_HALF_W - P.BALL_R;
    if (Math.abs(p.z) > side) {
      p.z = Math.sign(p.z) * side;
      v.z *= -0.2;
    }
  }

  // Goals, throw-ins, corners and goal kicks.
  checkOut() {
    const b = this.ball, { x, z, y } = b.pos;
    if (Math.abs(x) > P.HALF_L + P.BALL_R) {
      const end = Math.sign(x);
      // The ball moves at most a few centimetres a step, so where it is now is
      // where it crossed the line.
      if (Math.abs(z) < P.GOAL_HALF_W - P.BALL_R && y < P.GOAL_H - P.BALL_R) {
        this.goal(end > 0 ? 0 : 1);
        return true;
      }
      const toucher = b.lastTouch?.team ?? this.teams[0];
      const defending = end > 0 ? this.teams[1] : this.teams[0];
      if (toucher === defending) {
        const att = this.other(defending);
        this.restart('corner', att, end * (P.HALF_L - 0.3), Math.sign(z || 1) * (P.HALF_W - 0.3));
      } else {
        this.restart('goal kick', defending, end * (P.HALF_L - 5), 0);
      }
      return true;
    }
    if (Math.abs(z) > P.HALF_W + P.BALL_R) {
      const toucher = b.lastTouch?.team ?? this.teams[0];
      this.restart(
        'throw-in',
        this.other(toucher),
        clamp(x, -P.HALF_L + 1, P.HALF_L - 1),
        Math.sign(z) * (P.HALF_W - 0.2),
      );
      return true;
    }
    return false;
  }

  goal(side) {
    const b = this.ball;
    if (b.owner) {
      // Walked it in.
      b.owner = null;
    }
    b.shot = null;
    b.pass = null;
    this.teams[side].score++;
    this.lastGoal = side;
    for (const m of this.meters) m.reset();
    this.restartLock = null;
    const scorer = b.lastTouch;
    const own = scorer && scorer.team.side !== side;
    this.emit('goal', { team: side, scorer: scorer?.number, own, score: this.teams.map((t) => t.score) });
    this.setState('goal');
  }

  // ---------------------------------------------------------------- touches

  checkPossession() {
    const b = this.ball;
    if (b.owner) return;
    let best = null, bd = Infinity;
    for (const p of this.players) {
      if (p.stun > 0 || p.kickCd > 0 || p.slideT > 0) continue;
      const keeperHands = p.isKeeper && P.inOwnBox(p.team.attack, b.pos.x, b.pos.z);
      const reach = keeperHands ? KEEPER_REACH + (p.diveT > 0 ? DIVE_REACH : 0) : REACH;
      const maxY = keeperHands ? 2.7 : 1.1;
      const d = dist(p.pos, b.pos);
      if (d < reach && b.pos.y < maxY && d < bd) {
        if (b.shot && b.shot.team !== p.team.side && b.shot.tried.has(p)) continue;
        if (b.shot && b.shot.beaten && p.isKeeper) continue;
        best = p;
        bd = d;
      }
    }
    if (!best) return;

    const speed = Math.hypot(b.speed, b.vel.y);
    if (b.shot && b.shot.team !== best.team.side) {
      b.shot.tried.add(best);
      if (best.isKeeper) return this.saveAttempt(best, bd, speed);
      // An outfield player gets in the way.
      if (this.rng() < 0.55) return this.deflect(best, 'block');
      return;
    }
    if (!best.isKeeper && speed > 20) return this.deflect(best, 'block');
    this.gain(best);
  }

  saveAttempt(k, reachUsed, speed) {
    const b = this.ball;
    const maxReach = KEEPER_REACH + (k.diveT > 0 ? DIVE_REACH : 0);
    let chance = 1.08 + k.team.skill.save - 0.3 * (reachUsed / maxReach) - (speed > 26 ? 0.12 : 0) - (b.pos.y > 1.9 ? 0.1 : 0);
    if (b.shot.age < 0.18) chance -= 0.2; // no time to react
    if (this.rng() > chance) {
      b.shot.beaten = true;
      return;
    }
    if (speed < 20 && this.rng() < 0.8) {
      this.gain(k);
      this.emit('save', { caught: true });
    } else {
      this.deflect(k, 'save');
    }
  }

  deflect(p, kind) {
    const b = this.ball;
    const s = Math.max(4, b.speed);
    b.vel.x = -b.vel.x * 0.3 + (this.rng() - 0.5) * 3;
    b.vel.z = b.vel.z * 0.3 + (this.rng() - 0.5) * s * 0.6;
    b.vel.y = 1.5 + this.rng() * 3;
    b.spin = 0;
    b.shot = null;
    b.pass = null;
    b.lastTouch = p;
    p.kickCd = 0.4;
    this.emit(kind === 'save' ? 'save' : 'block', { caught: false });
  }

  gain(p) {
    const b = this.ball;
    const from = b.lastTouch;
    b.owner = p;
    b.lastTouch = p;
    b.shot = null;
    b.pass = null;
    b.spin = 0;
    p.protect = 0.4;
    p.holdT = 0;
    p.diveT = 0;
    if (!p.isKeeper) this.control(p);
    this.emit('touch', { intercept: from && from.team !== p.team });
  }

  checkTackles(dt) {
    const b = this.ball, o = b.owner;
    if (!o || o.protect > 0 || this.restartLock === o) return;
    if (o.isKeeper && P.inOwnBox(o.team.attack, o.pos.x, o.pos.z)) return;
    for (const p of this.other(o.team).players) {
      if (p.stun > 0 || p.isKeeper || p.slideT > 0) continue;
      if (dist(p.pos, b.pos) > TACKLE_RANGE && dist(p.pos, o.pos) > TACKLE_RANGE) continue;
      // People win the ball more easily than the computer; the computer's
      // tackling depends on how good it is.
      let rate = this.isHuman(p) ? 3.2 : p.team.skill.tackle;
      if (this.isHuman(o) && !this.isHuman(p)) rate *= 0.6;
      if (this.rng() < rate * dt) {
        o.stun = 0.4;
        o.kickCd = 0.5;
        if (this.isHuman(o)) this.meters[o.team.side].reset();
        this.gain(p);
        p.protect = 0.8;
        this.emit('tackle', { by: p.team.side });
        return;
      }
    }
  }

  // Keep you on the player nearest the ball when you're defending, unless
  // you've just picked someone yourself with C.
  autoSwitch(side, dt) {
    this.manualT[side] -= dt;
    this.switchT[side] -= dt;
    if (this.switchT[side] > 0 || this.manualT[side] > 0) return;
    this.switchT[side] = 0.3;
    const o = this.ball.owner, team = this.teams[side];
    if (o && o.team === team) return;
    if (this.ball.pass && this.ball.pass.to.team === team) return;
    this.switchPlayer(side, false);
  }

  control(p) {
    if (this.humanSide(p.team.side)) this.ctl[p.team.side] = p;
  }

  // C: move to the next teammate by distance from the ball, so pressing it
  // again keeps going down the list. Automatic switching picks the nearest.
  switchPlayer(side, manual) {
    const b = this.ball, cur = this.ctl[side];
    if (!cur || b.owner === cur || cur.slideT > 0) return;
    const outfield = this.teams[side].players.filter((p) => !p.isKeeper);
    outfield.sort((a, c) => dist(a.pos, b.pos) - dist(c.pos, b.pos));
    let pick;
    if (manual) {
      // Nearest first; if you're already on the nearest, go to the next.
      const i = outfield.indexOf(cur);
      pick = this.manualT[side] > 0 ? outfield[(i + 1) % outfield.length] : outfield[0] === cur ? outfield[1] : outfield[0];
      this.manualT[side] = 2.5;
    } else {
      pick = outfield[0];
      if (dist(pick.pos, b.pos) + 2.5 > dist(cur.pos, b.pos)) return;
    }
    if (!pick || pick === cur) return;
    this.ctl[side] = pick;
    this.meters[side].reset();
    this.emit('switch', { side });
  }

  // ---------------------------------------------------------------- AI

  pressure(p) {
    let m = Infinity;
    for (const o of this.other(p.team).players) m = Math.min(m, dist(o.pos, p.pos));
    return m;
  }

  // Would an opponent cut out a ground pass from a to b?
  laneBlocked(a, b, team) {
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    for (const o of this.other(team).players) {
      const t = ((o.pos.x - a.x) * dx + (o.pos.z - a.z) * dz) / L2;
      if (t < 0.08 || t > 0.95) continue;
      const cx = a.x + dx * t, cz = a.z + dz * t;
      if (Math.hypot(o.pos.x - cx, o.pos.z - cz) < 1.5) return true;
    }
    return false;
  }

  steer(p, t, sprintOver = 8) {
    // AI players stay on the pitch.
    const tx = clamp(t.x, -P.HALF_L + 0.5, P.HALF_L - 0.5), tz = clamp(t.z, -P.HALF_W + 0.5, P.HALF_W - 0.5);
    const dx = tx - p.pos.x, dz = tz - p.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.4) {
      p.want = { x: 0, z: 0 };
      return;
    }
    const k = Math.min(1, d / 1.5); // ease in to a stop
    p.want = { x: (dx / d) * k, z: (dz / d) * k };
    p.sprint = d > sprintOver && p.stamina > 0.25;
  }

  // Where a player stands in the team's shape, given where the ball is.
  shapePos(p, push = 0) {
    const A = p.team.attack, b = this.ball.pos;
    const bAx = b.x * A;
    const shift = clamp(bAx * 0.55, -13, 15);
    let ax = p.base.ax + shift + push;
    ax = clamp(ax, -P.HALF_L + 4, P.HALF_L - 6);
    const wide = push > 0 ? 1.15 : 0.9;
    const sway = Math.sin(this.time * 0.4 + p.idx * 1.7) * 1.5;
    const z = clamp(p.base.z * wide + b.z * 0.35 + sway, -P.HALF_W + 2, P.HALF_W - 2);
    return { x: ax * A, z };
  }

  ai(p, dt) {
    p.sprint = false;
    if (p.isKeeper) return this.keeperAI(p, dt);
    const b = this.ball, team = p.team, owner = b.owner;
    if (owner === p) return this.carrierAI(p, dt);

    if (!owner && b.pass && b.pass.to === p) {
      return this.steer(p, dist(p.pos, b.pos) < 7 ? b.pos : b.pass.point, 5);
    }
    if (!owner) {
      if (this.chaser(team) === p) {
        const d = dist(p.pos, b.pos);
        const lead = Math.min(0.7, d / 9);
        return this.steer(p, { x: b.pos.x + b.vel.x * lead, z: b.pos.z + b.vel.z * lead }, 3);
      }
      return this.steer(p, this.shapePos(p, b.lastTouch?.team === team ? 3 : -2));
    }
    if (owner.team === team) return this.steer(p, this.shapePos(p, 6));

    // Give the taker of a throw-in, corner or goal kick some room.
    if (this.restartLock === owner) {
      const t = this.shapePos(p, -3);
      if (dist(t, owner.pos) < 5) {
        const d = dist(t, owner.pos) || 1;
        t.x = owner.pos.x + ((t.x - owner.pos.x) / d) * 5;
        t.z = owner.pos.z + ((t.z - owner.pos.z) / d) * 5;
      }
      return this.steer(p, t);
    }
    // Defending: the nearest presses, the next covers, the rest hold shape.
    const [first, second] = this.pressers(team, owner);
    const goalX = -P.HALF_L * team.attack;
    const gx = goalX - owner.pos.x, gz = -owner.pos.z, gd = Math.hypot(gx, gz) || 1;
    if (p === first) {
      // Better computer defenders sometimes slide in.
      const d = dist(p.pos, owner.pos);
      if (d < 2.4 && d > 1 && owner.protect <= 0 && this.rng() < team.skill.slide * dt) {
        const dx = owner.pos.x + owner.vel.x * 0.25 - p.pos.x, dz = owner.pos.z + owner.vel.z * 0.25 - p.pos.z;
        return this.slide(p, { x: dx, z: dz });
      }
      return this.steer(p, { x: owner.pos.x + (gx / gd) * 0.6, z: owner.pos.z + (gz / gd) * 0.6 }, 3);
    }
    if (p === second) return this.steer(p, { x: owner.pos.x + (gx / gd) * 6, z: owner.pos.z + (gz / gd) * 6 }, 10);
    return this.steer(p, this.shapePos(p, -5));
  }

  // The AI player on this team who goes for a loose ball.
  chaser(team) {
    const b = this.ball.pos;
    let best = null, bd = Infinity;
    for (const p of team.players) {
      if (p.isKeeper || this.isHuman(p)) continue;
      const d = dist(p.pos, b);
      if (d < bd) (bd = d), (best = p);
    }
    const h = this.ctl[team.side];
    if (h && dist(h.pos, b) < bd && bd > 6) return null;
    return best;
  }

  pressers(team, owner) {
    const list = team.players.filter((p) => !p.isKeeper);
    list.sort((a, c) => dist(a.pos, owner.pos) - dist(c.pos, owner.pos));
    // If you're one of the two nearest, the AI leaves that job to you.
    return list.slice(0, 2);
  }

  carrierAI(p, dt) {
    const A = p.team.attack;
    if (this.restartLock === p) {
      p.want = { x: 0, z: 0 };
      p.holdT += dt;
      if (p.holdT > 0.9) {
        const fromGoal = Math.hypot(P.HALF_L * A - p.pos.x, p.pos.z);
        if (this.restartKind === 'free kick' && fromGoal < 26) return this.aiShoot(p);
        this.aiPass(p, { any: true, loftAll: this.restartKind === 'corner' });
      }
      return;
    }
    const sk = p.team.skill;
    const gx = P.HALF_L * A;
    const dg = Math.hypot(gx - p.pos.x, p.pos.z);
    const press = this.pressure(p);
    p.think -= dt;
    if (p.think <= 0) {
      p.think = sk.think + this.rng() * 0.2;
      if (dg < sk.range && Math.abs(p.pos.z) < 13 && (dg < 12 || this.rng() < 0.2)) return this.aiShoot(p);
      if (press < 2.4 && this.rng() < 0.6 && this.aiPass(p)) return;
      if (this.rng() < 0.07 && this.aiPass(p, { forward: true })) return;
    }
    // Dribble at goal, away from whoever's closest.
    let dx = gx - p.pos.x, dz = -p.pos.z * 0.4;
    let n = Math.hypot(dx, dz);
    dx /= n;
    dz /= n;
    let near = null, nd = 5;
    for (const o of this.other(p.team).players) {
      const d = dist(o.pos, p.pos);
      if (d < nd) (nd = d), (near = o);
    }
    if (near) {
      const w = ((5 - nd) / 5) * 1.3;
      dx += ((p.pos.x - near.pos.x) / nd) * w * 0.4;
      dz += ((p.pos.z - near.pos.z) / nd) * w;
    }
    if (Math.abs(p.pos.z) > P.HALF_W - 3) dz -= Math.sign(p.pos.z) * 0.8;
    n = Math.hypot(dx, dz) || 1;
    p.want = { x: dx / n, z: dz / n };
    p.sprint = press > 3 && p.stamina > 0.4;
  }

  aiPass(p, { any = false, forward = false, loftAll = false } = {}) {
    const A = p.team.attack;
    let best = null, bestS = -Infinity, bestBlocked = false;
    for (const m of p.team.players) {
      if (m === p) continue;
      const d = dist(m.pos, p.pos);
      if (d < 4 || d > 42) continue;
      const fwd = (m.pos.x - p.pos.x) * A;
      if (forward && fwd < 4) continue;
      let open = 8;
      for (const o of this.other(p.team).players) open = Math.min(open, dist(o.pos, m.pos));
      const blocked = this.laneBlocked(p.pos, m.pos, p.team);
      let s = fwd * 0.07 + open * 0.3 - d * 0.02 - (blocked ? 1.2 : 0) - (m.isKeeper ? 2 : 0);
      if (s > bestS) (bestS = s), (best = m), (bestBlocked = blocked);
    }
    if (!best || (!any && bestS < 0.4)) {
      if (!any) return false;
      if (!best) return this.clear(p);
    }
    const d = dist(best.pos, p.pos);
    this.passTo(p, best, loftAll || bestBlocked || d > 28);
    return true;
  }

  // Hoof it upfield.
  clear(p) {
    const A = p.team.attack;
    this.loftBall(p, clamp(p.pos.x + A * 30, -P.HALF_L + 3, P.HALF_L - 3), p.pos.z * 0.5, null);
    return true;
  }

  aiShoot(p) {
    const needle = SWEET_CENTER + (this.rng() + this.rng() + this.rng() - 1.5) * p.team.skill.shotNoise;
    const res = evaluateShot({ needle, window: 0.3, power: 0.72 + this.rng() * 0.3 });
    const post = P.GOAL_HALF_W - 0.6 - this.rng() * 0.8;
    const z = this.rng() < 0.7 ? -Math.sign(p.pos.z || 1) * post : Math.sign(p.pos.z || 1) * post;
    this.shoot(p, z, res);
    this.emit('aishot', { team: p.team.side });
  }

  keeperAI(k, dt) {
    const A = k.team.attack, b = this.ball;
    const lineX = -P.HALF_L * A;
    if (b.owner === k) {
      k.want = { x: 0, z: 0 };
      k.holdT += dt;
      if (k.holdT > 1.2) this.aiPass(k, { any: true });
      return;
    }
    // A shot coming in: get across, and dive if it's out of reach.
    const toward = -b.vel.x * A; // + when heading for this goal
    const fromLine = b.pos.x * A + P.HALF_L;
    if (!b.owner && toward > 5 && fromLine > 0) {
      const t = fromLine / toward;
      if (t < 1.5) {
        const zc = clamp(b.pos.z + b.vel.z * t, -P.GOAL_HALF_W - 0.6, P.GOAL_HALF_W + 0.6);
        const gap = zc - k.pos.z;
        if (k.diveT <= 0 && Math.abs(gap) > 0.9 && t < 0.55 && b.shot && b.shot.age > 0.12) {
          k.diveT = 0.55;
          k.diveDir = Math.sign(gap);
          this.emit('dive');
        }
        return this.steer(k, { x: lineX + A * 0.8, z: zc }, 0);
      }
    }
    // Loose ball in the box and he's favourite: come and claim it.
    if (!b.owner && P.inOwnBox(A, b.pos.x, b.pos.z)) {
      const dk = dist(k.pos, b.pos);
      let beat = true;
      for (const o of this.other(k.team).players) if (dist(o.pos, b.pos) < dk * 0.9) beat = false;
      if (beat) return this.steer(k, b.pos, 3);
    }
    // Otherwise stand on the line between ball and goal.
    const gx = b.pos.x - lineX, gz = b.pos.z, gd = Math.hypot(gx, gz) || 1;
    const out = clamp(gd * 0.12, 0.6, 3.5);
    this.steer(k, { x: lineX + (gx / gd) * out, z: clamp((gz / gd) * out * 1.4, -P.GOAL_HALF_W, P.GOAL_HALF_W) }, 20);
  }
}
