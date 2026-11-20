// LiDAR Point Cloud 001: the title screen. A random floor seen from above, revealed live by simulated operators while something hunts them.

import { World, T_MONSTER } from './world.js';
import { buildGeometry, Caster } from './geometry.js';
import { Bodies, human, creature, sampleSurface, CAP, HUMAN_CAPS, CREATURE_CAPS } from './figure.js';
import { Scanner } from './scanner.js';
import { T_LIVE_BLUE, T_LIVE_RED } from './cloud.js';
import { mulberry32 } from './rng.js';

const FOV = 38;
const turn = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class Title {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.tmp = new Float32Array(3);
  }

  start() {
    const app = this.app, seed = Math.floor(Math.random() * 2147483647);
    this.rnd = mulberry32(seed ^ 0x9e37);
    this.world = new World(seed);
    this.built = buildGeometry(this.world, [0]);
    this.bodies = new Bodies();
    this.scanner = new Scanner(new Caster(this.built), app.cloud, app.beams, this.bodies);
    this.scanner.skipCeiling = true;
    this.scanner.spread = 0.2;
    this.bots = [];
    for (let i = 0; i < 8; i++) this.bots.push(this.spawnBot(i === 0 ? this.world.spawn : null));
    const m = this.world.monsterSpawns[0];
    this.mon = { x: m.x, z: m.z, yaw: 0, path: null, pi: 0, phase: 0, target: null, repath: 0, rest: 3, caps: new Float32Array(CAP * CREATURE_CAPS), meta: new Float32Array(5) };
    this.t = 0;
    this.angle = this.rnd() * 6.283;
    this.active = true;
    app.cloud.clear();
    app.beams.clear();
    const u = app.cloud.uniforms;
    u.uFade.value = 0;
    u.uEnvLife.value = 150;
    u.uEnvFloor.value = 0.55;
    u.uGlitch.value = 0;
    for (const v of u.uMon.value) v.w = 0;
    app.camera.fov = FOV;
    app.camera.near = 1;
    app.camera.far = 400;
    app.camera.updateProjectionMatrix();
    this.resize();
    for (let i = 0; i < 110; i++) this.step(1 / 20, true);
  }

  resize() {
    const app = this.app;
    app.cloud.resize(app.height, FOV, app.dpr, 0.12, 1.25 * app.dpr + 0.35);
  }

  stop() {
    this.active = false;
    this.built.geometry.dispose();
    this.built.extra.dispose();
    this.app.cloud.clear();
    this.app.beams.clear();
  }

  spawnBot(at) {
    const p = at || this.world.randomOpen(0, this.rnd);
    return { x: p.x, z: p.z, yaw: this.rnd() * 6.283, path: null, pi: 0, phase: 0, sweep: this.rnd() * 6.283, burst: 1 + this.rnd() * 5, dead: 0, caps: new Float32Array(CAP * HUMAN_CAPS) };
  }

  walk(a, dt, speed) {
    if (!a.path || a.pi >= a.path.length) return true;
    const [wx, wz] = a.path[a.pi], dx = wx - a.x, dz = wz - a.z, d = Math.hypot(dx, dz), s = speed * dt;
    if (d <= s) { a.x = wx; a.z = wz; a.pi++; }
    else {
      a.x += (dx / d) * s; a.z += (dz / d) * s;
      a.yaw += turn(Math.atan2(-dx, -dz), a.yaw) * Math.min(1, dt * 7);
      a.phase += (s / 0.8) * Math.PI;
    }
    return a.pi >= a.path.length;
  }

  step(dt, warm) {
    const w = this.world, r = this.rnd, sc = this.scanner, cloud = this.app.cloud;
    this.t += dt;
    const now = this.t;
    this.bodies.clear();
    for (const b of this.bots) {
      if (b.dead > 0) continue;
      const n = human(b.caps, b.x, 0, b.z, b.yaw, { phase: b.phase, move: 1 });
      this.bodies.add(1, b, b.caps, n);
    }
    const M = this.mon;
    const mn = creature(M.caps, M.x, 0, M.z, M.yaw, { phase: M.phase, move: M.rest > 0 ? 0 : 1, run: M.rest > 0 ? 0 : 0.6, time: now }, M.meta);
    this.bodies.add(2, M, M.caps, mn, M.meta);
    for (const b of this.bots) {
      if (b.dead > 0) {
        b.dead -= dt;
        if (b.dead <= 0) Object.assign(b, this.spawnBot(), { caps: b.caps });
        continue;
      }
      if (this.walk(b, dt, 2.3)) {
        const t = w.randomOpen(0, r, b, 16);
        b.path = w.findPath(0, b.x, b.z, t.x, t.z);
        b.pi = 1;
      }
      const yaw = b.yaw + Math.sin(now * 1.3 + b.sweep) * 1.1, pitch = -0.1 + Math.sin(now * 2.1 + b.sweep) * 0.2;
      sc.stream(dt, b.x, 1.5, b.z, yaw, pitch, now, b, 150, false);
      b.burst -= dt;
      if (b.burst <= 0) {
        b.burst = 2.2 + r() * 3;
        sc.burst(b.x, 1.5, b.z, b.yaw + (r() - 0.5) * 2.2, -0.1, 0.15 + r() * 0.35, Math.floor(r() * 1e9), now, b, false, null);
      }
      if (!warm) for (let i = 0; i < 30; i++) { sampleSurface(b.caps, HUMAN_CAPS, Math.random, this.tmp, 0); cloud.add(this.tmp[0], this.tmp[1], this.tmp[2], T_LIVE_BLUE, now); }
    }
    if (M.rest > 0) M.rest -= dt;
    else {
      M.repath -= dt;
      if (!M.target || M.target.dead > 0 || M.repath <= 0) {
        let best = null, bd = 1e9;
        for (const b of this.bots) { const d = Math.hypot(b.x - M.x, b.z - M.z); if (b.dead <= 0 && d < bd) { bd = d; best = b; } }
        M.target = best;
        M.repath = 0.7;
        if (best) { M.path = w.findPath(0, M.x, M.z, best.x, best.z); M.pi = 1; }
      }
      this.walk(M, dt, 3.0);
      const T = M.target;
      if (T && Math.hypot(T.x - M.x, T.z - M.z) < 1) {
        T.dead = 3 + r() * 3;
        M.rest = 4;
        M.target = null;
        for (let i = 0; i < 700; i++) {
          const a = Math.random() * 6.283, d = Math.sqrt(Math.random()) * 2.6;
          cloud.add(T.x + Math.cos(a) * d, 0.03 + Math.random() * 0.2, T.z + Math.sin(a) * d, T_MONSTER, now + Math.random() * 0.5);
        }
      }
    }
    if (!warm) for (let i = 0; i < 40; i++) { sampleSurface(M.caps, CREATURE_CAPS, Math.random, this.tmp, 0); cloud.add(this.tmp[0], this.tmp[1], this.tmp[2], T_LIVE_RED, now); }
    sc.update(now);
  }

  frame(dt) {
    const app = this.app, cam = app.camera;
    this.step(Math.min(dt, 0.05), false);
    this.angle += dt * 0.022;
    const cx = 36, cz = 36, wide = Math.min(1, app.width / app.height / 1.6), dist = 47 / Math.max(0.55, wide);
    cam.position.set(cx + Math.sin(this.angle) * dist, 70 / Math.max(0.55, wide), cz + Math.cos(this.angle) * dist);
    cam.up.set(0, 1, 0);
    cam.lookAt(cx, 0, cz);
    app.cloud.uniforms.uTime.value = this.t;
    app.beams.update(this.t, cam.position);
  }
}
