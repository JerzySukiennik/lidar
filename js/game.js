// LiDAR Point Cloud 001: the game session (round setup, player, scanning, creatures, other operators, fear, death and the bottom).

import * as THREE from 'three';
import { World, THEMES, FLOOR_Y, T_MONSTER } from './world.js';
import { buildGeometry, Caster } from './geometry.js';
import { Bodies, human, creature, sampleSurface, CAP, HUMAN_CAPS, CREATURE_CAPS } from './figure.js';
import { Scanner, basis } from './scanner.js';
import { Player, WALK } from './player.js';
import { Pack, ROAM, STALK, LISTEN, HUNT, SEARCH, FEED, STATUE } from './monster.js';
import { T_LIVE_RED, T_FACE } from './cloud.js';

const HISTORY = 300, FOV = 78;
const GAIT_NOISE = [0, 1.5, 6, 18];
const AMB = { amb_station: [0.5, 0.42, 0.16, 0.04, 0], amb_deep: [0.06, 0.14, 0.36, 0.5, 0.62], amb_drip: [0, 0, 0.1, 0.3, 0.14] };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const OCCLUDER = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });

export class Game {
  constructor(app) {
    this.app = app;
    this.bodies = new Bodies();
    this.remote = new Map();
    this.state = 'idle';
    this.keys = new Set();
    this.mouse = { l: false, r: false };
    this.charge = 0;
    this.charging = false;
    this.cool = 0;
    this.fear = 0;
    this.kick = 0;
    this.deadT = 0;
    this.poseT = 0; this.poseIdle = 0; this.lastPose = '';
    this.streamT = 0; this.monT = 0; this.noiseT = 0;
    this.stingT = 30 + Math.random() * 40;
    this.phantomT = 60;
    this.seenT = 0; this.clickT = 0;
    this.god = false;
    this.pending = null;
    this.monCaps = [];
    this.monMeta = [];
    this.scareCaps = new Float32Array(CAP * CREATURE_CAPS);
    this.tmp = new Float32Array(3);
    this.muzzle = new THREE.Vector3();
    this.b = {};
    this.bindNet();
  }

  now() { return (this.app.net.now() - this.epoch) / 1000; }

  bindNet() {
    const net = this.app.net, ui = this.app.ui;
    net.on.round = (r) => { if (this.state === 'idle') this.pending = r; else this.setRound(r); };
    net.on.player = (id, v) => this.onPlayer(id, v);
    net.on.left = (id) => this.remote.delete(id);
    net.on.monsters = (a) => { if (this.pack) this.pack.apply(a); };
    net.on.scan = (v) => this.onScan(v);
    net.on.win = (v) => this.onWin(v);
    net.on.event = (v) => {
      if (!this.pack) return;
      if (v.k === 'death') { ui.toast(`${v.n} WAS TAKEN`); if (net.isHost) this.pack.fed(v.m); }
      else if (v.k === 'seen' && net.isHost) this.pack.scanned(v.m, v.x / 100, v.z / 100, v.p, this.now());
    };
  }

  enter(name) {
    const app = this.app;
    this.name = name;
    app.net.join(name);
    this.state = 'play';
    const u = app.cloud.uniforms;
    u.uFade.value = 1;
    u.uEnvLife.value = 300;
    u.uEnvFloor.value = 0.62;
    app.camera.fov = FOV;
    app.camera.near = 0.04;
    app.camera.far = 260;
    app.camera.up.set(0, 1, 0);
    app.camera.updateProjectionMatrix();
    this.resize();
    this.setRound(this.pending || app.net.round);
    app.ui.hud(true);
    app.ui.hint(true);
  }

  resize() {
    const app = this.app;
    app.cloud.resize(app.height, FOV, app.dpr);
  }

