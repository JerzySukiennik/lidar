// LiDAR Point Cloud 001: turns the generated world into one triangle soup with a BVH for lidar rays and a black occluder mesh.

import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { vnoise3, hash3 } from './rng.js';
import { N, SOLID, OPEN, FLOOR_Y, RAMP_CEIL, T_ENV, T_STAIRS } from './world.js';
import { human, makeBody, CAP, HUMAN_CAPS } from './figure.js';

const V = N + 1;

class Soup {
  constructor() { this.p = []; this.t = []; }
  tri(a, b, c, type) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.t.push(type);
  }
  quad(a, b, c, d, type) { this.tri(a, b, c, type); this.tri(a, c, d, type); }
}

function addBox(S, b) {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw), hx = b.sx / 2, hy = b.sy / 2, hz = b.sz / 2, v = [];
  for (const dy of [-hy, hy]) for (const [dx, dz] of [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]) {
    v.push([b.x + dx * c + dz * s, b.y + dy, b.z - dx * s + dz * c]);
  }
  S.quad(v[0], v[1], v[2], v[3], b.t);
  S.quad(v[4], v[5], v[6], v[7], b.t);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; S.quad(v[i], v[j], v[j + 4], v[i + 4], b.t); }
}

function addCone(S, c) {
  const sides = 7, ring = [], tip = [c.x + (hash3(c.x * 91, c.z * 57, 3) - 0.5) * c.r, c.y + c.h, c.z + (hash3(c.x * 13, c.z * 77, 5) - 0.5) * c.r];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * 6.283, rr = c.r * (0.8 + 0.4 * hash3(i, c.x * 31, c.z * 17));
    ring.push([c.x + Math.cos(a) * rr, c.y, c.z + Math.sin(a) * rr]);
  }
  const mid = ring.map((p) => [p[0] + (tip[0] - p[0]) * 0.45, c.y + c.h * 0.4, p[2] + (tip[2] - p[2]) * 0.45]);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    S.quad(ring[i], ring[j], mid[j], mid[i], c.t);
    S.tri(mid[i], mid[j], tip, c.t);
  }
}

const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  v = v.map((p) => { const l = Math.hypot(...p); return [p[0] / l, p[1] / l, p[2] / l]; });
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const out = [];
  const mid = (a, b) => { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], l = Math.hypot(...m); return [m[0] / l, m[1] / l, m[2] / l]; };
  for (const [a, b, c] of f) {
    const A = v[a], B = v[b], C = v[c], ab = mid(A, B), bc = mid(B, C), ca = mid(C, A);
    out.push([A, ab, ca], [B, bc, ab], [C, ca, bc], [ab, bc, ca]);
  }
  return out;
})();

function addBlob(S, b) {
  const P = (d) => {
    const k = b.r * (0.72 + 0.56 * vnoise3(d[0] * 1.7 + 5, d[1] * 1.7 + 5, d[2] * 1.7 + 5, b.s));
    return [b.x + d[0] * k, b.y + d[1] * k * 0.8, b.z + d[2] * k];
  };
  for (const [a, c, d] of ICO) S.tri(P(a), P(c), P(d), T_ENV);
}

