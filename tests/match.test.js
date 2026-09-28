import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, NO_INPUT } from '../src/game/Match.js';
import { ShotMeter, evaluateShot, SWEET_CENTER } from '../src/game/ShotMeter.js';
import { Ball, groundPassSpeed, groundTravelTime } from '../src/game/Ball.js';
import { mulberry32 } from '../src/core/math.js';
import * as P from '../src/game/pitch.js';

const input = (over = {}) => ({ ...NO_INPUT, move: { x: 0, z: 0 }, ...over });
const run = (m, secs, inp = NO_INPUT) => {
  for (let t = 0; t < secs; t += 1 / 60) m.update(1 / 60, inp);
};

test('a strike in the middle of the band is perfect, early pulls and late pushes', () => {
  assert.equal(evaluateShot({ needle: SWEET_CENTER, window: 0.3, power: 1 }).kind, 'pure');
  const early = evaluateShot({ needle: SWEET_CENTER - 0.1, window: 0.3, power: 1 });
  const late = evaluateShot({ needle: SWEET_CENTER + 0.1, window: 0.3, power: 1 });
  assert.equal(early.kind, 'good');
  assert.ok(early.yaw > 0, 'early pulls left');
  assert.ok(late.yaw < 0, 'late pushes right');
  assert.equal(evaluateShot({ needle: SWEET_CENTER - 0.3, window: 0.3, power: 1 }).kind, 'skied');
  assert.equal(evaluateShot({ needle: null, window: 0.3, power: 1 }).kind, 'whiff');
});

test('the shot meter runs windup, strike, then a result', () => {
  const m = new ShotMeter();
  m.press();
  for (let i = 0; i < 50; i++) m.update(1 / 60);
  assert.ok(m.power > 0.7 && m.power < 0.9);
  m.release();
  assert.equal(m.phase, 'strike');
  let res = null;
  for (let i = 0; i < 200 && !res; i++) res = m.update(1 / 60);
  assert.equal(res.kind, 'whiff', 'never pressing is an air kick');
});

test('a ground pass arrives at about the planned speed', () => {
  const b = new Ball();
  const v0 = groundPassSpeed(20);
  b.vel.x = v0;
  const t = groundTravelTime(20, v0);
  for (let s = 0; s < t; s += 1 / 240) b.step(1 / 240);
  assert.ok(Math.abs(b.pos.x - 20) < 0.5, `rolled ${b.pos.x}`);
  assert.ok(Math.abs(b.speed - 16) < 0.3);
});

test('kick-off waits for the whistle, then play starts', () => {
  const m = new Match({ rng: mulberry32(1) });
  assert.equal(m.state, 'kickoff');
  assert.equal(m.ball.owner, m.human);
  run(m, 1.2);
  assert.equal(m.state, 'play');
});

test('pressing E passes to a teammate and hands you control of them', () => {
  const m = new Match({ rng: mulberry32(2) });
  run(m, 1.2);
  const passer = m.human;
  m.update(1 / 60, input({ pass: true, move: { x: 0, z: 1 } }));
  assert.equal(m.ball.owner, null);
  assert.ok(m.ball.pass, 'pass is on its way');
  assert.notEqual(m.human, passer);
  assert.equal(m.ball.pass.to, m.human);
});

test('a perfect shot from the penalty spot with the keeper out of the way is a goal', () => {
  const m = new Match({ rng: mulberry32(3) });
  run(m, 1.2);
  const h = m.human;
  for (const p of m.teams[1].players) p.pos = { x: -20, z: p.idx * 3 - 8 };
  h.pos = { x: P.HALF_L - P.PENALTY_SPOT - 0.6, z: 0 };
  h.face = 0;
  m.dribble();
  m.shoot(h, 2.5, evaluateShot({ needle: SWEET_CENTER, window: 0.3, power: 0.8 }));
  const goals = [];
  for (let i = 0; i < 180 && m.state === 'play'; i++) {
    for (const p of m.teams[1].players) p.pos = { x: -20, z: p.idx * 3 - 8 };
    m.update(1 / 60);
    goals.push(...m.drainEvents().filter((e) => e.type === 'goal'));
  }
  assert.equal(goals.length, 1);
  assert.equal(m.teams[0].score, 1);
});

