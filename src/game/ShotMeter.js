// The shot: Fairgreens' golf swing, moved onto a football pitch.
//
//   1. Hold Space   → wind up, the power meter fills. Past 100% is the red
//      overcooked zone: more pace, but it rises over the bar and the strike
//      window narrows. Hang there too long and you lose your balance.
//   2. Release      → the strike needle races across the contact bar.
//   3. Press Space  → contact. Where the needle is in the green band decides
//      the strike: dead centre is PERFECT, early pulls it and late pushes it.
//      Early outside the band you lean back and sky it, late outside you
//      scuff it along the ground, and way off you shank it. Never press and
//      it's an air kick.
//
// This class is pure logic: the HUD reads its fields to draw the meters.

import { clamp, lerp } from '../core/math.js';

export const SWEET_CENTER = 0.68;
export const PURE_FRAC = 0.22; // fraction of the half-band that counts as perfect
export const OVERSWING_MAX = 1.12;
export const OVERSWING_HOLD = 0.45; // seconds in the red before balance goes
export const NEEDLE_END = 1.06;

export class ShotMeter {
  constructor() {
    this.setup({ window: 0.3, tempo: 0.55 });
  }

  reset() {
    this.phase = 'idle';
    this.power = 0;
    this.needle = 0;
    this.overTime = 0;
    this.overswung = false;
    this.result = null;
    this.contactAt = null;
  }

  // window: sweet band width (0..1 of the bar); tempo: seconds for the needle at full power.
  setup({ window, tempo }) {
    this.reset();
    this.baseWindow = window;
    this.tempo = tempo;
  }

  get window() {
    const over = clamp((this.power - 1) / (OVERSWING_MAX - 1), 0, 1);
    return clamp(this.baseWindow * (1 - 0.42 * over) * (this.overswung ? 0.75 : 1), 0.03, 0.6);
  }

  get band() {
    const w = this.window;
    return [SWEET_CENTER - w / 2, SWEET_CENTER + w / 2];
  }

  get active() {
    return this.phase === 'windup' || this.phase === 'strike';
  }

  press() {
    if (this.phase !== 'idle') return false;
    this.phase = 'windup';
    this.power = 0;
    return true;
  }

  release() {
    if (this.phase !== 'windup') return false;
    if (this.power < 0.03) {
      // A tap, not a shot.
      this.phase = 'idle';
      this.power = 0;
      return false;
    }
    this.phase = 'strike';
    this.needle = 0;
    // Softer shots are slower and easier to time.
    this.duration = this.tempo * lerp(1.45, 1.0, clamp(this.power, 0, 1));
    return true;
  }

  strike() {
    if (this.phase !== 'strike') return false;
    this.#finish(this.needle);
    return true;
  }

  update(dt) {
    if (this.phase === 'windup') {
      this.power = Math.min(OVERSWING_MAX, this.power + dt / 1.0);
      if (this.power > 1) {
        this.overTime += dt;
        if (this.overTime > OVERSWING_HOLD) {
          this.overswung = true;
          this.release();
        }
      }
    } else if (this.phase === 'strike') {
      this.needle += dt / this.duration;
      if (this.needle >= NEEDLE_END) this.#finish(null);
    }
    return this.phase === 'done' ? this.result : null;
  }

  #finish(needle) {
    this.phase = 'done';
    this.contactAt = needle;
    this.result = evaluateShot({ needle, window: this.window, power: this.power, overswung: this.overswung });
  }
}

// Turn a press position into a strike. Exported for tests and the AI.
//   dist:  multiplier on pace
//   loft:  metres added to the height the shot is aimed at
//   yaw:   start-line error, radians (+ pulls left of the aim)
//   curve: sidespin (+ bends right)
export function evaluateShot({ needle, window, power, overswung = false }) {
  const base = { power, overswung, needle };
  if (needle == null) {
    return { ...base, kind: 'whiff', label: 'Air kick!', offset: 0, quality: 0, dist: 0, loft: 0, yaw: 0, curve: 0 };
  }
  const half = window / 2;
  const o = (needle - SWEET_CENTER) / half; // -1..1 inside the band
  const a = Math.abs(o);
  const side = o < 0 ? 'early' : 'late';
  let r;
  if (a <= PURE_FRAC) {
    r = { kind: 'pure', label: 'PERFECT STRIKE!', quality: 1, dist: 1.04, loft: 0, curve: 0 };
  } else if (a <= 1) {
    r = { kind: 'good', label: side === 'early' ? 'Pulled it a touch' : 'Pushed it a touch', quality: 1 - 0.2 * a * a, dist: 1 - 0.06 * a, loft: 0, curve: o * 1.5 };
  } else if (side === 'early') {
    const heavy = a > 2.2;
    r = { kind: 'skied', label: heavy ? 'Row Z!' : 'Leaned back, skied it', quality: 0.3, dist: heavy ? 0.8 : 0.9, loft: heavy ? 4.5 : 2.6, curve: clamp(o, -2.4, 0) };
  } else if (a > 2.2) {
    r = { kind: 'shank', label: 'SHANK! Off the shin', quality: 0.1, dist: 0.5, loft: 0.6, curve: 1.5, shank: true };
  } else {
    r = { kind: 'scuffed', label: 'Scuffed it', quality: 0.45, dist: 0.62, loft: -2, curve: clamp(o, 0, 2.2) };
  }
  // Early pulls left of the aim (+yaw), late pushes right.
  const yawDeg = r.shank ? -30 : clamp(-o * 5, -14, 14) || 0;
  return { ...base, ...r, offset: o, yaw: (yawDeg * Math.PI) / 180 };
}