  setRound(r) {
    const app = this.app;
    this.round = r;
    this.world = new World(r.seed);
    const built = buildGeometry(this.world);
    if (this.mesh) { app.scene.remove(this.mesh); this.mesh.geometry.dispose(); }
    if (this.mesh2) { app.scene.remove(this.mesh2); this.mesh2.geometry.dispose(); }
    this.mesh = new THREE.Mesh(built.geometry, OCCLUDER);
    this.mesh2 = new THREE.Mesh(built.extra, OCCLUDER);
    this.mesh.frustumCulled = false;
    this.mesh2.frustumCulled = false;
    app.scene.add(this.mesh, this.mesh2);
    this.caster = new Caster(built);
    this.scanner = new Scanner(this.caster, app.cloud, app.beams, this.bodies);
    this.scanner.fixed = built.fixed;
    this.scanner.onHit = (kind, id, own) => this.onHit(kind, id, own);
    this.pack = new Pack(this.world);
    this.pack.onState = (m, prev, next) => this.onMonsterState(m, prev, next);
    this.monCaps = this.pack.list.map(() => new Float32Array(CAP * CREATURE_CAPS));
    this.monMeta = this.pack.list.map(() => new Float32Array(5));
    this.player = new Player(this.world);
    const q = this.app.params, f = clamp(Number(q.get('f') || 0), 0, 4);
    this.player.place(this.world.arrivals[f]);
    app.cloud.clear();
    app.beams.clear();
    this.epoch = app.net.now() - HISTORY * 1000;
    this.won = null;
    this.floorShown = -1;
    this.charging = false;
    this.fear = 0;
    this.state = 'play';
    app.ui.win(null);
    app.ui.dead(false);
  }

  key(code, down) {
    if (down) this.keys.add(code); else this.keys.delete(code);
  }

  button(b, down) {
    if (b === 0) this.mouse.l = down;
    if (b === 2) this.mouse.r = down;
  }

  look(dx, dy) { if (this.state === 'play') this.player.look(dx, dy); }

  wheel(dy) {
    if (this.scanner) this.scanner.spread = clamp(this.scanner.spread * (dy > 0 ? 1.18 : 0.85), 0.008, 0.3);
  }

  onPlayer(id, v) {
    if (!v || !v.d || !v.s) return;
    let R = this.remote.get(id);
    const x = v.d[0] / 100, y = v.d[1] / 100, z = v.d[2] / 100;
    if (!R) {
      R = { id, x, y, z, yaw: v.d[3] / 1000, phase: 0, step: 0, move: 0, caps: new Float32Array(CAP * HUMAN_CAPS) };
      this.remote.set(id, R);
    }
    R.name = v.n; R.tx = x; R.ty = y; R.tz = z; R.tyaw = v.d[3] / 1000; R.pitch = v.d[4] / 1000;
    R.f = v.s[0]; R.gait = v.s[1]; R.scan = v.s[2]; R.mic = v.s[3]; R.alive = v.s[4] === 1; R.crouch = v.s[5]; R.t = v.t;
    if (Math.hypot(x - R.x, z - R.z) > 6) { R.x = x; R.y = y; R.z = z; }
  }

  onScan(v) {
    const net = this.app.net, snd = this.app.sound, p = this.player;
    if (!this.scanner || this.state === 'idle' || !v.d || v.t < this.round.t0 - 5000) return;
    const age = (net.now() - v.t) / 1000, d = v.d, now = this.now();
    if (v.k === 1) {
      const x = d[0] / 100, y = d[1] / 100, z = d[2] / 100, power = clamp(d[5] / 100, 0, 1);
      if (age < 2.5) {
        this.scanner.burst(x, y, z, d[3] / 1000, d[4] / 1000, power, d[6], now, v.p, false, null);
        if (Math.abs(v.f - p.f) <= 1) snd.at('shock', x, y, z, 0.5 + 0.5 * power, 1, this.walls(x, z, v.f), 3);
        if (net.isHost) this.pack.noise(v.f, x, z, 26 + 24 * power, v.p, now);
      } else if (age < HISTORY - 15) this.scanner.burst(x, y, z, d[3] / 1000, d[4] / 1000, power, d[6], now, v.p, false, (v.t - this.epoch) / 1000);
    } else if (age < 5 && d.length >= 18) {
      const P = (o) => [d[o] / 100, d[o + 1] / 100, d[o + 2] / 100, d[o + 3] / 1000, d[o + 4] / 1000];
      const ev = { n: d[0], s: d[1] / 1000, seed: d[2], p0: P(3), p1: P(8), p2: P(13) };
      this.scanner.replayStream(ev, now, v.p);
      if (v.f === p.f && Math.hypot(ev.p2[0] - p.x, ev.p2[2] - p.z) < 30) {
        snd.at('geiger', ev.p2[0], ev.p2[1], ev.p2[2], 0.5, 1.5, this.walls(ev.p2[0], ev.p2[2], v.f), 2, Math.random() * 8, 0.22);
      }
    }
  }