test('an overcooked, skied shot goes over the bar for a goal kick', () => {
  const m = new Match({ rng: mulberry32(4) });
  run(m, 1.2);
  const h = m.human;
  h.pos = { x: 20, z: 0 };
  h.face = 0;
  m.dribble();
  m.shoot(h, 0, evaluateShot({ needle: SWEET_CENTER - 0.33, window: 0.3, power: 1.12 }));
  const evs = [];
  for (let i = 0; i < 180; i++) {
    m.update(1 / 60);
    evs.push(...m.drainEvents());
    if (evs.some((e) => e.type === 'restart')) break;
  }
  const r = evs.find((e) => e.type === 'restart');
  assert.ok(r, 'went out');
  assert.equal(r.kind, 'goal kick');
  assert.equal(m.ball.owner, m.teams[1].players[0]);
});

test('ball over the touchline is a throw-in to the other side', () => {
  const m = new Match({ rng: mulberry32(5) });
  run(m, 1.2);
  for (const p of m.players) if (p !== m.human) p.pos = { x: p.pos.x, z: -15 };
  m.release(m.human, 0, 0, 20);
  const evs = [];
  for (let i = 0; i < 200 && !evs.some((e) => e.type === 'restart'); i++) {
    m.update(1 / 60);
    evs.push(...m.drainEvents());
  }
  const r = evs.find((e) => e.type === 'restart');
  assert.equal(r.kind, 'throw-in');
  assert.equal(r.team, 1);
});

test('a whole match plays out without errors and ends at full time', () => {
  const m = new Match({ seconds: 60, rng: mulberry32(6) });
  const rng = mulberry32(7);
  let events = 0;
  for (let i = 0; i < 60 * 200 && m.state !== 'fulltime'; i++) {
    // Mash buttons at random.
    const inp = input({
      move: { x: rng() * 2 - 1, z: rng() * 2 - 1 },
      sprint: rng() < 0.5,
      pass: rng() < 0.01,
      loft: rng() < 0.005,
      shootPressed: rng() < 0.02,
      shootReleased: rng() < 0.03,
    });
    m.update(1 / 60, inp);
    events += m.drainEvents().length;
    for (const p of m.players) assert.ok(Number.isFinite(p.pos.x) && Number.isFinite(p.pos.z));
    assert.ok(Number.isFinite(m.ball.pos.x) && Number.isFinite(m.ball.pos.y));
  }
  assert.equal(m.state, 'fulltime');
  assert.ok(events > 10);
});

// ---------------------------------------------------------------- kick-off, switching, slides, skill

import { SKILL } from '../src/game/Match.js';

test('at kick-off the other side stays out of your half and the circle until you pass', () => {
  const m = new Match({ rng: mulberry32(10), skill: 'legend' });
  run(m, 5); // wait well past the whistle without touching anything
  assert.equal(m.state, 'play');
  assert.equal(m.ball.owner, m.human, 'still yours');
  for (const p of m.teams[1].players) {
    assert.ok(p.pos.x >= 0.49, `Blues #${p.number} stayed in their half (x=${p.pos.x.toFixed(2)})`);
    assert.ok(Math.hypot(p.pos.x, p.pos.z) >= P.CENTRE_R, `Blues #${p.number} stayed out of the circle`);
  }
  m.update(1 / 60, input({ pass: true }));
  assert.equal(m.restartLock, null, 'the pass ends the kick-off');
  run(m, 2);
  assert.ok(m.teams[1].players.some((p) => p.pos.x < 0 || Math.hypot(p.pos.x, p.pos.z) < P.CENTRE_R), 'then they come for it');
});

