// The ball: gravity, bounce, grass friction and a bit of curve from sidespin.
// When a player has it at their feet (owner set) the match moves it instead.

import { BALL_R, G } from './pitch.js';
import { clamp } from '../core/math.js';

export const ROLL_DECEL = 2.6; // m/s² of grass friction on a rolling ball
const AIR_DRAG = 0.05; // per second, in flight
const BOUNCE = 0.5;

export class Ball {
  constructor() {
    this.pos = { x: 0, y: BALL_R, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.spin = 0; // sideways acceleration, m/s²: + curls right of travel
    this.owner = null;
    this.lastTouch = null;
    this.shot = null; // { team, age, beaten, tried } while a shot is live
    this.pass = null; // { to, point, team } while a pass is on its way
  }

  place(x, z, y = BALL_R) {
    this.pos = { x, y, z };
    this.vel = { x: 0, y: 0, z: 0 };
    this.spin = 0;
    this.shot = null;
    this.pass = null;
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  step(dt) {
    if (this.owner) return;
    const v = this.vel, p = this.pos;
    const h = Math.hypot(v.x, v.z);
    if (this.spin && h > 1) {
      // Push sideways, perpendicular to the direction of travel.
      const a = this.spin * dt, px = -v.z / h, pz = v.x / h;
      v.x += px * a;
      v.z += pz * a;
    }
    this.spin *= Math.exp(-0.8 * dt);

    const airborne = p.y > BALL_R + 0.005 || v.y > 0.01;
    if (airborne) {
      v.y -= G * dt;
      const k = Math.exp(-AIR_DRAG * dt);
      v.x *= k;
      v.z *= k;
    }
    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;
    if (p.y <= BALL_R) {
      p.y = BALL_R;
      if (v.y < -1.5) {
        v.y = -v.y * BOUNCE;
        v.x *= 0.88;
        v.z *= 0.88;
      } else v.y = 0;
    }
    if (p.y <= BALL_R && v.y === 0) {
      const s = Math.hypot(v.x, v.z);
      if (s > 0) {
        const ns = Math.max(0, s - ROLL_DECEL * dt);
        v.x *= ns / s;
        v.z *= ns / s;
      }
      this.spin *= Math.exp(-3 * dt);
    }
  }
}

// Speed to roll a ground pass d metres and still arrive at `arrive` m/s.
export function groundPassSpeed(d, arrive = 4) {
  return Math.min(24, Math.sqrt(arrive * arrive + 2 * ROLL_DECEL * d));
}

// Seconds for a rolling ball kicked at v0 to cover d metres.
export function groundTravelTime(d, v0) {
  const disc = v0 * v0 - 2 * ROLL_DECEL * d;
  if (disc < 0) return Infinity;
  return (v0 - Math.sqrt(disc)) / ROLL_DECEL;
}

// Hang time for a lofted pass of d metres.
export function loftTime(d) {
  return clamp(0.6 + d / 24, 0.8, 2.1);
}