  onWin(v) {
    if (this.won || this.state === 'idle') return;
    this.won = { ...v, at: performance.now(), asked: false };
    this.state = 'won';
    this.app.ui.win(v.name, v.p === this.app.net.id);
    this.app.sound.play('gong', 0.9, 1, 0, 0.4);
  }

  onHit(kind, id, own) {
    if (kind !== 2 || !own) return;
    const now = this.now(), net = this.app.net, p = this.player, m = this.pack.list[id];
    if (now - this.seenT > 0.3) {
      this.seenT = now;
      if (net.isHost) this.pack.scanned(id, p.x, p.z, net.id, now);
      else net.sendEvent('seen', { m: id, x: Math.round(p.x * 100), z: Math.round(p.z * 100) });
    }
    if (m && now - this.clickT > 4.5) {
      this.clickT = now;
      this.app.sound.at(pick(['m_click1', 'm_click2', 'm_click3']), m.x, this.world.groundY(m.f, m.x, m.z) + 2, m.z, 1.1, 0.9, this.walls(m.x, m.z, m.f), 3);
    }
  }

  walls(x, z, f) {
    const p = this.player;
    if (f !== p.f) return 3;
    return Math.min(3, this.world.wallsBetween(f, p.x, p.z, x, z));
  }

  onMonsterState(m, prev, next) {
    const p = this.player;
    if (!p || this.state === 'idle' || m.f !== p.f) return;
    const snd = this.app.sound, y = this.world.groundY(m.f, m.x, m.z) + 2, w = this.walls(m.x, m.z, m.f);
    if (next === HUNT) snd.at('m_shriek', m.x, y, m.z, 1.7, 1, Math.min(1, w), 7);
    else if (next === STALK && prev === ROAM) snd.at(pick(['m_growl1', 'm_growl2', 'm_growl3']), m.x, y, m.z, 1, 0.85, w, 4);
    else if (next === LISTEN) snd.at(pick(['bone1', 'bone2', 'bone3', 'bone4']), m.x, y, m.z, 0.9, 0.8, w, 3);
    else if (next === SEARCH) snd.at('m_throat2', m.x, y, m.z, 1, 0.9, w, 4);
    else if (next === ROAM && prev === SEARCH) snd.at('m_groan', m.x, y, m.z, 0.9, 0.8, w, 4);
  }

  gait() {
    const p = this.player;
    if (p.speed < 0.5) return 0;
    return p.sprinting ? 3 : p.crouch > 0.5 ? 1 : 2;
  }

  fireBurst(now) {
    const p = this.player, net = this.app.net, snd = this.app.sound, power = Math.max(0.06, this.charge), seed = Math.floor(Math.random() * 2147483647);
    const y = p.eyeY();
    this.scanner.burst(p.x, y, p.z, p.yaw, p.pitch, power, seed, now, null, true, null);
    if (this.chargeSnd) { this.chargeSnd.g.gain.value = 0; this.chargeSnd = null; }
    snd.play('shock', 0.3 + 0.45 * power, 1.05 - 0.15 * power, 0, 0.5);
    snd.play('thump', 0.35 + 0.5 * power, 1, 0, 0.4);
    net.sendScan(1, p.f, [Math.round(p.x * 100), Math.round(y * 100), Math.round(p.z * 100), Math.round(p.yaw * 1000), Math.round(p.pitch * 1000), Math.round(power * 100), seed]);
    if (net.isHost) this.pack.noise(p.f, p.x, p.z, 26 + 24 * power, net.id, now);
    this.kick = power;
    this.cool = 0.35;
    this.charge = 0;
    this.maybePhantom(now, power);
  }

