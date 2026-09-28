// Draws the match with three.js: pitch, goals, stands, players and ball, seen
// from a TV-style camera on the halfway line that follows the play.

import * as THREE from 'three';
import * as P from '../game/pitch.js';
import { damp, clamp } from '../core/math.js';

const MARGIN = 6; // grass beyond the lines
const BALL_VIS_R = 0.19; // drawn a bit bigger than life so you can follow it

const KITS = [
  { shirt: '#d8313b', shorts: '#f4f1ea', socks: '#d8313b', keeper: '#f2d13a' },
  { shirt: '#2f6fd6', shorts: '#12213d', socks: '#2f6fd6', keeper: '#3fbf6a' },
];
const SKIN = ['#f1c7a4', '#d9a27a', '#a8704a', '#6d452c', '#e8b48f'];
const HAIR = ['#2a1a10', '#5a3a1e', '#111111', '#c9a25a', '#7a2f16'];

export class Scene {
  // lite: phones and tablets draw fewer pixels and softer shadows.
  constructor(canvas, match, { lite = false } = {}) {
    this.match = match;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !lite, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1.5 : 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;

    const s = (this.scene = new THREE.Scene());
    s.background = new THREE.Color('#8fbfe6');
    s.fog = new THREE.Fog('#8fbfe6', 90, 190);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 400);
    this.focus = new THREE.Vector3(0, 0, 0);

    s.add(new THREE.HemisphereLight('#dcecff', '#3d6b30', 1.15));
    const sun = new THREE.DirectionalLight('#fff3dc', 2.3);
    sun.position.set(-25, 55, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048);
    const sc = sun.shadow.camera;
    sc.left = -48;
    sc.right = 48;
    sc.top = 34;
    sc.bottom = -34;
    sc.near = 10;
    sc.far = 140;
    sun.shadow.bias = -0.0004;
    s.add(sun);

    this.buildPitch();
    this.buildGoals();
    this.buildStadium();
    this.buildPlayers();
    this.buildBall();
    this.buildMarkers();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait screens need a wider view to see much of the pitch.
    this.camera.fov = w / h < 1 ? 70 : 38;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- build

  buildPitch() {
    const L = 2 * (P.HALF_L + MARGIN), W = 2 * (P.HALF_W + MARGIN);
    const ppm = 28; // pixels per metre
    const c = document.createElement('canvas');
    c.width = Math.round(L * ppm);
    c.height = Math.round(W * ppm);
    const g = c.getContext('2d');
    const X = (x) => (x + P.HALF_L + MARGIN) * ppm;
    const Z = (z) => (z + P.HALF_W + MARGIN) * ppm;

    // Mown stripes.
    const stripes = 14, sw = c.width / stripes;
    for (let i = 0; i < stripes; i++) {
      g.fillStyle = i % 2 ? '#3f8c37' : '#479a3e';
      g.fillRect(i * sw, 0, sw + 1, c.height);
    }
    // A little speckle so it reads as grass.
    const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 14;
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n * 0.5;
    }
    g.putImageData(img, 0, 0);