function addCapsules(S, caps, n, type, shrink = 1) {
  const sides = 6;
  for (let i = 0; i < n; i++) {
    const k = i * CAP, a = [caps[k], caps[k + 1], caps[k + 2]], b = [caps[k + 3], caps[k + 4], caps[k + 5]], r = caps[k + 6] * shrink;
    let ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const l = Math.hypot(ux, uy, uz);
    if (l < 1e-5) { ux = 0; uy = 1; uz = 0; } else { ux /= l; uy /= l; uz /= l; }
    let px = uy, py = -ux, pz = 0;
    if (Math.abs(uy) > 0.9) { px = 0; py = -uz; pz = uy; }
    const pl = Math.hypot(px, py, pz);
    px /= pl; py /= pl; pz /= pl;
    const qx = uy * pz - uz * py, qy = uz * px - ux * pz, qz = ux * py - uy * px;
    const ra = [], rb = [];
    for (let s = 0; s < sides; s++) {
      const an = (s / sides) * 6.283, c = Math.cos(an) * r, d = Math.sin(an) * r;
      const ox = px * c + qx * d, oy = py * c + qy * d, oz = pz * c + qz * d;
      ra.push([a[0] + ox, a[1] + oy, a[2] + oz]);
      rb.push([b[0] + ox, b[1] + oy, b[2] + oz]);
    }
    const ta = [a[0] - ux * r, a[1] - uy * r, a[2] - uz * r], tb = [b[0] + ux * r, b[1] + uy * r, b[2] + uz * r];
    for (let s = 0; s < sides; s++) {
      const j = (s + 1) % sides;
      if (l > 1e-5) S.quad(ra[s], ra[j], rb[j], rb[s], type);
      S.tri(ra[s], ra[j], ta, type);
      S.tri(rb[s], rb[j], tb, type);
    }
  }
}

function addCells(S, world, F) {
  const amp = F.theme.warp, seed = world.seed + F.f * 57;
  const W = (vx, vz, h) => {
    const vi = vz * V + vx, fy = F.fy[vi], y = fy + (F.cy[vi] - fy) * h, a = amp * F.mask[vi];
    if (!a) return [vx, y, vz];
    return [vx + (vnoise3(vx * 0.37, h * 1.7, vz * 0.37, seed) * 2 - 1) * a, y, vz + (vnoise3(vx * 0.37 + 40, h * 1.7, vz * 0.37 + 40, seed + 7) * 2 - 1) * a];
  };
  const solid = (x, z) => x < 0 || z < 0 || x >= N || z >= N || F.cells[z * N + x] === SOLID;
  const K = amp ? (F.f === 4 ? 7 : 3) : 1;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    if (F.cells[z * N + x] !== OPEN) continue;
    S.quad(W(x, z, 0), W(x + 1, z, 0), W(x + 1, z + 1, 0), W(x, z + 1, 0), T_ENV);
    S.quad(W(x, z, 1), W(x + 1, z, 1), W(x + 1, z + 1, 1), W(x, z + 1, 1), T_ENV);
    const edges = [[x, z - 1, x, z, x + 1, z], [x + 1, z, x + 1, z, x + 1, z + 1], [x, z + 1, x + 1, z + 1, x, z + 1], [x - 1, z, x, z + 1, x, z]];
    for (const [nx, nz, ax, az, bx, bz] of edges) {
      if (!solid(nx, nz)) continue;
      for (let k = 0; k < K; k++) S.quad(W(ax, az, k / K), W(bx, bz, k / K), W(bx, bz, (k + 1) / K), W(ax, az, (k + 1) / K), T_ENV);
    }
  }
}