  maybePhantom(now, power) {
    const p = this.player, chance = [0, 0.05, 0.08, 0.11, 0.13][p.f];
    if (now - this.phantomT < 75 || power < 0.4 || Math.random() > chance) return;
    const b = basis(p.yaw + (Math.random() - 0.5) * 0.5, 0, this.b), h = this.caster.cast(p.x, p.eyeY(), p.z, b.fx, 0, b.fz, 50);
    if (!h || h.t < 9) return;
    const d = h.t - 1.3, x = p.x + b.fx * d, z = p.z + b.fz * d;
    if (!this.world.walkable(p.f, Math.floor(x), Math.floor(z))) return;
    this.phantomT = now;
    const n = creature(this.scareCaps, x, this.world.groundY(p.f, x, z), z, Math.atan2(x - p.x, z - p.z), { time: now });
    for (let i = 0; i < 520; i++) {
      sampleSurface(this.scareCaps, n, Math.random, this.tmp, 0);
      this.app.cloud.add(this.tmp[0], this.tmp[1], this.tmp[2], T_MONSTER, now + 0.3 + Math.random() * 0.15);
    }
  }

  die(m) {
    const app = this.app;
    this.state = 'dead';
    this.deadT = 0;
    app.cloud.purge(T_MONSTER);
    this.charging = false;
    app.sound.play('scare', 1.1);
    app.sound.play('scare2', 0.7, 0.85, 0, 0.3);
    app.net.sendEvent('death', { m: m.id, n: this.name });
    if (app.net.isHost) this.pack.fed(m.id);
    app.ui.toast('');
  }

  players() {
    const p = this.player, net = this.app.net, out = [{ id: net.id, f: p.f, x: p.x, z: p.z, alive: this.state === 'play', gait: this.gait(), scan: this.mouse.l && this.state === 'play' ? 1 : 0, mic: Math.round(this.app.sound.micLevel * 9) }];
    const t = net.now();
    for (const R of this.remote.values()) if (R.alive && t - R.t < 8000) out.push(R);
    return out;
  }

  frame(dt) {
    const app = this.app, net = app.net, snd = app.sound, ui = app.ui, cam = app.camera, cloud = app.cloud;
    const p = this.player, w = this.world, now = this.now(), playing = this.state === 'play';
    let steps = [];
    if (playing) {
      const k = this.keys;
      steps = p.update(dt, {
        forward: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0),
        strafe: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
        sprint: k.has('ShiftLeft') || k.has('ShiftRight'),
        crouch: k.has('KeyC'),
      });
    }
    const ex = p.x, ey = p.eyeY(), ez = p.z;
    this.kick = Math.max(0, this.kick - dt * 5);
    const shake = this.state === 'dead' && this.deadT < 1.15 ? 0.012 : this.fear > 0.8 ? (this.fear - 0.8) * 0.02 : 0;
    cam.position.set(ex + (Math.random() - 0.5) * shake, ey + (Math.random() - 0.5) * shake, ez + (Math.random() - 0.5) * shake);
    cam.rotation.set(p.pitch + this.kick * 0.035, p.yaw, (Math.random() - 0.5) * shake * 2, 'YXZ');
    const b = basis(p.yaw, p.pitch, this.b);
    this.muzzle.set(ex + b.rx * 0.2 - b.ux * 0.17 + b.fx * 0.3, ey - b.uy * 0.17 + b.fy * 0.3, ez + b.rz * 0.2 - b.uz * 0.17 + b.fz * 0.3);
    snd.listener(ex, ey, ez, b.fx, b.fy, b.fz);