    g.strokeStyle = 'rgba(255,255,255,0.92)';
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.lineWidth = 0.12 * ppm;
    const rect = (x0, z0, x1, z1) => g.strokeRect(X(x0), Z(z0), X(x1) - X(x0), Z(z1) - Z(z0));
    const circle = (x, z, r, a0 = 0, a1 = Math.PI * 2) => {
      g.beginPath();
      g.arc(X(x), Z(z), r * ppm, a0, a1);
      g.stroke();
    };
    const spot = (x, z) => {
      g.beginPath();
      g.arc(X(x), Z(z), 0.2 * ppm, 0, Math.PI * 2);
      g.fill();
    };
    rect(-P.HALF_L, -P.HALF_W, P.HALF_L, P.HALF_W);
    g.beginPath();
    g.moveTo(X(0), Z(-P.HALF_W));
    g.lineTo(X(0), Z(P.HALF_W));
    g.stroke();
    circle(0, 0, P.CENTRE_R);
    spot(0, 0);
    for (const e of [-1, 1]) {
      const lx = e * P.HALF_L;
      rect(Math.min(lx, lx - e * P.BOX_DEPTH), -P.BOX_HALF_W, Math.max(lx, lx - e * P.BOX_DEPTH), P.BOX_HALF_W);
      rect(Math.min(lx, lx - e * P.SIX_DEPTH), -P.SIX_HALF_W, Math.max(lx, lx - e * P.SIX_DEPTH), P.SIX_HALF_W);
      const sx = lx - e * P.PENALTY_SPOT;
      spot(sx, 0);
      // The D: the bit of the penalty arc outside the box.
      const edge = P.BOX_DEPTH - P.PENALTY_SPOT, r = 7, a = Math.acos(edge / r);
      if (e > 0) circle(sx, 0, r, Math.PI - a, Math.PI + a);
      else circle(sx, 0, r, -a, a);
      // Corner arcs: a quarter circle facing into the pitch.
      for (const zs of [-1, 1]) {
        const a0 = e > 0 ? (zs > 0 ? Math.PI : Math.PI / 2) : zs > 0 ? Math.PI * 1.5 : 0;
        circle(lx, zs * P.HALF_W, 1, a0, a0 + Math.PI / 2);
      }
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(L, W),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    // Running track colour beyond the grass.
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(L + 60, W + 60),
      new THREE.MeshStandardMaterial({ color: '#2f5a2a', roughness: 1 }),
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.02;
    apron.receiveShadow = true;
    this.scene.add(apron);
  }