function addRamp(S, R) {
  const y0 = FLOOR_Y[R.f], P = (s, l, y) => [R.ex + 0.5 + R.dx * (s - 0.5) + R.px * (l - 0.5), y, R.ez + 0.5 + R.dz * (s - 0.5) + R.pz * (l - 0.5)];
  const steps = Math.round(R.drop / 0.18), run = R.L / steps, rise = R.drop / steps;
  for (let i = 0; i < steps; i++) {
    const s0 = i * run, s1 = s0 + run, yt = y0 - (i + 1) * rise;
    S.quad(P(s0, 0, yt + rise), P(s0, 2, yt + rise), P(s0, 2, yt), P(s0, 0, yt), T_STAIRS);
    S.quad(P(s0, 0, yt), P(s0, 2, yt), P(s1, 2, yt), P(s1, 0, yt), T_STAIRS);
  }
  const y1 = y0 - R.drop;
  S.quad(P(0, 0, y0 + RAMP_CEIL), P(0, 2, y0 + RAMP_CEIL), P(R.L, 2, y1 + RAMP_CEIL), P(R.L, 0, y1 + RAMP_CEIL), T_ENV);
  for (const l of [0, 2]) S.quad(P(0, l, y0 - rise), P(R.L, l, y1 - rise), P(R.L, l, y1 + RAMP_CEIL), P(0, l, y0 + RAMP_CEIL), T_ENV);
  for (const [s, y] of [[-0.12, y0], [R.L + 0.12, y1]]) {
    for (const l of [0.07, 1.93]) S.quad(P(s, l - 0.07, y), P(s, l + 0.07, y), P(s, l + 0.07, y + RAMP_CEIL), P(s, l - 0.07, y + RAMP_CEIL), T_STAIRS);
    S.quad(P(s, 0, y + RAMP_CEIL - 0.16), P(s, 2, y + RAMP_CEIL - 0.16), P(s, 2, y + RAMP_CEIL), P(s, 0, y + RAMP_CEIL), T_STAIRS);
    S.quad(P(s - 0.5, 0.1, y + 0.012), P(s - 0.5, 1.9, y + 0.012), P(s + 0.5, 1.9, y + 0.012), P(s + 0.5, 0.1, y + 0.012), T_STAIRS);
  }
}

export function buildGeometry(world, floorsOnly) {
  const S = new Soup(), want = (f) => !floorsOnly || floorsOnly.includes(f);
  for (const F of world.floors) if (want(F.f)) addCells(S, world, F);
  for (const R of world.ramps) if (want(R.f) || want(R.f + 1)) addRamp(S, R);
  const inFloor = (y) => {
    if (!floorsOnly) return true;
    for (const f of floorsOnly) if (y > FLOOR_Y[f] - 1 && y < FLOOR_Y[f] + world.floors[f].theme.ceil + 0.6) return true;
    return false;
  };
  for (const b of world.boxes) if (inFloor(b.y)) addBox(S, b);
  for (const c of world.cones) if (inFloor(c.y + c.h / 2)) addCone(S, c);
  for (const b of world.blobs) if (inFloor(b.y)) addBlob(S, b);
  const X = new Soup(), fixed = world.floors.map(() => []);
  for (const s of world.statues) {
    if (!want(s.f)) continue;
    const caps = new Float32Array(CAP * HUMAN_CAPS);
    const n = human(caps, s.x, world.groundY(s.f, s.x, s.z) - 0.02, s.z, s.yaw, { scale: s.scale, pose: s.pose });
    fixed[s.f].push(makeBody(0, null, caps, n));
    addCapsules(X, caps, n, T_ENV, 0.86);
  }
  const extra = new THREE.BufferGeometry();
  extra.setAttribute('position', new THREE.BufferAttribute(new Float32Array(X.p), 3));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(S.p), 3));
  const bvh = new MeshBVH(geometry, { maxLeafTris: 6 });
  geometry.boundsTree = bvh;
  const src = geometry.index.array, types = new Uint8Array(S.t.length);
  for (let i = 0; i < types.length; i++) types[i] = S.t[(src[i * 3] / 3) | 0];
  return { geometry, extra, fixed, bvh, types, tris: types.length };
}

export class Caster {
  constructor(built) {
    this.bvh = built.bvh;
    this.types = built.types;
    this.ray = new THREE.Ray();
    this.out = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, type: 0 };
  }

  cast(ox, oy, oz, dx, dy, dz, far) {
    const r = this.ray;
    r.origin.set(ox, oy, oz);
    r.direction.set(dx, dy, dz);
    const h = this.bvh.raycastFirst(r, THREE.DoubleSide, 0, far);
    if (!h) return null;
    const o = this.out, n = h.face.normal, flip = n.x * dx + n.y * dy + n.z * dz > 0 ? -1 : 1;
    o.t = h.distance;
    o.x = h.point.x; o.y = h.point.y; o.z = h.point.z;
    o.nx = n.x * flip; o.ny = n.y * flip; o.nz = n.z * flip;
    o.type = this.types[h.faceIndex];
    return o;
  }
}