test('C picks a teammate and the game does not switch you straight back', () => {
  const m = new Match({ rng: mulberry32(11) });
  run(m, 1.2);
  // The Blues have the ball; you're somewhere.
  m.gain(m.teams[1].players[3]);
  run(m, 0.5);
  const before = m.human;
  m.update(1 / 60, input({ switch: true }));
  const picked = m.human;
  assert.notEqual(picked, before);
  run(m, 1.5);
  assert.equal(m.human, picked, 'still on the one you picked');
  m.update(1 / 60, input({ switch: true }));
  assert.notEqual(m.human, picked, 'pressing again moves on');
});

test('a slide tackle that reaches the ball knocks it loose', () => {
  const m = new Match({ rng: mulberry32(12) });
  run(m, 1.2);
  m.update(1 / 60, input({ pass: true })); // end the kick-off
  const carrier = m.teams[1].players[3];
  for (const p of m.players) if (p !== carrier && !p.isKeeper) p.pos = { x: p.pos.x, z: -18 };
  carrier.pos = { x: 5, z: 0 };
  carrier.face = Math.PI;
  m.gain(carrier);
  carrier.protect = 0;
  const me = m.teams[0].players[3];
  m.ctl[0] = me;
  me.pos = { x: 2, z: 0 };
  me.face = 0;
  const evs = [];
  m.update(1 / 60, input({ slide: true, move: { x: 1, z: 0 } }));
  for (let i = 0; i < 40; i++) {
    carrier.want = { x: 0, z: 0 };
    m.update(1 / 60);
    evs.push(...m.drainEvents());
  }
  assert.ok(evs.some((e) => e.type === 'tackle' && e.slide), 'won it');
  assert.notEqual(m.ball.owner, carrier);
});

test('two people can play: each side follows its own input', () => {
  const m = new Match({ rng: mulberry32(13), sides: [0, 1] });
  assert.ok(m.ctl[0] && m.ctl[1]);
  run(m, 1.2);
  m.update(1 / 60, [input({ pass: true }), input()]); // Reds kick off
  const blue = m.ctl[1];
  const x0 = blue.pos.x;
  for (let i = 0; i < 60; i++) m.update(1 / 60, [input(), input({ move: { x: 1, z: 0 } })]);
  assert.ok(m.ctl[1].pos.x > x0 + 2 || m.ctl[1] !== blue, 'Blues player ran right');
});

test('the computer gets better as the setting goes up', () => {
  assert.ok(SKILL.easy.tackle < SKILL.normal.tackle && SKILL.normal.tackle < SKILL.hard.tackle && SKILL.hard.tackle < SKILL.legend.tackle);
  const m = new Match({ skill: 'hard' });
  assert.equal(m.teams[1].skill, SKILL.hard, 'the computer side');
  assert.equal(m.teams[0].skill, SKILL.normal, 'your teammates stay normal');
});

test('E passes to the nearest teammate, and it gets there fast', () => {
  const m = new Match({ rng: mulberry32(20) });
  run(m, 1.2);
  const me = m.human;
  const mates = m.teams[0].players.filter((p) => p !== me && !p.isKeeper);
  // Put one teammate close behind you and the rest far away in front.
  mates.forEach((p, i) => (p.pos = { x: me.pos.x + 20 + i * 3, z: 10 }));
  const near = mates[0];
  near.pos = { x: me.pos.x - 8, z: me.pos.z + 2 };
  near.vel = { x: 0, z: 0 };
  for (const o of m.teams[1].players) o.pos = { x: o.pos.x, z: -20 };
  m.update(1 / 60, input({ pass: true, move: { x: 1, z: 0 } }));
  assert.equal(m.ball.pass.to, near, 'nearest, even though you were pressing the other way');
  let t = 0;
  while (m.ball.owner !== near && t < 3) {
    near.want = { x: 0, z: 0 };
    m.update(1 / 60);
    t += 1 / 60;
  }
  assert.equal(m.ball.owner, near, 'they got it');
  assert.ok(t < 0.8, `8 m pass took ${t.toFixed(2)} s`);
});