  buildGoals() {
    const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 });
    const netMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45 });
    for (const e of [-1, 1]) {
      const g = new THREE.Group();
      const lx = e * P.HALF_L;
      for (const z of [-P.GOAL_HALF_W, P.GOAL_HALF_W]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(P.POST_R, P.POST_R, P.GOAL_H, 12), white);
        post.position.set(lx, P.GOAL_H / 2, z);
        post.castShadow = true;
        g.add(post);
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(P.POST_R, P.POST_R, 2 * P.GOAL_HALF_W + 0.12, 12), white);
      bar.rotation.x = Math.PI / 2;
      bar.position.set(lx, P.GOAL_H, 0);
      bar.castShadow = true;
      g.add(bar);

      // Net: back, roof and sides as a grid of lines.
      const pts = [];
      const bx = lx + e * P.GOAL_DEPTH, step = 0.25;
      for (let z = -P.GOAL_HALF_W; z <= P.GOAL_HALF_W + 1e-6; z += step) {
        pts.push(bx, 0, z, bx, P.GOAL_H, z); // back, vertical
        pts.push(lx, P.GOAL_H, z, bx, P.GOAL_H, z); // roof, front to back
      }
      for (let y = 0; y <= P.GOAL_H + 1e-6; y += step) {
        pts.push(bx, y, -P.GOAL_HALF_W, bx, y, P.GOAL_HALF_W);
        for (const z of [-P.GOAL_HALF_W, P.GOAL_HALF_W]) pts.push(lx, y, z, bx, y, z);
      }
      for (let x = 0; x <= P.GOAL_DEPTH + 1e-6; x += step) {
        const xx = lx + e * x;
        pts.push(xx, P.GOAL_H, -P.GOAL_HALF_W, xx, P.GOAL_H, P.GOAL_HALF_W);
        for (const z of [-P.GOAL_HALF_W, P.GOAL_HALF_W]) pts.push(xx, 0, z, xx, P.GOAL_H, z);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      g.add(new THREE.LineSegments(geo, netMat));
      this.scene.add(g);
    }
  }

  buildStadium() {
    // Advertising boards.
    const boardTex = (() => {
      const c = document.createElement('canvas');
      c.width = 1024;
      c.height = 64;
      const g = c.getContext('2d');
      const words = ['TOP BINS', 'FAIRGREENS', 'TOP BINS', 'HANK’S BOOTS'];
      const cols = ['#d8313b', '#1c3f7a', '#f0c46a', '#1b7a4a'];
      for (let i = 0; i < 4; i++) {
        g.fillStyle = cols[i];
        g.fillRect(i * 256, 0, 256, 64);
        g.fillStyle = i === 2 ? '#1a1a1a' : '#ffffff';
        g.font = 'bold 34px Arial Narrow, Arial, sans-serif';
        g.textAlign = 'center';
        g.fillText(words[i], i * 256 + 128, 45);
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = THREE.RepeatWrapping;
      return t;
    })();
    const boardAt = (len, x, z, rotY) => {
      const tex = boardTex.clone();
      tex.needsUpdate = true;
      tex.repeat.set(len / 24, 1);
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(len, 0.9, 0.12),
        new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.25 }),
      );
      m.position.set(x, 0.45, z);
      m.rotation.y = rotY;
      m.castShadow = true;
      this.scene.add(m);
    };
    const bz = P.HALF_W + 3.5, bx = P.HALF_L + 4;
    boardAt(2 * bx, 0, -bz, 0);
    boardAt(2 * bx, 0, bz, Math.PI);
    boardAt(2 * bz, -bx, 0, Math.PI / 2);
    boardAt(2 * bz, bx, 0, -Math.PI / 2);

    // Stands full of people: stepped tiers with a speckled crowd texture.
    const crowd = (() => {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#2a2d36';
      g.fillRect(0, 0, 512, 128);
      const shirts = ['#d8313b', '#d8313b', '#2f6fd6', '#2f6fd6', '#f2f2f2', '#f0c46a', '#333', '#8a8f99'];
      for (let y = 4; y < 128; y += 8) {
        for (let x = 2; x < 512; x += 5) {
          if (Math.random() < 0.12) continue;
          g.fillStyle = shirts[(Math.random() * shirts.length) | 0];
          g.fillRect(x + Math.random() * 1.5, y, 3, 4);
          g.fillStyle = SKIN[(Math.random() * SKIN.length) | 0];
          g.fillRect(x + 0.5, y - 2.5, 2, 2);
        }
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      return t;
    })();
    const standMat = (len) => {
      const t = crowd.clone();
      t.needsUpdate = true;
      t.repeat.set(len / 20, 1);
      return new THREE.MeshStandardMaterial({ map: t, roughness: 1 });
    };
    const roofMat = new THREE.MeshStandardMaterial({ color: '#c9ccd2', roughness: 0.6, metalness: 0.2 });
    const stand = (len, cx, cz, rotY, far) => {
      const g = new THREE.Group();
      const depth = 16, rise = 11;
      const geo = new THREE.PlaneGeometry(len, Math.hypot(depth, rise));
      const m = new THREE.Mesh(geo, standMat(len));
      m.rotation.x = -Math.atan2(rise, depth);
      m.position.set(0, rise / 2 + 1, -depth / 2);
      g.add(m);
      const back = new THREE.Mesh(new THREE.BoxGeometry(len, rise + 6, 1), new THREE.MeshStandardMaterial({ color: '#3a3f4a' }));
      back.position.set(0, (rise + 6) / 2, -depth - 0.5);
      g.add(back);
      if (far) {
        const roof = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, depth * 0.7), roofMat);
        roof.position.set(0, rise + 6, -depth * 0.62);
        roof.rotation.x = -0.08;
        g.add(roof);
      }
      g.position.set(cx, 0, cz);
      g.rotation.y = rotY;
      this.scene.add(g);
    };
    const sz = P.HALF_W + 6, sx = P.HALF_L + 7;
    stand(2 * sx + 20, 0, -sz, 0, true);
    stand(2 * sz + 10, -sx, 0, Math.PI / 2, false);
    stand(2 * sz + 10, sx, 0, -Math.PI / 2, false);
  }

  buildPlayers() {
    this.playerMeshes = this.match.players.map((p, i) => makePlayerMesh(p, i));
    for (const m of this.playerMeshes) this.scene.add(m.root);
  }

  buildBall() {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#fbfbf8';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#181818';
    for (let i = 0; i < 12; i++) {
      const x = ((i * 53) % 256) + (i % 2) * 20, y = 18 + ((i * 37) % 92);
      g.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        g.lineTo(x + Math.cos(a) * 13, y + Math.sin(a) * 13);
      }
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.ballMesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_VIS_R, 24, 16),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 }),
    );
    this.ballMesh.castShadow = true;
    this.scene.add(this.ballMesh);
  }

  buildMarkers() {
    // For each side a person plays: a ring under their player, an arrow over
    // their head, and a target on the goal while they shoot. Reds yellow,
    // Blues cyan.
    this.markers = ['#ffe066', '#7ff0ff'].map((color) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.55, 0.72, 32),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 2;
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 3), new THREE.MeshBasicMaterial({ color }));
      arrow.rotation.x = Math.PI;
      const aim = new THREE.Mesh(
        new THREE.RingGeometry(0.28, 0.4, 24),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
      );
      aim.rotation.y = Math.PI / 2;
      this.scene.add(ring, arrow, aim);
      return { ring, arrow, aim };
    });
    // Where a pass is going.
    this.passRing = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.5, 24),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6, depthWrite: false }),
    );
    this.passRing.rotation.x = -Math.PI / 2;
    this.scene.add(this.passRing);
  }

  // ---------------------------------------------------------------- frame

  render(dt, t) {
    const m = this.match, b = m.ball;

    // Players.
    for (let i = 0; i < m.players.length; i++) poseMesh(this.playerMeshes[i], m.players[i], m, t);

    // Ball: roll it along the way it's travelling.
    const bm = this.ballMesh;
    bm.position.set(b.pos.x, b.pos.y - P.BALL_R + BALL_VIS_R, b.pos.z);
    const sp = Math.hypot(b.vel.x, b.vel.z);
    if (sp > 0.05) {
      const axis = new THREE.Vector3(b.vel.z, 0, -b.vel.x).normalize();
      bm.rotateOnWorldAxis(axis, (sp * dt) / BALL_VIS_R);
    }

    // Markers for whoever people are controlling.
    for (let side = 0; side < 2; side++) {
      const mk = this.markers[side], h = m.ctl[side];
      mk.ring.visible = mk.arrow.visible = !!h && m.state !== 'fulltime';
      if (h) {
        mk.ring.position.set(h.pos.x, 0.03, h.pos.z);
        mk.arrow.position.set(h.pos.x, 2.45 + Math.sin(t * 5 + side) * 0.08, h.pos.z);
        mk.arrow.rotation.y = t * 2;
      }
      const aim = m.shotTarget(side);
      mk.aim.visible = !!aim;
      if (aim) {
        mk.aim.position.set(aim.x, 1.2, aim.z);
        mk.aim.scale.setScalar(1 + Math.sin(t * 10) * 0.08);
      }
    }
    this.passRing.visible = !!(b.pass && !b.owner);
    if (b.pass) this.passRing.position.set(b.pass.point.x, 0.04, b.pass.point.z);

    // Camera: TV gantry on the halfway line, panning to follow the ball.
    const fx = clamp(b.pos.x, -P.HALF_L + 10, P.HALF_L - 10);
    const fz = clamp(b.pos.z, -P.HALF_W + 4, P.HALF_W - 4);
    this.focus.x = damp(this.focus.x, fx, 3.2, dt);
    this.focus.z = damp(this.focus.z, fz, 2.2, dt);
    const portrait = this.camera.aspect < 1;
    // Portrait: higher and steeper, so the pitch fills the tall screen instead of the stands.
    const back = portrait ? 20 : 30, up = portrait ? 40 : 23;
    this.camera.position.set(this.focus.x * 0.92, up, this.focus.z * 0.35 + back);
    this.camera.lookAt(this.focus.x, 0, this.focus.z * 0.75 - 1.5);

    this.renderer.render(this.scene, this.camera);
  }
}

