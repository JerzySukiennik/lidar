// LiDAR Point Cloud 001: the lidar itself (continuous stream, charged burst, replay of other players' scans).

import { mulberry32 } from './rng.js';
import { T_ENV, T_PLAYER, T_MONSTER, FLOOR_Y } from './world.js';

export const STREAM_RATE = 700, STREAM_FAR = 70, BURST_FAR = 60;
const GOLD = 2.399963;

export function basis(yaw, pitch, o) {
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  o.fx = -sy * cp; o.fy = sp; o.fz = -cy * cp;
  o.rx = cy; o.ry = 0; o.rz = -sy;
  o.ux = sy * sp; o.uy = cp; o.uz = cy * sp;
  return o;
}

export const burstCount = (power) => Math.round(2500 + 13500 * power);
export const burstAngle = (power) => 20 + 22 * power;

export class Scanner {
  constructor(caster, cloud, beams, bodies) {
    this.caster = caster;
    this.cloud = cloud;
    this.beams = beams;
    this.bodies = bodies;
    this.acc = 0;
    this.spread = 0.04;
    this.jobs = [];
    this.b = {};
    this.batch = null;
    this.onHit = null;
    this.skipCeiling = false;
    this.fixed = null;
    this.rays = 0;
  }

  fixedAt(y) {
    if (!this.fixed) return null;
    for (let f = 0; f < FLOOR_Y.length; f++) if (y > FLOOR_Y[f] - 0.6) return this.fixed[f];
    return null;
  }

  ray(ox, oy, oz, dx, dy, dz, far, birth, skip, beam, own, now) {
    this.rays++;
    const h = this.caster.cast(ox, oy, oz, dx, dy, dz, far);
    const e = this.bodies.ray(ox, oy, oz, dx, dy, dz, h ? h.t : far, skip, this.fixedAt(oy));
    if (e) {
      const kind = e.kind, t = e.t, id = e.id;
      if (kind < 0) return 0;
      if (kind === 0) {
        this.cloud.add(ox + dx * t, oy + dy * t, oz + dz * t, T_ENV, birth, 0.55 + Math.random() * 0.4);
        if (beam) this.beams.add(ox, oy, oz, ox + dx * t, oy + dy * t, oz + dz * t, 0, now, own);
        return 1;
      }
      const type = kind === 2 ? T_MONSTER : T_PLAYER, x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      this.cloud.add(x, y, z, type, birth);
      for (let j = 0; j < 5; j++) {
        let ex = dx + (Math.random() - 0.5) * 0.06, ey = dy + (Math.random() - 0.5) * 0.06, ez = dz + (Math.random() - 0.5) * 0.06;
        const l = 1 / Math.hypot(ex, ey, ez);
        ex *= l; ey *= l; ez *= l;
        const g = this.bodies.ray(ox, oy, oz, ex, ey, ez, t + 1.2, skip);
        if (g && g.kind === kind) this.cloud.add(ox + ex * g.t, oy + ey * g.t, oz + ez * g.t, type, birth);
      }
      if (beam) this.beams.add(ox, oy, oz, x, y, z, kind, now, own);
      if (this.onHit) this.onHit(kind, id, own);
      return kind + 1;
    }
    if (!h || (this.skipCeiling && h.ny < -0.6)) return 0;
    const cosI = -(h.nx * dx + h.ny * dy + h.nz * dz), face = h.ny > 0.7 ? 0.6 : h.ny < -0.7 ? 0.42 : 1;
    this.cloud.add(h.x + h.nx * 0.012, h.y + h.ny * 0.012, h.z + h.nz * 0.012, h.type, birth, (0.4 + 0.6 * Math.pow(Math.max(0, cosI), 0.7)) * face);
    if (beam) this.beams.add(ox, oy, oz, h.x, h.y, h.z, 0, now, own);
    return 1;
  }

