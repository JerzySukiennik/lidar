// LiDAR Point Cloud 001: capsule figures (players, statues, the creature), ray tests against them and surface sampling.

export const CAP = 7;
export const HUMAN_CAPS = 10;
export const CREATURE_CAPS = 18;
export const CREATURE_HEAD = 7;

function frame(x, y, z, yaw, s) {
  const sn = Math.sin(yaw), cs = Math.cos(yaw);
  return { x, y, z, s, rx: cs, rz: -sn, fx: -sn, fz: -cs };
}

function put(out, i, fr, a, b, rad) {
  const k = i * CAP, s = fr.s;
  out[k] = fr.x + (fr.rx * a[0] + fr.fx * a[2]) * s;
  out[k + 1] = fr.y + a[1] * s;
  out[k + 2] = fr.z + (fr.rz * a[0] + fr.fz * a[2]) * s;
  out[k + 3] = fr.x + (fr.rx * b[0] + fr.fx * b[2]) * s;
  out[k + 4] = fr.y + b[1] * s;
  out[k + 5] = fr.z + (fr.rz * b[0] + fr.fz * b[2]) * s;
  out[k + 6] = rad * s;
  return i + 1;
}

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export function human(out, x, y, z, yaw, o = {}) {
  const fr = frame(x, y, z, yaw, o.scale || 1), ph = o.phase || 0, mv = o.move || 0, cr = o.crouch || 0, pose = o.pose;
  const hip = 0.93 - 0.36 * cr, lean = 0.03 + 0.09 * mv + 0.22 * cr, sh = hip + 0.45;
  let n = 0;
  n = put(out, n, fr, [0, hip + 0.04, 0], [0, hip + 0.47, lean], 0.15);
  const head = [0, hip + 0.72 - (pose === 0 ? 0.035 : 0), lean + 0.03 + (pose === 0 ? 0.08 : 0)];
  n = put(out, n, fr, head, head, 0.108);
  for (const sd of [-1, 1]) {
    const p = ph + (sd > 0 ? Math.PI : 0);
    const a = Math.sin(p) * 0.62 * mv + 0.75 * cr;
    const a2 = a - (0.2 + 0.5 * Math.max(0, Math.cos(p))) * mv - 1.5 * cr;
    const knee = [sd * 0.095, hip - Math.cos(a) * 0.45, Math.sin(a) * 0.45];
    n = put(out, n, fr, [sd * 0.095, hip, 0], knee, 0.075);
    n = put(out, n, fr, knee, [sd * 0.095, Math.max(0.05, knee[1] - Math.cos(a2) * 0.45), knee[2] + Math.sin(a2) * 0.45], 0.058);
  }
  for (const sd of [-1, 1]) {
    const S = [sd * 0.2, sh, lean];
    let E, H;
    if (pose === 1) { E = [sd * 0.17, sh - 0.2, lean + 0.2]; H = [sd * 0.06, sh + 0.22, lean + 0.17]; }
    else if (pose === 0) { E = [sd * 0.23, sh - 0.3, lean + 0.02]; H = [sd * 0.22, sh - 0.58, lean + 0.07]; }
    else if (sd > 0) { E = [0.22, sh - 0.25, lean + 0.12]; H = [0.19, sh - 0.2, lean + 0.43]; }
    else { const b = -Math.sin(ph) * 0.5 * mv; E = [-0.23, sh - Math.cos(b) * 0.3, lean + Math.sin(b) * 0.3]; H = [-0.22, E[1] - Math.cos(b + 0.25) * 0.28, E[2] + Math.sin(b + 0.25) * 0.28]; }
    n = put(out, n, fr, S, E, 0.05);
    n = put(out, n, fr, E, H, 0.043);
  }
  return n;
}

