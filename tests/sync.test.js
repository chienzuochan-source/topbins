import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, NO_INPUT } from '../src/game/Match.js';
import { snapshot, applySnapshot, InputBuffer, RemoteInput } from '../src/net/sync.js';
import { normalizeCode, makeCode } from '../src/net/Online.js';
import { mulberry32 } from '../src/core/math.js';

test('a snapshot copies the match onto the guest', () => {
  const host = new Match({ sides: [0, 1], rng: mulberry32(1) });
  for (let i = 0; i < 400; i++) host.update(1 / 60, [{ ...NO_INPUT, pass: i === 80 }, NO_INPUT]);
  const guest = new Match({ sides: [0, 1] });
  applySnapshot(guest, JSON.parse(JSON.stringify(snapshot(host))));
  assert.equal(guest.state, host.state);
  for (let i = 0; i < host.players.length; i++) {
    assert.ok(Math.abs(guest.players[i].pos.x - host.players[i].pos.x) < 0.01);
    assert.ok(Math.abs(guest.players[i].pos.z - host.players[i].pos.z) < 0.01);
  }
  assert.ok(Math.abs(guest.ball.pos.x - host.ball.pos.x) < 0.01);
  assert.equal(guest.ctl[1] && guest.players.indexOf(guest.ctl[1]), host.players.indexOf(host.ctl[1]));
  assert.equal(guest.ball.owner ? guest.players.indexOf(guest.ball.owner) : -1, host.ball.owner ? host.players.indexOf(host.ball.owner) : -1);
});

test("a quick tap on the guest's side still reaches the host", () => {
  const buf = new InputBuffer();
  buf.add({ ...NO_INPUT, move: { x: 1, z: 0 }, pass: true });
  buf.add({ ...NO_INPUT, move: { x: 1, z: 0 } }); // tap already let go before the send
  const msg = JSON.parse(JSON.stringify(buf.take()));
  const r = new RemoteInput();
  r.receive(msg);
  const a = r.take();
  assert.equal(a.pass, true);
  assert.equal(a.move.x, 1);
  assert.equal(r.take().pass, false, 'counts once');
});

test('press and release of shoot in one message arrive a frame apart', () => {
  const r = new RemoteInput();
  r.receive({ t: 'in', mv: [0, 0], sp: false, shootPressed: true, shootReleased: true });
  const a = r.take(), b = r.take();
  assert.ok(a.shootPressed && !a.shootReleased);
  assert.ok(b.shootReleased && !b.shootPressed);
});

test('room codes', () => {
  assert.equal(normalizeCode(' ab-c d '), 'ABCD');
  assert.match(makeCode(), /^[A-Z2-9]{4}$/);
});
