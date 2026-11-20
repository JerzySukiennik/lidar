// LiDAR Point Cloud 001: the creatures. Blind, they hunt by sound. The host simulates them, everyone else replays snapshots.

import { mulberry32 } from './rng.js';

export const ROAM = 0, STALK = 1, LISTEN = 2, HUNT = 3, SEARCH = 4, FEED = 5, STATUE = 6;
const HEAR = [0.85, 1.0, 1.15, 1.3, 1.5];
const CHASE = [3.7, 4.2, 4.7, 5.1, 5.6];
const turn = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export class Pack {
  constructor(world) {
    this.world = world;
    this.rnd = mulberry32(world.seed ^ 0x51ed);
    this.onState = null;
    this.list = world.monsterSpawns.map((s) => ({
      id: s.id, f: s.f, x: s.x, z: s.z, yaw: s.yaw, state: s.f === 4 ? STATUE : ROAM, speed: 0,
      tx: s.x, tz: s.z, tyaw: s.yaw, alert: 0, path: null, pi: 0, heard: null, timer: 0, repath: 0, standoff: 7.5, huntT: 0, goal: null,
      phase: 0, run: 0, reach: 0, stepped: 0, voice: 3 + Math.random() * 6,
    }));
  }

  set(m, state) {
    if (m.state === state) return;
    const prev = m.state;
    m.state = state;
    m.path = null;
    m.goal = null;
    if (state === HUNT) m.huntT = 0;
    if (this.onState) this.onState(m, prev, state);
  }

  noise(f, x, z, R, pid, now) {
    for (const m of this.list) {
      if (m.f !== f || m.state === FEED) continue;
      const reach = R * HEAR[f], d = Math.hypot(x - m.x, z - m.z);
      if (m.state === STATUE) {
        if (d < Math.min(reach * 0.5, 11)) { m.alert = 1.1; m.heard = { x, z, t: now, pid }; this.set(m, HUNT); }
        continue;
      }
      if (d > reach) continue;
      const k = Math.pow(1 - d / reach, 0.7), err = d * 0.14;
      m.alert = Math.min(1.25, m.alert + k * (0.1 + R / 70));
      m.heard = { x: x + (this.rnd() - 0.5) * 2 * err, z: z + (this.rnd() - 0.5) * 2 * err, t: now, pid };
    }
  }

  scanned(id, x, z, pid, now) {
    const m = this.list[id];
    if (!m || m.state === FEED) return;
    this.noise(m.f, x, z, Math.hypot(x - m.x, z - m.z) + 7, pid, now);
    if (m.state === LISTEN) m.timer = Math.min(m.timer, 0.4 + this.rnd() * 0.9);
  }

  fed(id) {
    const m = this.list[id];
    if (!m) return;
    m.alert = 0;
    m.timer = 4.5;
    this.set(m, FEED);
  }

  go(m, x, z) {
    m.path = this.world.findPath(m.f, m.x, m.z, x, z);
    m.pi = 1;
    m.goal = [x, z];
  }

  walk(m, dt, speed, exact) {
    m.speed = 0;
    if (!m.path || m.pi >= m.path.length) return true;
    let [wx, wz] = m.path[m.pi];
    if (exact && m.pi === m.path.length - 1 && this.world.lineClear(m.f, m.x, m.z, exact.x, exact.z)) { wx = exact.x; wz = exact.z; }
    const dx = wx - m.x, dz = wz - m.z, d = Math.hypot(dx, dz), s = speed * dt;
    if (d <= s) { m.x = wx; m.z = wz; m.pi++; }
    else {
      m.x += (dx / d) * s; m.z += (dz / d) * s;
      m.yaw += turn(Math.atan2(-dx, -dz), m.yaw) * Math.min(1, dt * 8);
    }
    m.speed = speed;
    return m.pi >= m.path.length;
  }

  face(m, x, z, dt) { m.yaw += turn(Math.atan2(m.x - x, m.z - z), m.yaw) * Math.min(1, dt * 3); }

  update(dt, players, now) {
    const r = this.rnd, w = this.world;
    for (const m of this.list) {
      const here = players.filter((p) => p.f === m.f && p.alive);
      if (!here.length) { m.alert = Math.max(0, m.alert - dt * 0.1); m.speed = 0; if (m.state !== STATUE && m.state !== ROAM) this.set(m, ROAM); continue; }
      m.alert = Math.max(0, m.alert - dt * (m.state === HUNT ? 0.035 : 0.06));
      m.repath -= dt;
      const H = m.heard;
      switch (m.state) {
        case STATUE:
          m.speed = 0;
          for (const p of here) if (Math.hypot(p.x - m.x, p.z - m.z) < 4.2) { m.alert = 1.1; m.heard = { x: p.x, z: p.z, t: now, pid: p.id }; this.set(m, HUNT); }
          break;
        case ROAM:
          if (m.alert > 0.28 && H) { m.standoff = 7.5; this.set(m, STALK); break; }
          if (!m.path || this.walk(m, dt, 1.15)) {
            const t = w.randomOpen(m.f, r, m, 10);
            this.go(m, t.x, t.z);
          }
          break;
        case STALK: {
          if (m.alert >= 0.8) { this.set(m, HUNT); break; }
          if (m.alert < 0.08 || !H) { this.set(m, ROAM); break; }
          const d = Math.hypot(H.x - m.x, H.z - m.z);
          if (d < m.standoff) { m.timer = 4 + r() * 6; this.set(m, LISTEN); break; }
          if (!m.goal || m.repath <= 0 && Math.hypot(m.goal[0] - H.x, m.goal[1] - H.z) > 2) { this.go(m, H.x, H.z); m.repath = 0.8; }
          this.walk(m, dt, 2.1);
          break;
        }
        case LISTEN:
          m.speed = 0;
          m.timer -= dt;
          if (H) this.face(m, H.x, H.z, dt);
          if (m.alert >= 0.8) { this.set(m, HUNT); break; }
          if (m.timer <= 0) {
            if (m.alert < 0.2) this.set(m, ROAM);
            else { m.standoff = Math.max(2.2, m.standoff - 2.5); this.set(m, STALK); }
          }
          break;
        case HUNT: {
          m.huntT += dt;
          if (!H) { this.set(m, ROAM); break; }
          const d = Math.hypot(H.x - m.x, H.z - m.z);
          if ((d < 1.1 && now - H.t > 1.2) || (m.alert < 0.3 && m.huntT > 5)) { m.alert = 0.45; m.timer = 9; this.set(m, SEARCH); break; }
          if (!m.goal || m.repath <= 0 && Math.hypot(m.goal[0] - H.x, m.goal[1] - H.z) > 0.8) { this.go(m, H.x, H.z); m.repath = 0.4; }
          this.walk(m, dt, CHASE[m.f], H);
          break;
        }
        case SEARCH:
          m.timer -= dt;
          if (m.alert >= 0.8) { this.set(m, HUNT); break; }
          if (m.timer <= 0) { m.alert = 0.15; this.set(m, ROAM); break; }
          if (!m.path || this.walk(m, dt, 2.3)) {
            const a = r() * 6.283, d = 1.5 + r() * 4.5, c = H || m;
            this.go(m, c.x + Math.cos(a) * d, c.z + Math.sin(a) * d);
          }
          break;
        case FEED:
          m.speed = 0;
          m.timer -= dt;
          if (m.timer <= 0) {
            const far = !here.some((p) => Math.hypot(p.x - m.x, p.z - m.z) < 12);
            if (far) { const t = w.randomOpen(m.f, r, here[0], 28); m.x = t.x; m.z = t.z; }
            this.set(m, ROAM);
          }
          break;
      }
    }
  }

  snapshot() {
    return this.list.map((m) => [m.f, Math.round(m.x * 100), Math.round(m.z * 100), Math.round(m.yaw * 100), m.state, Math.round(m.speed * 10)]);
  }

  apply(arr) {
    if (!arr) return;
    for (let i = 0; i < this.list.length && i < arr.length; i++) {
      const m = this.list[i], a = arr[i];
      if (!a) continue;
      m.f = a[0]; m.tx = a[1] / 100; m.tz = a[2] / 100; m.tyaw = a[3] / 100; m.speed = a[5] / 10;
      if (Math.hypot(m.tx - m.x, m.tz - m.z) > 8) { m.x = m.tx; m.z = m.tz; }
      if (a[4] !== m.state) { const prev = m.state; m.state = a[4]; if (this.onState) this.onState(m, prev, a[4]); }
    }
  }

  follow(dt) {
    for (const m of this.list) {
      const k = Math.min(1, dt * 9);
      m.x += (m.tx - m.x) * k;
      m.z += (m.tz - m.z) * k;
      m.yaw += turn(m.tyaw, m.yaw) * k;
    }
  }

  animate(dt, px, pz, pf) {
    for (const m of this.list) {
      if (m.lx === undefined) { m.lx = m.x; m.lz = m.z; }
      const moved = Math.hypot(m.x - m.lx, m.z - m.lz);
      m.lx = m.x; m.lz = m.z;
      const hunting = m.state === HUNT;
      m.phase += (moved / (hunting ? 1.35 : 0.85)) * Math.PI;
      m.run += ((hunting ? 1 : 0) - m.run) * Math.min(1, dt * 4);
      const near = m.f === pf && hunting && Math.hypot(px - m.x, pz - m.z) < 3.4;
      m.reach += ((near ? 1 : 0) - m.reach) * Math.min(1, dt * 5);
      m.move = Math.min(1, (dt > 0 ? moved / dt : 0) / 1.4);
    }
  }
}