export function creature(out, x, y, z, yaw, o = {}, meta) {
  const fr = frame(x, y, z, yaw, o.scale || 1), ph = o.phase || 0, mv = o.move || 0, run = o.run || 0, reach = o.reach || 0, t = o.time || 0;
  const hunch = 0.1 + 0.32 * run, sway = Math.sin(t * 0.7) * 0.035 * (1 - mv), hip = 1.24 - 0.16 * run;
  let n = 0;
  for (const sd of [-1, 1]) {
    const p = ph + (sd > 0 ? Math.PI : 0);
    const a = 0.22 + Math.sin(p) * (0.5 + 0.25 * run) * mv;
    const a2 = a - 0.55 - (0.3 + 0.6 * Math.max(0, Math.cos(p))) * mv;
    const knee = [sd * 0.1, hip - Math.cos(a) * 0.62, Math.sin(a) * 0.62];
    n = put(out, n, fr, [sd * 0.1, hip, 0], knee, 0.052);
    n = put(out, n, fr, knee, [sd * 0.12, Math.max(0.03, knee[1] - Math.cos(a2) * 0.68), knee[2] + Math.sin(a2) * 0.68], 0.04);
  }
  const s0 = [sway, hip, 0], s1 = [sway * 1.5, hip + 0.38, 0.06 + hunch * 0.4], s2 = [sway * 2, hip + 0.72, 0.16 + hunch * 0.9];
  const neck = [sway * 2.2, hip + 0.98, 0.3 + hunch * 1.4];
  n = put(out, n, fr, s0, s1, 0.1);
  n = put(out, n, fr, s1, s2, 0.088);
  n = put(out, n, fr, s2, neck, 0.055);
  const hc = [neck[0] + Math.sin(t * 0.41) * 0.05, neck[1] + 0.1, neck[2] + 0.09];
  n = put(out, n, fr, add(hc, [0, 0.05, -0.04]), add(hc, [0, -0.07, 0.07]), 0.1);
  if (meta) {
    meta[0] = fr.x + (fr.rx * hc[0] + fr.fx * hc[2]) * fr.s;
    meta[1] = fr.y + hc[1] * fr.s;
    meta[2] = fr.z + (fr.rz * hc[0] + fr.fz * hc[2]) * fr.s;
    meta[3] = yaw;
    meta[4] = 0.1 * fr.s;
  }
  for (const sd of [-1, 1]) {
    const p = ph + (sd > 0 ? 0 : Math.PI), sw = -Math.sin(p) * 0.25 * mv;
    const S = add(s2, [sd * 0.19, 0.02, 0]);
    const E = mix(add(S, [sd * 0.06, -0.72, 0.05 + sw]), add(S, [sd * 0.1, -0.12, 0.7]), reach);
    const H = mix(add(E, [sd * 0.02, -0.8, 0.12 + sw * 1.4]), add(E, [-sd * 0.06, 0.12, 0.8]), reach);
    n = put(out, n, fr, S, E, 0.04);
    n = put(out, n, fr, E, H, 0.03);
    const d = [H[0] - E[0], H[1] - E[1], H[2] - E[2]], l = Math.hypot(d[0], d[1], d[2]) || 1;
    for (let j = -1; j <= 1; j++) {
      const tip = [H[0] + (d[0] / l) * 0.27 + j * 0.075, H[1] + (d[1] / l) * 0.27 - Math.abs(j) * 0.02, H[2] + (d[2] / l) * 0.27 + Math.abs(j) * 0.03];
      n = put(out, n, fr, H, tip, 0.013);
    }
  }
  return n;
}

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = ox - cx, ly = oy - cy, lz = oz - cz, b = lx * dx + ly * dy + lz * dz, c = lx * lx + ly * ly + lz * lz - r * r, h = b * b - c;
  if (h < 0) return -1;
  return -b - Math.sqrt(h);
}

export function rayCapsule(ox, oy, oz, dx, dy, dz, c, k) {
  const ax = c[k], ay = c[k + 1], az = c[k + 2], bx = c[k + 3], by = c[k + 4], bz = c[k + 5], r = c[k + 6];
  const ux = bx - ax, uy = by - ay, uz = bz - az, baba = ux * ux + uy * uy + uz * uz;
  let best = -1;
  if (baba > 1e-8) {
    const wx = ox - ax, wy = oy - ay, wz = oz - az;
    const bard = ux * dx + uy * dy + uz * dz, baoa = ux * wx + uy * wy + uz * wz, rdoa = dx * wx + dy * wy + dz * wz, oaoa = wx * wx + wy * wy + wz * wz;
    const A = baba - bard * bard, B = baba * rdoa - baoa * bard, Cc = baba * oaoa - baoa * baoa - r * r * baba, h = B * B - A * Cc;
    if (A > 1e-9 && h >= 0) {
      const t = (-B - Math.sqrt(h)) / A, yy = baoa + t * bard;
      if (yy > 0 && yy < baba && t > 0) best = t;
    }
    const tb = raySphere(ox, oy, oz, dx, dy, dz, bx, by, bz, r);
    if (tb > 0 && (best < 0 || tb < best)) best = tb;
  }
  const ta = raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r);
  if (ta > 0 && (best < 0 || ta < best)) best = ta;
  return best;
}