    const surface = p.f >= 2 && !p.onStairs() ? 'step_b' : 'step_a', count = surface === 'step_b' ? 6 : 4;
    for (const s of steps) snd.play(`${surface}${1 + Math.floor(Math.random() * count)}`, [0.1, 0.26, 0.5][s], 0.92 + Math.random() * 0.16, (Math.random() - 0.5) * 0.3, 0.25);

    this.refreshBodies(dt, now);

    this.cool -= dt;
    const scanning = playing && this.mouse.l && !this.charging;
    if (scanning) this.scanner.stream(dt, ex, ey, ez, p.yaw, p.pitch, now, null);
    this.streamT += dt;
    if (this.streamT > 0.22) {
      this.streamT = 0;
      const B = this.scanner.takeBatch();
      if (B && net.online) {
        const d = [B.n, Math.round(B.s * 1000), Math.floor(Math.random() * 2147483647)];
        for (const q of [B.p0, B.p1, B.p2]) d.push(Math.round(q[0] * 100), Math.round(q[1] * 100), Math.round(q[2] * 100), Math.round(q[3] * 1000), Math.round(q[4] * 1000));
        net.sendScan(0, p.f, d);
      }
    }
    if (playing && this.mouse.r && this.cool <= 0) {
      if (!this.charging) { this.charging = true; this.charge = 0; this.chargeSnd = snd.play('charge', 0.55, 1.45); }
      this.charge = Math.min(1, this.charge + dt / 1.5);
    } else if (this.charging) {
      this.charging = false;
      if (playing) this.fireBurst(now);
    }
    this.scanner.update(now);

    if (net.isHost) {
      const list = this.players();
      this.noiseT += dt;
      if (this.noiseT > 0.35) {
        this.noiseT = 0;
        for (const q of list) {
          const R = Math.max(GAIT_NOISE[q.gait] || 0, q.scan ? 9 : 0, q.mic >= 2 ? q.mic * 4.5 : 0);
          if (R > 0 && q.alive) this.pack.noise(q.f, q.x, q.z, R, q.id, now);
        }
      }
      this.pack.update(dt, list, now);
      this.monT += dt;
      if (this.monT > 0.16) { this.monT = 0; net.sendMonsters(this.pack.snapshot()); }
    } else this.pack.follow(dt);
    this.pack.animate(dt, p.x, p.z, p.f);

    let near = 99, hunted = false, slot = 0;
    const U = cloud.uniforms.uMon.value;
    for (const m of this.pack.list) {
      if (m.f !== p.f) continue;
      const d = Math.hypot(m.x - p.x, m.z - p.z), gy = w.groundY(m.f, m.x, m.z);
      if (m.state !== STATUE) { near = Math.min(near, d); if (m.state === HUNT) hunted = true; }
      if (slot < 3 && m.state !== STATUE) U[slot++].set(m.x, gy + 1.3, m.z, 1);
      const st = Math.floor(m.phase / Math.PI);
      if (st !== m.stepped) {
        m.stepped = st;
        if (d < 45) snd.at(`m_step${1 + Math.floor(Math.random() * 6)}`, m.x, gy, m.z, 0.6 + 0.6 * m.run, 0.7 + Math.random() * 0.12, this.walls(m.x, m.z, m.f), 2.4);
      }
      m.voice -= dt;
      if (m.voice <= 0) {
        m.voice = 5 + Math.random() * 10;
        if (d < 42 && m.state !== STATUE && m.state !== FEED) snd.at(pick(['m_click1', 'm_click2', 'm_click3', 'm_click4', 'm_throat1', 'bone5', 'bone6']), m.x, gy + 2, m.z, 0.75, 0.85 + Math.random() * 0.2, this.walls(m.x, m.z, m.f), 3);
      }
      if (playing && !this.god && d < 0.95 && m.state !== FEED && m.state !== STATUE && !p.onStairs()) { this.scareM = m; this.die(m); }
    }
    for (; slot < 3; slot++) U[slot].w = 0;