  shoot(b, ox, oy, oz, u, v, far, birth, skip, beam, own, now) {
    const dx = b.fx + b.rx * u + b.ux * v, dy = b.fy + b.ry * u + b.uy * v, dz = b.fz + b.rz * u + b.uz * v, l = 1 / Math.hypot(dx, dy, dz);
    return this.ray(ox, oy, oz, dx * l, dy * l, dz * l, far, birth, skip, beam, own, now);
  }

  stream(dt, ox, oy, oz, yaw, pitch, now, skip, rate = STREAM_RATE, own = true) {
    this.acc += dt * rate;
    const n = Math.floor(this.acc);
    this.acc -= n;
    if (!n) return 0;
    const b = basis(yaw, pitch, this.b), s = this.spread;
    for (let i = 0; i < n; i++) {
      const rr = Math.sqrt(Math.random()) * s, a = Math.random() * 6.283;
      this.shoot(b, ox, oy, oz, Math.cos(a) * rr, Math.sin(a) * rr, STREAM_FAR, now, skip, own && i < 3, own, now);
    }
    if (!own) return n;
    const B = this.batch || (this.batch = { n: 0, t: now, p0: [ox, oy, oz, yaw, pitch], p1: null, p2: null });
    B.n += n;
    B.p2 = [ox, oy, oz, yaw, pitch];
    if (!B.p1 && now - B.t > 0.09) B.p1 = B.p2;
    return n;
  }

  takeBatch() {
    const B = this.batch;
    this.batch = null;
    if (!B) return null;
    return { n: B.n, s: this.spread, p0: B.p0, p1: B.p1 || B.p2, p2: B.p2 };
  }

  replayStream(ev, now, skip) {
    const rnd = mulberry32(ev.seed | 0), n = Math.min(400, ev.n), b = this.b;
    for (let i = 0; i < n; i++) {
      const s = n > 1 ? i / (n - 1) : 0, A = s < 0.5 ? ev.p0 : ev.p1, B = s < 0.5 ? ev.p1 : ev.p2, k = s < 0.5 ? s * 2 : (s - 0.5) * 2;
      let dy = B[3] - A[3];
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      basis(A[3] + dy * k, A[4] + (B[4] - A[4]) * k, b);
      const rr = Math.sqrt(rnd()) * ev.s, a = rnd() * 6.283;
      this.shoot(b, A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k, Math.cos(a) * rr, Math.sin(a) * rr, STREAM_FAR, now, skip, i % 5 === 0, false, now);
    }
  }

  burst(ox, oy, oz, yaw, pitch, power, seed, now, skip, own, birth) {
    this.jobs.push({
      ox, oy, oz, b: basis(yaw, pitch, {}), n: burstCount(power), tan: Math.tan((burstAngle(power) * Math.PI) / 180),
      rnd: mulberry32(seed | 0), i: 0, t0: now, dur: 0.2 + 0.22 * power, skip, own, birth,
    });
  }

  update(now) {
    let budget = 2800, old = 900;
    for (const J of this.jobs) {
      const live = J.birth == null, want = live ? Math.min(J.n, Math.ceil((J.n * (now - J.t0)) / J.dur)) : J.n;
      let m = Math.min(want - J.i, live ? budget : old);
      if (m <= 0) continue;
      if (live) budget -= m; else old -= m;
      const every = J.own ? 16 : 60;
      while (m-- > 0) {
        const i = J.i++, rad = J.tan * Math.sqrt((i + 0.5) / J.n) * (0.93 + J.rnd() * 0.14), a = i * GOLD + J.rnd() * 0.8;
        this.shoot(J.b, J.ox, J.oy, J.oz, Math.cos(a) * rad, Math.sin(a) * rad, BURST_FAR, live ? now : J.birth, J.skip, live && i % every === 0, J.own, now);
      }
    }
    if (this.jobs.length) this.jobs = this.jobs.filter((J) => J.i < J.n);
  }
}