// ---------------------------------------------------------------- players

function mat(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
}

function numberTexture(n, shirt) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = shirt;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#ffffff';
  g.font = 'bold 40px Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText(String(n), 32, 47);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makePlayerMesh(p, i) {
  const kit = KITS[p.team.side];
  const shirt = p.isKeeper ? kit.keeper : kit.shirt;
  const skin = mat(SKIN[(i * 7) % SKIN.length]);
  const root = new THREE.Group();
  const body = new THREE.Group(); // tilts when diving or knocked over
  root.add(body);

  const box = (w, h, d, m, x, y, z, parent = body) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // Legs hang from the hips and swing about the sideways (z) axis.
  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group();
    hip.position.set(0, 0.92, s * 0.12);
    body.add(hip);
    box(0.15, 0.42, 0.16, skin, 0, -0.3, 0, hip);
    box(0.16, 0.34, 0.17, mat(kit.socks), 0, -0.68, 0, hip);
    box(0.28, 0.1, 0.14, mat('#1a1a1a'), 0.06, -0.87, 0, hip);
    return hip;
  });
  box(0.36, 0.26, 0.4, mat(p.isKeeper ? '#222222' : kit.shorts), 0, 0.92, 0);
  // Shirt, with the number on the back.
  const back = numberTexture(p.number, shirt);
  const shirtMat = mat(shirt);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.46), [
    shirtMat, // +x front
    new THREE.MeshStandardMaterial({ map: back, roughness: 0.7 }), // -x back
    shirtMat,
    shirtMat,
    shirtMat,
    shirtMat,
  ]);
  torso.position.set(0, 1.35, 0);
  torso.castShadow = true;
  body.add(torso);
  const arms = [-1, 1].map((s) => {
    const sh = new THREE.Group();
    sh.position.set(0, 1.6, s * 0.3);
    body.add(sh);
    box(0.13, 0.3, 0.13, shirtMat, 0, -0.14, 0, sh);
    box(0.11, 0.3, 0.11, p.isKeeper ? mat('#f5f5f5') : skin, 0, -0.44, 0, sh);
    return sh;
  });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), skin);
  head.position.set(0, 1.85, 0);
  head.castShadow = true;
  body.add(head);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.155, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.2),
    mat(HAIR[(i * 3) % HAIR.length]),
  );
  hair.position.set(-0.01, 1.87, 0);
  hair.rotation.z = 0.25;
  body.add(hair);

  return { root, body, legs, arms, hop: 0 };
}