    if (playing && p.f === 4 && !this.won && Math.hypot(p.x - w.goal.x, p.z - w.goal.z) < w.goal.r) net.claimWin();
    if (this.won) {
      const s = (performance.now() - this.won.at) / 1000;
      ui.winCount(Math.max(0, Math.ceil(9 - s)));
      if (!this.won.asked && (s > 14 || (s > 9 && net.isHost))) { this.won.asked = true; net.nextRound(); }
    }

    if (this.state === 'dead') this.deadFrame(dt, now, b);

    const fearT = this.state === 'play' ? clamp(1 - near / 16, 0, 1) * (hunted ? 1 : 0.8) + (hunted && near < 30 ? 0.2 : 0) : 0;
    this.fear += (clamp(fearT, 0, 1) - this.fear) * Math.min(1, dt * (fearT > this.fear ? 2.5 : 0.6));
    const fe = this.fear, quiet = this.state === 'dead' && this.deadT > 1.1 ? 0 : 1;
    snd.setLoop('heart', Math.pow(fe, 1.3) * 0.95 * quiet, 0.85 + 0.75 * fe);
    snd.setLoop('breath', Math.max(fe * 0.3, (1 - p.stamina) * 0.55) * quiet, 1 + 0.3 * (1 - p.stamina));
    snd.setLoop('static', (clamp((fe - 0.45) / 0.55, 0, 1) * 0.3 + (this.state === 'dead' ? 0.35 : 0)), 1);
    snd.setLoop('geiger', scanning ? 0.28 : 0, 1.5, 0.03);
    for (const n in AMB) snd.setLoop(n, AMB[n][p.f] * quiet, 1, 1.2);
    cloud.uniforms.uGlitch.value = (fe > 0.7 ? (fe - 0.7) * 0.6 : 0) + (this.state === 'dead' ? (this.deadT < 1.15 ? 0.05 : 1.3) : 0) + (this.state === 'won' ? 0.25 : 0);

    if (playing) {
      this.stingT -= dt;
      if (this.stingT <= 0) {
        this.stingT = 35 + Math.random() * 75;
        const a = Math.random() * 6.283, d = 12 + Math.random() * 16;
        snd.at(pick(p.f >= 2 ? ['bang1', 'pipe', 'whisper', 'drip', 'door', 'm_groan'] : ['door', 'bang1', 'bang2', 'pipe']), p.x + Math.cos(a) * d, p.y + 1.5, p.z + Math.sin(a) * d, 0.8, 0.9 + Math.random() * 0.2, 2, 5);
      }
    }

    this.poseT += dt;
    this.poseIdle += dt;
    if (this.poseT > 0.15 && net.online) {
      const mic = Math.round(snd.micLevel * 9);
      const d = [Math.round(p.x * 100), Math.round(p.y * 100), Math.round(p.z * 100), Math.round(p.yaw * 1000), Math.round(p.pitch * 1000)];
      const s = [p.f, this.gait(), scanning ? 1 : 0, mic, this.state === 'play' ? 1 : 0, p.crouch > 0.5 ? 1 : 0], key = d.join() + s.join();
      if (key !== this.lastPose || this.poseIdle > 1.2) { this.lastPose = key; this.poseT = 0; this.poseIdle = 0; net.sendPose(d, s); }
    }

    cloud.uniforms.uTime.value = now;
    app.beams.update(now, this.muzzle);

