// Online play, peer to peer. The player who makes a room hosts it: their
// browser runs the match, and their friend's browser connects straight to
// them over WebRTC. PeerJS's free public service is only used to find each
// other. No server of our own and no accounts. Rooms are for two players:
// the host plays the Reds and the guest plays the Blues.

import Peer from 'peerjs';

const PREFIX = 'top-bins-v1-'; // peer ids are shared across the whole PeerJS service
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I/L mix-ups

export const makeCode = (rng = Math.random) => Array.from({ length: 4 }, () => LETTERS[(rng() * LETTERS.length) | 0]).join('');
export const normalizeCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

// STUN finds a direct route between the two players. When a network blocks
// that (many mobile networks and strict routers do), TURN relays it instead.
const ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

function peerOptions() {
  const o = { debug: 0, config: { iceServers: ICE } };
  // VITE_PEER_HOST=localhost:9000 uses a local PeerJS server (`npx peerjs --port 9000`).
  const local = import.meta.env?.VITE_PEER_HOST;
  if (local) {
    const [host, port] = local.split(':');
    Object.assign(o, { host, port: Number(port) || 9000, path: '/', secure: false });
  }
  return o;
}

const WHY = {
  'peer-unavailable': 'There is no room with that code. Check it and try again.',
  'unavailable-id': 'That room code is taken. Try again for a new one.',
  network: "Couldn't reach the matchmaking service. Check your internet connection.",
  'server-error': "Couldn't reach the matchmaking service. Try again in a moment.",
  'socket-error': "Couldn't reach the matchmaking service. Try again in a moment.",
  'browser-incompatible': "This browser can't do online play.",
};

// Events: onReady(code), onConnected(), onMessage(msg), onClosed(reason), onError(text).
export class Online {
  constructor(handlers) {
    this.h = handlers;
    this.peer = null;
    this.conn = null;
    this.closed = false;
  }

  host(code = makeCode()) {
    this.role = 'host';
    this.code = code;
    this.peer = new Peer(PREFIX + code, peerOptions());
    this.peer.on('open', () => this.h.onReady?.(code));
    this.peer.on('connection', (conn) => {
      if (this.conn) {
        // Room's full.
        conn.on('open', () => {
          conn.send({ t: 'full' });
          setTimeout(() => conn.close(), 300);
        });
        return;
      }
      this.#wire(conn);
    });
    this.#errors();
  }

  join(code) {
    this.role = 'guest';
    this.code = code;
    this.peer = new Peer(peerOptions());
    this.peer.on('open', () => this.#wire(this.peer.connect(PREFIX + code, { reliable: true })));
    this.#errors();
    // Some failures never raise an error: give up after a while.
    this.timer = setTimeout(() => {
      if (!this.conn?.open) this.#fail('Nobody answered. Check the code, and that your friend still has the room open.');
    }, 15000);
  }

  #wire(conn) {
    this.conn = conn;
    conn.on('open', () => {
      clearTimeout(this.timer);
      this.h.onConnected?.();
    });
    conn.on('data', (msg) => {
      if (msg?.t === 'full') return this.#fail('That room already has two players.');
      this.h.onMessage?.(msg);
    });
    conn.on('close', () => {
      if (this.closed) return;
      this.h.onClosed?.(this.role === 'host' ? 'Your friend left the match.' : 'The host left the match.');
      if (this.role === 'host') this.conn = null; // the room stays open for them to come back
    });
    conn.on('error', () => {});
  }

  #errors() {
    this.peer.on('error', (err) => this.#fail(WHY[err?.type] || `Online play didn't work (${err?.type || 'unknown problem'}).`));
    this.peer.on('disconnected', () => {
      // Lost the matchmaking service; an open game carries on over WebRTC.
      if (!this.closed) this.peer.reconnect?.();
    });
  }

  #fail(text) {
    if (this.closed) return;
    this.h.onError?.(text);
    this.close();
  }

  get connected() {
    return !!this.conn?.open;
  }

  send(msg) {
    if (this.conn?.open) this.conn.send(msg);
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    try {
      this.conn?.close();
      this.peer?.destroy();
    } catch {
      // Already gone.
    }
  }
}