export function makeBody(kind, id, caps, n, meta) {
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += caps[i * CAP] + caps[i * CAP + 3]; cy += caps[i * CAP + 1] + caps[i * CAP + 4]; cz += caps[i * CAP + 2] + caps[i * CAP + 5]; }
  cx /= n * 2; cy /= n * 2; cz /= n * 2;
  let br = 0;
  for (let i = 0; i < n; i++) for (const o of [0, 3]) {
    br = Math.max(br, Math.hypot(caps[i * CAP + o] - cx, caps[i * CAP + o + 1] - cy, caps[i * CAP + o + 2] - cz) + caps[i * CAP + 6]);
  }
  return { kind, id, caps, n, meta, cx, cy, cz, br };
}

export class Bodies {
  constructor() {
    this.items = [];
    this.hit = { t: 0, kind: 0, id: null };
    this.best = null;
    this.bt = 0;
    this.bc = -1;
  }

  clear() { this.items.length = 0; }

  add(kind, id, caps, n, meta) { this.items.push(makeBody(kind, id, caps, n, meta)); }

  sweep(list, ox, oy, oz, dx, dy, dz, skip) {
    for (const it of list) {
      if (skip !== null && it.id === skip) continue;
      const lx = it.cx - ox, ly = it.cy - oy, lz = it.cz - oz, tca = lx * dx + ly * dy + lz * dz;
      if (tca < -it.br || tca - it.br > this.bt) continue;
      if (lx * lx + ly * ly + lz * lz - tca * tca > it.br * it.br) continue;
      for (let c = 0; c < it.n; c++) {
        const t = rayCapsule(ox, oy, oz, dx, dy, dz, it.caps, c * CAP);
        if (t > 0.05 && t < this.bt) { this.bt = t; this.best = it; this.bc = c; }
      }
    }
  }

  ray(ox, oy, oz, dx, dy, dz, maxT, skip, fixed) {
    this.best = null;
    this.bt = maxT;
    this.bc = -1;
    if (fixed) this.sweep(fixed, ox, oy, oz, dx, dy, dz, null);
    this.sweep(this.items, ox, oy, oz, dx, dy, dz, skip === undefined ? null : skip);
    const best = this.best, bt = this.bt;
    if (!best) return null;
    const h = this.hit;
    h.t = bt;
    h.kind = best.kind;
    h.id = best.id;
    if (best.meta && this.bc === CREATURE_HEAD) {
      const m = best.meta, sn = Math.sin(m[3]), cs = Math.cos(m[3]);
      const vx = ox + dx * bt - m[0], vy = oy + dy * bt - m[1], vz = oz + dz * bt - m[2];
      const r = (vx * cs - vz * sn) / m[4], u = vy / m[4], f = (-vx * sn - vz * cs) / m[4];
      if (f > 0.2) {
        const eye = Math.min(Math.hypot(r - 0.42, u - 0.3), Math.hypot(r + 0.42, u - 0.3)) < 0.27;
        const mouth = (r / 0.3) ** 2 + ((u + 0.62) / 0.42) ** 2 < 1;
        if (eye || mouth) h.kind = -1;
      }
    }
    return h;
  }
}

export function sampleSurface(caps, n, rnd, out, k) {
  let total = 0;
  for (let i = 0; i < n; i++) {
    const c = i * CAP;
    total += (Math.hypot(caps[c + 3] - caps[c], caps[c + 4] - caps[c + 1], caps[c + 5] - caps[c + 2]) + caps[c + 6] * 2) * caps[c + 6];
  }
  let pick = rnd() * total, c = 0;
  for (let i = 0; i < n; i++) {
    c = i * CAP;
    pick -= (Math.hypot(caps[c + 3] - caps[c], caps[c + 4] - caps[c + 1], caps[c + 5] - caps[c + 2]) + caps[c + 6] * 2) * caps[c + 6];
    if (pick <= 0) break;
  }
  const u = rnd(), th = rnd() * 6.283, ph = Math.acos(rnd() * 2 - 1), r = caps[c + 6];
  out[k] = caps[c] + (caps[c + 3] - caps[c]) * u + Math.sin(ph) * Math.cos(th) * r;
  out[k + 1] = caps[c + 1] + (caps[c + 4] - caps[c + 1]) * u + Math.cos(ph) * r;
  out[k + 2] = caps[c + 2] + (caps[c + 5] - caps[c + 2]) * u + Math.sin(ph) * Math.sin(th) * r;
  return c / CAP;
}