    if (p.f !== this.floorShown) { this.floorShown = p.f; ui.level(p.f, THEMES[p.f].label); }
    ui.depth(-(p.y - FLOOR_Y[0]));
    ui.charge(this.charging ? this.charge : 0);
    ui.mic(snd.micOn, snd.micLevel);
  }

  refreshBodies(dt, now) {
    const p = this.player, w = this.world, snd = this.app.sound, t = this.app.net.now();
    this.bodies.clear();
    for (const R of this.remote.values()) {
      if (t - R.t > 8000 || !R.alive) continue;
      const k = Math.min(1, dt * 10), lx = R.x, lz = R.z;
      R.x += (R.tx - R.x) * k; R.y += (R.ty - R.y) * k; R.z += (R.tz - R.z) * k;
      R.yaw += Math.atan2(Math.sin(R.tyaw - R.yaw), Math.cos(R.tyaw - R.yaw)) * k;
      const moved = Math.hypot(R.x - lx, R.z - lz), sp = dt > 0 ? moved / dt : 0;
      R.move += (Math.min(1, sp / WALK) - R.move) * Math.min(1, dt * 8);
      R.phase += (moved / 0.8) * Math.PI;
      const st = Math.floor(R.phase / Math.PI);
      if (st !== R.step) {
        R.step = st;
        if (R.f === p.f && R.gait > 0 && Math.hypot(R.x - p.x, R.z - p.z) < 26) {
          snd.at(`${R.f >= 2 ? 'step_b' : 'step_a'}${1 + Math.floor(Math.random() * 4)}`, R.x, R.y, R.z, [0, 0.2, 0.5, 0.9][R.gait], 0.95 + Math.random() * 0.1, this.walls(R.x, R.z, R.f), 2);
        }
      }
      const n = human(R.caps, R.x, R.y, R.z, R.yaw, { phase: R.phase, move: R.move, crouch: R.crouch ? 1 : 0 });
      this.bodies.add(1, R.id, R.caps, n);
    }
    for (const m of this.pack.list) {
      if (Math.abs(m.f - p.f) > 1) continue;
      const i = m.id, n = creature(this.monCaps[i], m.x, w.groundY(m.f, m.x, m.z), m.z, m.yaw, { phase: m.phase, move: m.move || 0, run: m.run, reach: m.reach, time: now + i * 7 }, this.monMeta[i]);
      this.bodies.add(2, i, this.monCaps[i], n, this.monMeta[i]);
    }
  }

  deadFrame(dt, now, b) {
    const app = this.app, p = this.player, cloud = app.cloud, T = (this.deadT += dt);
    if (T < 1.15) {
      const d = 0.42 + 2.6 * Math.pow(Math.max(0, 1 - T / 0.2), 2), open = Math.min(1, T / 0.45);
      const jx = (Math.random() - 0.5) * 0.014, jy = (Math.random() - 0.5) * 0.014 - 0.01;
      const cx = p.x + b.fx * d + b.rx * jx + b.ux * jy, cy = p.eyeY() + b.fy * d + b.uy * jy, cz = p.z + b.fz * d + b.rz * jx + b.uz * jy;
      for (let i = 0; i < 4200; i++) {
        const th = Math.acos(1 - Math.random() * 1.17), ph = Math.random() * 6.283, st = Math.sin(th);
        const x = 0.125 * st * Math.cos(ph), y = 0.2 * st * Math.sin(ph) + 0.01, z = 0.13 * Math.cos(th);
        const ex = Math.abs(x) - 0.058, ey = y - 0.062 - Math.abs(x) * 0.25;
        if ((ex * ex) / 0.0013 + (ey * ey) / 0.0009 < 1) continue;
        if ((x * x) / 0.002 + ((y + 0.105 + open * 0.02) ** 2) / ((0.035 + open * 0.06) ** 2) < 1) continue;
        if (Math.hypot(Math.abs(x) - 0.014, y + 0.02) < 0.009) continue;
        cloud.add(cx + b.rx * x + b.ux * y - b.fx * z, cy + b.uy * y - b.fy * z, cz + b.rz * x + b.uz * y - b.fz * z, T_FACE, now);
      }
      const n = creature(this.scareCaps, cx + b.fx * 0.7, cy - 2.2, cz + b.fz * 0.7, Math.atan2(b.fx, b.fz), { run: 0.25, reach: 0.15, time: now * 9 });
      for (let i = 0; i < 500; i++) {
        if (sampleSurface(this.scareCaps, n, Math.random, this.tmp, 0) === 7) continue;
        cloud.add(this.tmp[0], this.tmp[1], this.tmp[2], T_LIVE_RED, now);
      }
    } else if (T < 4.4) app.ui.dead(true);
    else {
      p.place(this.world.spawn);
      this.state = 'play';
      this.fear = 0;
      app.ui.dead(false);
      app.ui.level(0, THEMES[0].label);
    }
  }
}