function poseMesh(pm, p, m, t) {
  const { root, body, legs, arms } = pm;
  root.position.set(p.pos.x, 0, p.pos.z);
  root.rotation.y = -p.face;

  const sp = p.speed;
  const stride = Math.min(1, sp / 6) * 0.75;
  const s = Math.sin(p.run);
  legs[0].rotation.z = s * stride;
  legs[1].rotation.z = -s * stride;
  arms[0].rotation.z = -s * stride * 0.8;
  arms[1].rotation.z = s * stride * 0.8;

  // Kicking: the right leg swings through.
  if (p.kickAnim > 0) {
    const k = p.kickAnim / 0.3;
    legs[1].rotation.z = -0.6 + 1.9 * (1 - k);
  }
  // Winding up a shot: the right leg drawn back.
  const meter = m.meters[p.team.side];
  if (m.ctl[p.team.side] === p && meter.phase === 'windup') legs[1].rotation.z = -0.4 - 0.9 * Math.min(1, meter.power);

  body.rotation.set(0, 0, 0);
  body.position.y = 0;
  arms[0].rotation.x = arms[1].rotation.x = 0;
  if (p.slideT > 0) {
    // Slide tackle: leaning right back, legs out in front, skimming the grass.
    body.rotation.z = 1.15;
    body.position.y = -0.5;
    legs[0].rotation.z = 0.2;
    legs[1].rotation.z = 0.5;
    arms[0].rotation.z = arms[1].rotation.z = -0.9;
  } else if (p.diveT > 0) {
    // Full stretch, sideways.
    const lean = Math.min(1, (0.55 - p.diveT) / 0.2);
    body.rotation.x = p.diveDir * 1.35 * lean * (Math.cos(p.face) < 0 ? -1 : 1);
    body.position.y = 0.5 * lean;
    arms[0].rotation.z = arms[1].rotation.z = Math.PI * 0.9;
  } else if (p.stun > 0) {
    body.rotation.z = 1.2 * Math.min(1, p.stun / 0.3);
  } else if (m.state === 'goal' && p.team.side === m.lastGoal) {
    body.position.y = Math.abs(Math.sin(t * 7 + p.idx)) * 0.35;
    arms[0].rotation.x = -2.6;
    arms[1].rotation.x = 2.6;
  } else {
    body.rotation.z = -Math.min(0.2, sp * 0.025); // lean into the run
  }
  if (p.isKeeper && m.ball.owner === p) {
    arms[0].rotation.z = arms[1].rotation.z = 1.2;
  }
}
