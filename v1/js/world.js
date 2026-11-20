// LiDAR Point Cloud 001: seeded procedural world (five floors joined by stair tunnels, props, statues, pathfinding).

import { mulberry32, hash3, fbm2, smoothstep } from './rng.js';

export const N = 72;
export const SOLID = 0, OPEN = 1, RAMP = 2;
export const RAMP_CEIL = 2.6;
export const SLOPE = 0.46;
export const T_ENV = 0, T_PLAYER = 1, T_MONSTER = 2, T_STAIRS = 3, T_GOAL = 4;
export const THEMES = [
  { key: 'station', label: 'STATION', ceil: 3.0, warp: 0, bump: 0 },
  { key: 'storage', label: 'STORAGE', ceil: 4.2, warp: 0, bump: 0 },
  { key: 'mine', label: 'MINE', ceil: 2.7, warp: 0.16, bump: 0.05 },
  { key: 'caves', label: 'CAVES', ceil: 4.6, warp: 0.3, bump: 0.2 },
  { key: 'bottom', label: 'THE BOTTOM', ceil: 13, warp: 0.3, bump: 0.25 },
];
export const FLOOR_Y = [];
for (let f = 0, y = 0; f < THEMES.length; f++) {
  if (f) y -= THEMES[f].ceil + 1.2;
  FLOOR_Y.push(y);
}

const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
const V = N + 1;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(k, v) {
    const a = this.a;
    a.push([k, v]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

export class World {
  constructor(seed) {
    this.seed = seed >>> 0;
    for (let attempt = 0; attempt < 40; attempt++) {
      this.rnd = mulberry32(this.seed + attempt * 7919);
      this.reset();
      if (this.build()) return;
    }
    throw new Error('world generation failed');
  }

  reset() {
    this.floors = THEMES.map((theme, f) => ({
      f, theme, y: FLOOR_Y[f],
      cells: new Uint8Array(N * N), lock: new Uint8Array(N * N), block: new Uint8Array(N * N),
      corr: new Uint8Array(N * N), keep: new Uint8Array(N * N), rampAt: new Int8Array(N * N).fill(-1),
      mask: new Float32Array(V * V), fy: new Float32Array(V * V), cy: new Float32Array(V * V),
      obst: new Map(), rooms: [], open: [],
    }));
    this.ramps = [];
    this.boxes = [];
    this.cones = [];
    this.blobs = [];
    this.statues = [];
    this.arrivals = [];
    this.exits = [];
    this.monsterSpawns = [];
  }

  build() {
    if (!this.placeRamps()) return false;
    const F = this.floors;
    this.genStation(F[0]);
    this.genStorage(F[1]);
    this.genMine(F[2]);
    this.genCaves(F[3]);
    this.genBottom(F[4]);
    for (const fl of F) this.computeHeights(fl);
    this.propsStation(F[0]);
    this.propsStorage(F[1]);
    this.propsMine(F[2]);
    this.propsCaves(F[3]);
    this.propsBottom(F[4]);
    for (const fl of F) if (!this.verify(fl)) return false;
    this.placeMonsters();
    return true;
  }

  fixRoom(F, x0, z0, x1, z1, cx, cz) {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = z * N + x;
      if (F.lock[i]) continue;
      F.cells[i] = OPEN;
      F.keep[i] = 1;
    }
    F.rooms.push({ x0, z0, x1, z1, cx, cz, fixed: true });
  }

  placeRamps() {
    const r = this.rnd, C = N / 2;
    const sx = (r() < 0.5 ? 9 : N - 10) + Math.floor(r() * 5) - 2;
    const sz = (r() < 0.5 ? 9 : N - 10) + Math.floor(r() * 5) - 2;
    this.fixRoom(this.floors[0], sx - 3, sz - 3, sx + 2, sz + 2, sx, sz);
    this.spawn = { f: 0, x: sx, z: sz, yaw: Math.atan2(sx - C, sz - C) };
    this.arrivals[0] = this.spawn;
    const res = THEMES.map(() => []);
    res[0].push({ x0: sx - 5, z0: sz - 5, x1: sx + 4, z1: sz + 4 });
    const overlap = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.z0 <= b.z1 && b.z0 <= a.z1;
    let arrive = [sx, sz];
    for (let f = 0; f < 4; f++) {
      const drop = FLOOR_Y[f] - FLOOR_Y[f + 1], L = Math.ceil(drop / SLOPE);
      let R = null;
      for (let t = 0; t < 5000 && !R; t++) {
        const minD = Math.max(14, 40 - Math.floor(t / 250) * 2);
        const di = Math.floor(r() * 4), dx = DX[di], dz = DZ[di], px = -dz, pz = dx;
        const ex = 2 + Math.floor(r() * (N - 4)), ez = 2 + Math.floor(r() * (N - 4));
        const cell = (a, b) => [ex + dx * a + px * b, ez + dz * a + pz * b];
        const inb = (c) => c[0] >= 2 && c[1] >= 2 && c[0] <= N - 3 && c[1] <= N - 3;
        if (!inb(cell(-7, -2)) || !inb(cell(-7, 3)) || !inb(cell(L + 6, -2)) || !inb(cell(L + 6, 3))) continue;
        const top = cell(-3, 0), bot = cell(L + 2, 0);
        if (Math.hypot(top[0] - arrive[0], top[1] - arrive[1]) < minD) continue;
        const rect = (a0, a1) => {
          const c0 = cell(a0, -2), c1 = cell(a1, 3);
          return { x0: Math.min(c0[0], c1[0]), z0: Math.min(c0[1], c1[1]), x1: Math.max(c0[0], c1[0]), z1: Math.max(c0[1], c1[1]) };
        };
        const rTop = rect(-7, L + 1), rBot = rect(-2, L + 6);
        if (res[f].some((q) => overlap(q, rTop))) continue;
        if (f === 3) {
          let ok = true;
          for (let a = -2; a <= L + 5; a++) {
            const c = cell(a, 0);
            if (Math.hypot(c[0] - C, c[1] - C) < 28) ok = false;
          }
          if (!ok || Math.hypot(bot[0] - C, bot[1] - C) > 34) continue;
        }
        R = { idx: f, f, L, drop, dx, dz, px, pz, ex, ez, cell, rTop, rBot, top, bot };
      }
      if (!R) return false;
      const { L: len, cell } = R;
      for (let a = -1; a <= len; a++) for (let b = -1; b <= 2; b++) {
        const [x, z] = cell(a, b), i = z * N + x, foot = a >= 0 && a < len && b >= 0 && b <= 1;
        for (const [F, gap] of [[this.floors[f], -1], [this.floors[f + 1], len]]) {
          if (foot) { F.cells[i] = RAMP; F.rampAt[i] = R.idx; F.lock[i] = 1; }
          else if (a === gap && b >= 0 && b <= 1) { F.cells[i] = OPEN; F.keep[i] = 1; }
          else { F.cells[i] = SOLID; F.lock[i] = 1; }
        }
      }
      const land = (F, a0, a1, ac) => {
        const c0 = cell(a0, -1), c1 = cell(a1, 2), c = cell(ac, 0);
        this.fixRoom(F, Math.min(c0[0], c1[0]), Math.min(c0[1], c1[1]), Math.max(c0[0], c1[0]), Math.max(c0[1], c1[1]), c[0], c[1]);
      };
      land(this.floors[f], -5, -2, -3);
      land(this.floors[f + 1], len + 1, len + 4, len + 2);
      res[f].push(R.rTop);
      res[f + 1].push(R.rBot);
      this.ramps.push(R);
      const mid = (a) => { const c0 = cell(a, 0), c1 = cell(a, 1); return [(c0[0] + c1[0]) / 2 + 0.5, (c0[1] + c1[1]) / 2 + 0.5]; };
      const e = mid(-3), b = mid(len + 2);
      this.exits[f] = { f, x: e[0], z: e[1] };
      this.arrivals[f + 1] = { f: f + 1, x: b[0], z: b[1], yaw: Math.atan2(-R.dx, -R.dz) };
      arrive = R.bot;
    }
    return true;
  }

  carve(F, x, z) {
    if (x < 1 || z < 1 || x > N - 2 || z > N - 2) return false;
    const i = z * N + x;
    if (F.lock[i]) return false;
    if (F.cells[i] === SOLID) F.cells[i] = OPEN;
    return true;
  }

  rectFree(F, x0, z0, x1, z1) {
    if (x0 < 2 || z0 < 2 || x1 > N - 3 || z1 > N - 3) return false;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = z * N + x;
      if (F.cells[i] !== SOLID || F.lock[i]) return false;
    }
    return true;
  }

  addRooms(F, want, lo, hi, tries) {
    const r = this.rnd;
    let made = 0;
    for (let t = 0; t < tries && made < want; t++) {
      const w = lo + Math.floor(r() * (hi - lo + 1)), h = lo + Math.floor(r() * (hi - lo + 1));
      const x0 = 3 + Math.floor(r() * (N - 6 - w)), z0 = 3 + Math.floor(r() * (N - 6 - h));
      if (!this.rectFree(F, x0 - 1, z0 - 1, x0 + w, z0 + h)) continue;
      for (let z = z0; z < z0 + h; z++) for (let x = x0; x < x0 + w; x++) F.cells[z * N + x] = OPEN;
      F.rooms.push({ x0, z0, x1: x0 + w - 1, z1: z0 + h - 1, cx: x0 + (w >> 1), cz: z0 + (h >> 1) });
      made++;
    }
  }

  route(F, ax, az, bx, bz, wig = 0, turn = 2.5, reuse = 0.55) {
    const S = N * N * 4, dist = new Float64Array(S).fill(1e9), prev = new Int32Array(S).fill(-1), h = new Heap();
    const ia = az * N + ax, ib = bz * N + bx;
    for (let d = 0; d < 4; d++) { dist[ia * 4 + d] = 0; h.push(0, ia * 4 + d); }
    let end = -1;
    while (h.size) {
      const [k, s] = h.pop();
      if (k > dist[s]) continue;
      const c = s >> 2, d = s & 3;
      if (c === ib) { end = s; break; }
      const x = c % N, z = (c / N) | 0;
      for (let nd = 0; nd < 4; nd++) {
        const nx = x + DX[nd], nz = z + DZ[nd];
        if (nx < 2 || nz < 2 || nx > N - 3 || nz > N - 3) continue;
        const ni = nz * N + nx;
        if (F.lock[ni] || F.cells[ni] === RAMP) continue;
        const nk = k + (F.cells[ni] === OPEN ? reuse : 1) + (nd !== d ? turn : 0) + wig * hash3(nx, nz, this.seed + F.f);
        const ns = ni * 4 + nd;
        if (nk < dist[ns]) { dist[ns] = nk; prev[ns] = s; h.push(nk, ns); }
      }
    }
    if (end < 0) return null;
    const path = [];
    for (let s = end; s >= 0; s = prev[s]) path.push(s >> 2);
    return path.reverse();
  }

  carvePath(F, path, w) {
    if (!path) return;
    const o = w > 2 ? 1 : 0;
    for (const c of path) {
      const x = c % N, z = (c / N) | 0;
      for (let oz = 0; oz < w; oz++) for (let ox = 0; ox < w; ox++) {
        const X = x + ox - o, Z = z + oz - o, i = Z * N + X;
        if (X < 1 || Z < 1 || X > N - 2 || Z > N - 2 || F.lock[i]) continue;
        if (F.cells[i] === SOLID) { F.cells[i] = OPEN; F.corr[i] = 1; }
      }
    }
  }

  link(F, width, extra, wig, turn) {
    const R = F.rooms, n = R.length, r = this.rnd, inT = new Uint8Array(n), edges = [];
    inT[0] = 1;
    for (let k = 1; k < n; k++) {
      let bi = -1, bj = -1, bd = 1e9;
      for (let i = 0; i < n; i++) if (inT[i]) for (let j = 0; j < n; j++) if (!inT[j]) {
        const d = Math.hypot(R[i].cx - R[j].cx, R[i].cz - R[j].cz);
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
      edges.push([bi, bj]);
      inT[bj] = 1;
    }
    for (let i = 0; i < n; i++) if (r() < extra) {
      const o = R.map((q, j) => [Math.hypot(q.cx - R[i].cx, q.cz - R[i].cz), j]).filter((e) => e[1] !== i).sort((a, b) => a[0] - b[0]);
      edges.push([i, o[Math.min(o.length - 1, 1 + Math.floor(r() * 2))][1]]);
    }
    for (const [i, j] of edges) this.carvePath(F, this.route(F, R[i].cx, R[i].cz, R[j].cx, R[j].cz, wig, turn), width);
  }

  genStation(F) {
    this.addRooms(F, 36, 3, 9, 1600);
    this.link(F, 2, 0.32, 0, 2.5);
  }

  genStorage(F) {
    this.addRooms(F, 9, 10, 17, 700);
    this.addRooms(F, 8, 4, 6, 400);
    this.link(F, 3, 0.4, 0, 3);
    for (const q of F.rooms) {
      if (q.fixed || q.x1 - q.x0 < 8 || q.z1 - q.z0 < 8) continue;
      q.hall = true;
      for (let z = q.z0 + 2; z <= q.z1 - 2; z += 4) for (let x = q.x0 + 2; x <= q.x1 - 2; x += 4) {
        const i = z * N + x;
        if ((x === q.cx && z === q.cz) || F.corr[i] || F.keep[i]) continue;
        F.cells[i] = SOLID;
        F.lock[i] = 1;
      }
    }
  }

  genMine(F) {
    const r = this.rnd, G = 7, nodes = [];
    for (let gz = 0; gz < G; gz++) for (let gx = 0; gx < G; gx++) {
      let x = 0, z = 0, ok = false;
      for (let t = 0; t < 12 && !ok; t++) {
        x = Math.round(7 + gx * 9.6 + (r() * 5 - 2.5));
        z = Math.round(7 + gz * 9.6 + (r() * 5 - 2.5));
        ok = !F.lock[z * N + x] && F.cells[z * N + x] !== RAMP;
      }
      nodes.push(ok ? { x, z, gx, gz } : null);
    }
    const seen = new Uint8Array(G * G), edges = [], stack = [Math.floor(r() * G * G)];
    seen[stack[0]] = 1;
    while (stack.length) {
      const c = stack[stack.length - 1], gx = c % G, gz = (c / G) | 0, opts = [];
      for (let d = 0; d < 4; d++) {
        const nx = gx + DX[d], nz = gz + DZ[d];
        if (nx >= 0 && nz >= 0 && nx < G && nz < G && !seen[nz * G + nx]) opts.push(nz * G + nx);
      }
      if (!opts.length) { stack.pop(); continue; }
      const n = opts[Math.floor(r() * opts.length)];
      seen[n] = 1;
      edges.push([c, n]);
      stack.push(n);
    }
    for (let c = 0; c < G * G; c++) for (const d of [0, 1]) {
      const nx = (c % G) + DX[d], nz = ((c / G) | 0) + DZ[d];
      if (nx < G && nz < G && r() < 0.16) edges.push([c, nz * G + nx]);
    }
    for (const [a, b] of edges) {
      const A = nodes[a], B = nodes[b];
      if (A && B) this.carvePath(F, this.route(F, A.x, A.z, B.x, B.z, 3.5, 0.4, 0.8), 2);
    }
    for (const n of nodes) if (n && r() < 0.34) {
      const rad = 2 + r() * 2.4;
      n.chamber = rad;
      for (let z = Math.floor(n.z - rad); z <= n.z + rad; z++) for (let x = Math.floor(n.x - rad); x <= n.x + rad; x++) {
        if (Math.hypot(x + 0.5 - n.x, z + 0.5 - n.z) < rad) this.carve(F, x, z);
      }
    }
    F.nodes = nodes.filter(Boolean);
    for (const q of F.rooms) {
      let best = null, bd = 1e9;
      for (const n of F.nodes) { const d = Math.hypot(n.x - q.cx, n.z - q.cz); if (d < bd) { bd = d; best = n; } }
      this.carvePath(F, this.route(F, q.cx, q.cz, best.x, best.z, 3.5, 0.4, 0.8), 2);
    }
    this.unify(F, 1, 3.5, 0.4, 0.8);
  }

  genCaves(F) {
    const r = this.rnd;
    let g = new Uint8Array(N * N);
    for (let z = 3; z < N - 3; z++) for (let x = 3; x < N - 3; x++) g[z * N + x] = r() < 0.58 ? 1 : 0;
    for (let it = 0; it < 6; it++) {
      const n = new Uint8Array(N * N);
      for (let z = 3; z < N - 3; z++) for (let x = 3; x < N - 3; x++) {
        let s1 = 0, s2 = 0;
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
          if (g[(z + dz) * N + x + dx]) continue;
          s2++;
          if (dx >= -1 && dx <= 1 && dz >= -1 && dz <= 1) s1++;
        }
        n[z * N + x] = s1 >= 5 || (it < 4 && s2 <= 2) ? 0 : 1;
      }
      g = n;
    }
    for (let i = 0; i < N * N; i++) if (g[i] && !F.lock[i] && F.cells[i] === SOLID) F.cells[i] = OPEN;
    this.unify(F, 10, 2, 0.3, 0.2);
  }

  unify(F, minSize, wig, turn, reuse) {
    const comp = new Int32Array(N * N).fill(-1), list = [];
    for (let s = 0; s < N * N; s++) {
      if (F.cells[s] !== OPEN || comp[s] >= 0) continue;
      const id = list.length, q = [s], c = { rep: s, size: 0, keep: false, cells: q };
      comp[s] = id;
      for (let h = 0; h < q.length; h++) {
        const i = q[h], x = i % N, z = (i / N) | 0;
        c.size++;
        if (F.keep[i]) c.keep = true;
        for (let d = 0; d < 4; d++) {
          const ni = (z + DZ[d]) * N + x + DX[d];
          if (F.cells[ni] === OPEN && comp[ni] < 0) { comp[ni] = id; q.push(ni); }
        }
      }
      list.push(c);
    }
    const main = list.reduce((a, b) => (b.size > a.size ? b : a));
    for (const c of list) {
      if (c === main) continue;
      if (c.size >= minSize || c.keep) {
        this.carvePath(F, this.route(F, c.rep % N, (c.rep / N) | 0, main.rep % N, (main.rep / N) | 0, wig, turn, reuse), 2);
      } else for (const i of c.cells) F.cells[i] = SOLID;
    }
  }

  genBottom(F) {
    const C = N / 2;
    for (let z = 2; z < N - 2; z++) for (let x = 2; x < N - 2; x++) {
      const dx = x + 0.5 - C, dz = z + 0.5 - C, a = Math.atan2(dz, dx);
      const rad = 20 + 5 * (fbm2(Math.cos(a) * 1.6 + 9, Math.sin(a) * 1.6 + 9, this.seed) * 2 - 1);
      if (Math.hypot(dx, dz) < rad) this.carve(F, x, z);
    }
    const A = F.rooms[0];
    this.carvePath(F, this.route(F, A.cx, A.cz, C, C, 2.5, 0.3, 0.2), 2);
    this.goal = { f: 4, x: C, z: C, r: 1.7 };
  }

  ceilRaw(F, x, z) {
    const s = this.seed + F.f * 31;
    if (F.f === 0) return 3.0;
    if (F.f === 1) return 4.2;
    if (F.f === 2) return 2.15 + 0.55 * fbm2(x * 0.23, z * 0.23, s + 5);
    if (F.f === 3) { const n = fbm2(x * 0.11, z * 0.11, s + 9); return Math.min(4.6, 2.1 + 4 * n * n); }
    const d = Math.hypot(x - N / 2, z - N / 2);
    return 4.5 + 8.5 * smoothstep(27, 5, d) * (0.8 + 0.2 * fbm2(x * 0.1, z * 0.1, s + 3));
  }

  computeHeights(F) {
    const d = new Int16Array(N * N).fill(99), q = [];
    for (let i = 0; i < N * N; i++) if (F.cells[i] === RAMP || F.keep[i]) { d[i] = 0; q.push(i); }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % N, z = (i / N) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const ni = nz * N + nx;
        if (d[ni] > d[i] + 1) { d[ni] = d[i] + 1; q.push(ni); }
      }
    }
    for (let vz = 0; vz <= N; vz++) for (let vx = 0; vx <= N; vx++) {
      let m = 99;
      for (let cz = vz - 1; cz <= vz; cz++) for (let cx = vx - 1; cx <= vx; cx++) {
        if (cx >= 0 && cz >= 0 && cx < N && cz < N) m = Math.min(m, d[cz * N + cx]);
      }
      const mk = smoothstep(1, 5, m), vi = vz * V + vx;
      F.mask[vi] = mk;
      F.fy[vi] = F.y + mk * F.theme.bump * (fbm2(vx * 0.19, vz * 0.19, this.seed + F.f * 13) * 2 - 1);
      F.cy[vi] = F.y + RAMP_CEIL + mk * (this.ceilRaw(F, vx, vz) - RAMP_CEIL);
    }
    for (let i = 0; i < N * N; i++) if (F.cells[i] === OPEN) F.open.push(i);
  }

  bilerp(arr, x, z) {
    const cx = clamp(Math.floor(x), 0, N - 1), cz = clamp(Math.floor(z), 0, N - 1), u = x - cx, v = z - cz;
    const a = arr[cz * V + cx], b = arr[cz * V + cx + 1], c = arr[(cz + 1) * V + cx], d = arr[(cz + 1) * V + cx + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  rampS(R, x, z) { return (x - R.ex - 0.5) * R.dx + (z - R.ez - 0.5) * R.dz + 0.5; }
  rampY(R, x, z) { return FLOOR_Y[R.f] - R.drop * clamp(this.rampS(R, x, z) / R.L, 0, 1); }

  rampOf(f, x, z) {
    const cx = Math.floor(x), cz = Math.floor(z);
    if (cx < 0 || cz < 0 || cx >= N || cz >= N) return null;
    const k = this.floors[f].rampAt[cz * N + cx];
    return k < 0 ? null : this.ramps[k];
  }

  groundY(f, x, z) {
    const R = this.rampOf(f, x, z);
    return R ? this.rampY(R, x, z) : this.bilerp(this.floors[f].fy, x, z);
  }

  ceilY(f, x, z) { return this.bilerp(this.floors[f].cy, x, z); }

  blocked(f, cx, cz) {
    if (cx < 0 || cz < 0 || cx >= N || cz >= N) return true;
    const F = this.floors[f], i = cz * N + cx;
    return F.cells[i] === SOLID || F.block[i] === 1;
  }

  walkable(f, cx, cz) {
    if (cx < 0 || cz < 0 || cx >= N || cz >= N) return false;
    const F = this.floors[f], i = cz * N + cx;
    return F.cells[i] === OPEN && !F.block[i];
  }

  addObstacle(F, x, z, r) {
    const k = Math.floor(z) * N + Math.floor(x);
    if (!F.obst.has(k)) F.obst.set(k, []);
    F.obst.get(k).push({ x, z, r });
  }

  resolve(f, x, z, r) {
    const F = this.floors[f];
    for (let it = 0; it < 2; it++) {
      const bx = Math.floor(x), bz = Math.floor(z);
      for (let cz = bz - 1; cz <= bz + 1; cz++) for (let cx = bx - 1; cx <= bx + 1; cx++) {
        if (this.blocked(f, cx, cz)) {
          const px = clamp(x, cx, cx + 1), pz = clamp(z, cz, cz + 1), dx = x - px, dz = z - pz, d2 = dx * dx + dz * dz;
          if (d2 < r * r) {
            if (d2 > 1e-8) { const d = Math.sqrt(d2), p = (r - d) / d; x += dx * p; z += dz * p; }
            else {
              const l = x - cx, rr = cx + 1 - x, t = z - cz, b = cz + 1 - z, m = Math.min(l, rr, t, b);
              if (m === l) x = cx - r; else if (m === rr) x = cx + 1 + r; else if (m === t) z = cz - r; else z = cz + 1 + r;
            }
          }
        }
        const list = F.obst.get(cz * N + cx);
        if (list) for (const o of list) {
          const dx = x - o.x, dz = z - o.z, d = Math.hypot(dx, dz), m = r + o.r;
          if (d < m && d > 1e-5) { x += (dx / d) * (m - d); z += (dz / d) * (m - d); }
        }
      }
    }
    return [x, z];
  }

  lineClear(f, ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 0.3);
    for (let i = 0; i <= n; i++) {
      const t = n ? i / n : 0, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      if (!this.walkable(f, Math.floor(x - 0.3), Math.floor(z - 0.3)) || !this.walkable(f, Math.floor(x + 0.3), Math.floor(z + 0.3)) ||
          !this.walkable(f, Math.floor(x - 0.3), Math.floor(z + 0.3)) || !this.walkable(f, Math.floor(x + 0.3), Math.floor(z - 0.3))) return false;
    }
    return true;
  }

  wallsBetween(f, ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 0.5), F = this.floors[f];
    let w = 0, inside = false;
    for (let i = 1; i < n; i++) {
      const t = i / n, cx = Math.floor(ax + (bx - ax) * t), cz = Math.floor(az + (bz - az) * t);
      const s = cx < 0 || cz < 0 || cx >= N || cz >= N || F.cells[cz * N + cx] === SOLID;
      if (s && !inside) w++;
      inside = s;
    }
    return w;
  }

  nearestWalkable(f, x, z) {
    const cx = Math.floor(x), cz = Math.floor(z);
    for (let rad = 0; rad < 8; rad++) for (let dz = -rad; dz <= rad; dz++) for (let dx = -rad; dx <= rad; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) === rad && this.walkable(f, cx + dx, cz + dz)) return [cx + dx, cz + dz];
    }
    return null;
  }

  findPath(f, ax, az, bx, bz) {
    const a = this.nearestWalkable(f, ax, az), b = this.nearestWalkable(f, bx, bz);
    if (!a || !b) return null;
    const ia = a[1] * N + a[0], ib = b[1] * N + b[0];
    const g = new Float32Array(N * N).fill(1e9), prev = new Int32Array(N * N).fill(-1), h = new Heap();
    g[ia] = 0;
    h.push(0, ia);
    let found = false;
    while (h.size) {
      const [, c] = h.pop();
      if (c === ib) { found = true; break; }
      const x = c % N, z = (c / N) | 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = x + dx, nz = z + dz;
        if (!this.walkable(f, nx, nz)) continue;
        if (dx && dz && (!this.walkable(f, nx, z) || !this.walkable(f, x, nz))) continue;
        const ni = nz * N + nx, ng = g[c] + (dx && dz ? 1.414 : 1);
        if (ng < g[ni]) { g[ni] = ng; prev[ni] = c; h.push(ng + Math.hypot(nx - b[0], nz - b[1]), ni); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let c = ib; c >= 0; c = prev[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => [(c % N) + 0.5, ((c / N) | 0) + 0.5]);
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = Math.min(pts.length - 1, i + 14);
      while (j > i + 1 && !this.lineClear(f, pts[i][0], pts[i][1], pts[j][0], pts[j][1])) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  randomOpen(f, rnd, minDistFrom, minDist) {
    const F = this.floors[f];
    for (let t = 0; t < 400; t++) {
      const i = F.open[Math.floor(rnd() * F.open.length)], x = (i % N) + 0.5, z = ((i / N) | 0) + 0.5;
      if (F.block[i]) continue;
      if (minDistFrom && Math.hypot(x - minDistFrom.x, z - minDistFrom.z) < minDist - t * 0.05) continue;
      return { x, z };
    }
    const i = F.open[0];
    return { x: (i % N) + 0.5, z: ((i / N) | 0) + 0.5 };
  }

  freeCell(F, x, z) {
    const i = z * N + x;
    if (F.cells[i] !== OPEN || F.corr[i] || F.keep[i] || F.block[i]) return false;
    let open = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && this.walkable(F.f, x + dx, z + dz)) open++;
    return open >= 5;
  }

  box(x, y, z, sx, sy, sz, yaw = 0, t = T_ENV) { this.boxes.push({ x, y, z, sx, sy, sz, yaw, t }); }

  crate(F, x, z, stack) {
    const r = this.rnd, g = this.groundY(F.f, x, z);
    let y = g, s = 0.62 + r() * 0.32;
    for (let k = 0; k < stack; k++) {
      const h = s * (0.7 + r() * 0.4);
      this.box(x + (r() - 0.5) * 0.08, y + h / 2, z + (r() - 0.5) * 0.08, s, h, s * (0.8 + r() * 0.3), r() * 0.6 - 0.3);
      y += h;
      s *= 0.78 + r() * 0.15;
    }
  }

  table(x, z, g, yaw) {
    this.box(x, g + 0.74, z, 0.96, 0.06, 0.82, yaw);
    for (const [ox, oz] of [[-0.42, -0.35], [0.42, -0.35], [-0.42, 0.35], [0.42, 0.35]]) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      this.box(x + ox * c + oz * s, g + 0.36, z - ox * s + oz * c, 0.06, 0.72, 0.06, yaw);
    }
  }

  lintels(F, chance, gap, build) {
    const r = this.rnd, placed = [];
    const far = (x, z) => placed.every((p) => Math.abs(p[0] - x) + Math.abs(p[1] - z) >= gap);
    const sol = (x, z) => F.cells[z * N + x] === SOLID, op = (x, z) => F.cells[z * N + x] === OPEN && !F.block[z * N + x];
    for (let z = 2; z < N - 3; z++) for (let x = 2; x < N - 3; x++) {
      if (F.keep[z * N + x]) continue;
      if (op(x, z) && op(x + 1, z) && sol(x - 1, z) && sol(x + 2, z) && r() < chance && far(x, z)) { placed.push([x, z]); build(x, z, 0); }
      else if (op(x, z) && op(x, z + 1) && sol(x, z - 1) && sol(x, z + 2) && r() < chance && far(x, z)) { placed.push([x, z]); build(x, z, 1); }
    }
  }

  runs(F, minLen, fn) {
    for (let axis = 0; axis < 2; axis++) for (let j = 1; j < N - 1; j++) {
      let start = -1;
      for (let k = 1; k < N; k++) {
        const i = axis ? k * N + j : j * N + k, up = axis ? k * N + j - 1 : (j - 1) * N + k;
        const c = k < N - 1 && F.corr[i] && !F.corr[up] && F.cells[i] === OPEN;
        if (c && start < 0) start = k;
        if (!c && start >= 0) { if (k - start >= minLen) fn(axis, j, start, k); start = -1; }
      }
    }
  }

  propsStation(F) {
    const r = this.rnd;
    for (const q of F.rooms) {
      if (q.fixed) continue;
      const count = Math.floor(r() * 5);
      for (let k = 0; k < count; k++) {
        const side = Math.floor(r() * 4);
        const x = side === 0 ? q.x0 : side === 1 ? q.x1 : q.x0 + Math.floor(r() * (q.x1 - q.x0 + 1));
        const z = side === 2 ? q.z0 : side === 3 ? q.z1 : q.z0 + Math.floor(r() * (q.z1 - q.z0 + 1));
        if (!this.freeCell(F, x, z)) continue;
        F.block[z * N + x] = 1;
        const kind = r(), g = F.y;
        if (kind < 0.42) this.crate(F, x + 0.5, z + 0.5, 1 + Math.floor(r() * 2.3));
        else if (kind < 0.68) this.table(x + 0.5, z + 0.5, g, side < 2 ? Math.PI / 2 : 0);
        else if (kind < 0.86) {
          this.box(x + 0.5, g + 0.95, z + 0.5, 0.86, 1.9, 0.5, side < 2 ? Math.PI / 2 : 0);
          this.box(x + 0.5, g + 1.93, z + 0.5, 0.9, 0.04, 0.54, side < 2 ? Math.PI / 2 : 0);
        } else {
          const yaw = side < 2 ? 0 : Math.PI / 2;
          this.box(x + 0.5, g + 0.42, z + 0.5, 0.86, 0.12, 0.96, yaw);
          this.box(x + 0.5, g + 1.32, z + 0.5, 0.86, 0.12, 0.96, yaw);
          for (const [ox, oz] of [[-0.4, -0.45], [0.4, -0.45], [-0.4, 0.45], [0.4, 0.45]]) {
            this.box(x + 0.5 + (yaw ? oz : ox), g + 0.85, z + 0.5 + (yaw ? ox : oz), 0.05, 1.7, 0.05);
          }
        }
      }
    }
    this.lintels(F, 0.1, 6, (x, z, o) => {
      const top = this.ceilY(0, x + 1, z + 1) - F.y;
      if (o === 0) {
        this.box(x + 1, F.y + (2.15 + top) / 2, z + 0.5, 2, top - 2.15, 0.26);
        this.box(x + 0.07, F.y + 1.075, z + 0.5, 0.14, 2.15, 0.26);
        this.box(x + 1.93, F.y + 1.075, z + 0.5, 0.14, 2.15, 0.26);
      } else {
        this.box(x + 0.5, F.y + (2.15 + top) / 2, z + 1, 0.26, top - 2.15, 2);
        this.box(x + 0.5, F.y + 1.075, z + 0.07, 0.26, 2.15, 0.14);
        this.box(x + 0.5, F.y + 1.075, z + 1.93, 0.26, 2.15, 0.14);
      }
    });
    this.runs(F, 5, (axis, j, a, b) => {
      const len = b - a, mid = (a + b) / 2, y = F.y + 2.42;
      if (axis === 0) { this.box(mid, y, j + 0.3, len, 0.13, 0.13); this.box(mid, y + 0.05, j + 0.58, len, 0.07, 0.07); }
      else { this.box(j + 0.3, y, mid, 0.13, 0.13, len); this.box(j + 0.58, y + 0.05, mid, 0.07, 0.07, len); }
      for (let k = a + 1; k < b; k += 3) {
        if (axis === 0) this.box(k, y + 0.2, j + 0.4, 0.05, 0.5, 0.36); else this.box(j + 0.4, y + 0.2, k, 0.36, 0.5, 0.05);
      }
    });
  }

  propsStorage(F) {
    const r = this.rnd;
    for (const q of F.rooms) {
      if (q.fixed) continue;
      if (!q.hall) {
        for (let k = 0; k < 3; k++) {
          const x = q.x0 + Math.floor(r() * (q.x1 - q.x0 + 1)), z = q.z0 + Math.floor(r() * (q.z1 - q.z0 + 1));
          if (this.freeCell(F, x, z)) { F.block[z * N + x] = 1; this.crate(F, x + 0.5, z + 0.5, 1 + Math.floor(r() * 3)); }
        }
        continue;
      }
      const alongX = q.x1 - q.x0 >= q.z1 - q.z0;
      const u0 = alongX ? q.x0 : q.z0, u1 = alongX ? q.x1 : q.z1, v0 = alongX ? q.z0 : q.x0, v1 = alongX ? q.z1 : q.x1;
      for (let v = v0 + 3; v <= v1 - 3; v += 3) {
        let u = u0 + 3;
        while (u <= u1 - 3) {
          const len = Math.min(3 + Math.floor(r() * 3), u1 - 2 - u);
          if (len < 2 || r() < 0.22) { u += 3; continue; }
          let ok = true;
          for (let k = 0; k < len; k++) {
            const x = alongX ? u + k : v, z = alongX ? v : u + k, i = z * N + x;
            if (F.cells[i] !== OPEN || F.corr[i] || F.keep[i] || F.block[i]) ok = false;
          }
          if (ok) this.rack(F, alongX, u, v, len);
          u += len + 2;
        }
      }
      for (let k = 0; k < 5; k++) {
        const x = q.x0 + Math.floor(r() * (q.x1 - q.x0 + 1)), z = q.z0 + Math.floor(r() * (q.z1 - q.z0 + 1));
        if (this.freeCell(F, x, z)) { F.block[z * N + x] = 1; this.crate(F, x + 0.5, z + 0.5, 1 + Math.floor(r() * 3)); }
      }
    }
    this.lintels(F, 0.07, 7, (x, z, o) => {
      const top = this.ceilY(1, x + 1, z + 1) - F.y;
      if (o === 0) this.box(x + 1, F.y + (2.6 + top) / 2, z + 0.5, 2, top - 2.6, 0.3);
      else this.box(x + 0.5, F.y + (2.6 + top) / 2, z + 1, 0.3, top - 2.6, 2);
    });
  }

  rack(F, alongX, u, v, len) {
    const r = this.rnd, g = F.y, H = 3.3, mid = u + len / 2;
    for (let k = 0; k < len; k++) F.block[(alongX ? v : u + k) * N + (alongX ? u + k : v)] = 1;
    const put = (a, y, b, sa, sy, sb, yaw = 0) => (alongX ? this.box(a, y, b, sa, sy, sb, yaw) : this.box(b, y, a, sb, sy, sa, yaw));
    for (let k = 0; k <= len; k++) for (const o of [0.1, 0.9]) put(u + k, g + H / 2, v + o, 0.06, H, 0.06);
    for (const y of [0.18, 1.12, 2.06, 3.0]) {
      put(mid, g + y, v + 0.5, len, 0.05, 0.86);
      for (let k = 0; k < len; k++) if (r() < 0.42 && y < 2.9) {
        const s = 0.34 + r() * 0.34, h = 0.25 + r() * 0.45;
        put(u + k + 0.5 + (r() - 0.5) * 0.25, g + y + 0.025 + h / 2, v + 0.5 + (r() - 0.5) * 0.15, s, h, s * (0.8 + r() * 0.4), r() * 0.5 - 0.25);
      }
    }
  }

  propsMine(F) {
    const r = this.rnd;
    this.lintels(F, 0.3, 3, (x, z, o) => {
      const cx = o === 0 ? x + 1 : x + 0.5, cz = o === 0 ? z + 0.5 : z + 1;
      const g = this.groundY(2, cx, cz), top = this.ceilY(2, cx, cz) - 0.12, h = top - g;
      if (o === 0) {
        this.box(x + 0.13, g + h / 2, z + 0.5, 0.17, h, 0.17);
        this.box(x + 1.87, g + h / 2, z + 0.5, 0.17, h, 0.17);
        this.box(x + 1, top - 0.1, z + 0.5, 2.1, 0.19, 0.19);
      } else {
        this.box(x + 0.5, g + h / 2, z + 0.13, 0.17, h, 0.17);
        this.box(x + 0.5, g + h / 2, z + 1.87, 0.17, h, 0.17);
        this.box(x + 0.5, top - 0.1, z + 1, 0.19, 0.19, 2.1);
      }
    });
    this.runs(F, 6, (axis, j, a, b) => {
      if (r() < 0.45) return;
      const len = b - a, mid = (a + b) / 2, g = this.groundY(2, axis ? j + 1 : mid, axis ? mid : j + 1);
      for (const o of [0.64, 1.36]) {
        if (axis === 0) this.box(mid, g + 0.07, j + o, len, 0.08, 0.05); else this.box(j + o, g + 0.07, mid, 0.05, 0.08, len);
      }
      for (let k = a + 0.3; k < b; k += 0.75) {
        if (axis === 0) this.box(k, g + 0.02, j + 1, 0.16, 0.05, 1.05); else this.box(j + 1, g + 0.02, k, 1.05, 0.05, 0.16);
      }
      if (len > 8 && r() < 0.5) {
        const k = a + 3 + r() * (len - 6), cx = axis ? j + 1 : k, cz = axis ? k : j + 1, yaw = axis ? 0 : Math.PI / 2;
        this.box(cx, g + 0.36, cz, 0.74, 0.05, 1.2, yaw);
        for (const s of [-1, 1]) {
          this.box(cx + (axis ? s * 0.37 : 0), g + 0.66, cz + (axis ? 0 : s * 0.37), 0.04, 0.6, 1.2, yaw);
          this.box(cx + (axis ? 0 : s * 0.6), g + 0.66, cz + (axis ? s * 0.6 : 0), 0.74, 0.6, 0.04, yaw);
        }
        this.addObstacle(F, cx, cz, 0.5);
      }
    });
    for (const n of F.nodes) if (n.chamber) {
      for (let k = 0; k < 4; k++) {
        const a = r() * 6.283, d = r() * (n.chamber - 1), x = Math.floor(n.x + Math.cos(a) * d), z = Math.floor(n.z + Math.sin(a) * d);
        if (this.freeCell(F, x, z)) { F.block[z * N + x] = 1; this.crate(F, x + 0.5, z + 0.5, 1 + Math.floor(r() * 2)); }
      }
    }
    this.deadEndStatues(F, 2);
  }

  deadEndStatues(F, want) {
    const r = this.rnd, cand = [];
    for (const i of F.open) {
      const x = i % N, z = (i / N) | 0;
      if (F.keep[i] || F.block[i]) continue;
      let solid = 0, sx = 0, sz = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && F.cells[(z + dz) * N + x + dx] === SOLID) { solid++; sx += dx; sz += dz; }
      if (solid >= 5 && (sx || sz)) cand.push([x, z, Math.atan2(-sx, -sz)]);
    }
    for (let k = 0; k < want && cand.length; k++) {
      const [x, z, yaw] = cand.splice(Math.floor(r() * cand.length), 1)[0];
      if (this.statues.some((s) => s.f === F.f && Math.hypot(s.x - x, s.z - z) < 6)) continue;
      this.statues.push({ f: F.f, x: x + 0.5, z: z + 0.5, yaw, scale: 0.94 + r() * 0.12, pose: r() < 0.3 ? 1 : 0 });
      this.addObstacle(F, x + 0.5, z + 0.5, 0.26);
    }
  }

  propsCaves(F) {
    const r = this.rnd;
    for (const i of F.open) {
      const x = i % N, z = (i / N) | 0;
      if (F.keep[i]) continue;
      const px = x + 0.2 + r() * 0.6, pz = z + 0.2 + r() * 0.6, g = this.groundY(3, px, pz), c = this.ceilY(3, px, pz), k = r();
      if (k < 0.05) {
        const rad = 0.12 + r() * 0.3, h = Math.min(c - g - 0.3, 0.5 + r() * 1.8);
        this.cones.push({ x: px, y: g - 0.05, z: pz, r: rad, h, t: T_ENV });
        if (rad > 0.24) this.addObstacle(F, px, pz, rad * 0.75);
      } else if (k < 0.14) {
        this.cones.push({ x: px, y: c + 0.05, z: pz, r: 0.08 + r() * 0.2, h: -(0.3 + r() * Math.min(1.6, c - g - 2)), t: T_ENV });
      } else if (k < 0.165 && this.freeCell(F, x, z)) {
        const rad = 0.4 + r() * 0.45;
        this.blobs.push({ x: px, y: g + rad * 0.45, z: pz, r: rad, s: Math.floor(r() * 1e6) });
        this.addObstacle(F, px, pz, rad * 0.8);
      }
    }
    this.deadEndStatues(F, 9);
  }

  propsBottom(F) {
    const r = this.rnd, C = N / 2;
    for (const i of F.open) {
      const x = i % N, z = (i / N) | 0, d = Math.hypot(x + 0.5 - C, z + 0.5 - C);
      if (F.keep[i] || d < 17) continue;
      const px = x + 0.2 + r() * 0.6, pz = z + 0.2 + r() * 0.6, g = this.groundY(4, px, pz), k = r();
      if (k < 0.07) {
        const rad = 0.15 + r() * 0.4, h = 0.6 + r() * 3.2;
        this.cones.push({ x: px, y: g - 0.05, z: pz, r: rad, h, t: T_ENV });
        if (rad > 0.24) this.addObstacle(F, px, pz, rad * 0.75);
      } else if (k < 0.09 && this.freeCell(F, x, z)) {
        const rad = 0.5 + r() * 0.7;
        this.blobs.push({ x: px, y: g + rad * 0.4, z: pz, r: rad, s: Math.floor(r() * 1e6) });
        this.addObstacle(F, px, pz, rad * 0.8);
      }
    }
    const aisles = [r() * 6.283, 0, 0].map((a, k, arr) => arr[0] + k * 2.094 + (k ? r() * 0.5 - 0.25 : 0));
    this.ringSlots = [];
    for (const rad of [4.6, 6.9, 9.2, 11.5, 13.8, 16.1]) {
      const n = Math.floor((6.283 * rad) / 1.45), off = r() * 6.283;
      for (let k = 0; k < n; k++) {
        const a = off + (k / n) * 6.283;
        if (aisles.some((q) => Math.abs(Math.atan2(Math.sin(a - q), Math.cos(a - q))) < 1.25 / rad + 0.05)) continue;
        if (r() < 0.2) continue;
        const x = C + Math.cos(a) * rad, z = C + Math.sin(a) * rad;
        const yaw = Math.atan2(x - C, z - C) + (r() - 0.5) * 0.16;
        this.statues.push({ f: 4, x, z, yaw, scale: 0.92 + r() * 0.16, pose: r() < 0.22 ? 1 : 0 });
        this.addObstacle(F, x, z, 0.26);
        if (rad > 9) this.ringSlots.push({ x, z, yaw });
      }
    }
    const g = F.y;
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * 6.283;
      this.box(C + Math.cos(a) * 2.25, g + 0.11, C + Math.sin(a) * 2.25, 0.72, 0.22, 0.3, -a + Math.PI / 2, T_GOAL);
    }
  }

  verify(F) {
    const reach = (useBlock) => {
      const A = this.arrivals[F.f], seen = new Uint8Array(N * N), s = Math.floor(A.z) * N + Math.floor(A.x), q = [s];
      seen[s] = 1;
      for (let h = 0; h < q.length; h++) {
        const i = q[h], x = i % N, z = (i / N) | 0;
        for (let d = 0; d < 4; d++) {
          const nx = x + DX[d], nz = z + DZ[d], ni = nz * N + nx;
          if (nx < 0 || nz < 0 || nx >= N || nz >= N || seen[ni] || F.cells[ni] !== OPEN || (useBlock && F.block[ni])) continue;
          seen[ni] = 1;
          q.push(ni);
        }
      }
      const T = F.f < 4 ? this.exits[F.f] : this.goal;
      return seen[Math.floor(T.z) * N + Math.floor(T.x - (F.f < 4 ? 0 : 0.5))] === 1;
    };
    if (reach(true)) return true;
    if (!reach(false)) return false;
    F.block.fill(0);
    this.boxes = this.boxes.filter((b) => b.y > F.y + F.theme.ceil + 1 || b.y < F.y - 0.5 || b.t !== T_ENV);
    return true;
  }

  placeMonsters() {
    const r = this.rnd, counts = [1, 1, 1, 2, 1];
    for (let f = 0; f < 5; f++) for (let k = 0; k < counts[f]; k++) {
      if (f === 4 && this.ringSlots.length) {
        const s = this.ringSlots[Math.floor(r() * this.ringSlots.length)];
        this.statues = this.statues.filter((q) => q.f !== 4 || q.x !== s.x || q.z !== s.z);
        this.monsterSpawns.push({ f, x: s.x, z: s.z, yaw: s.yaw, id: this.monsterSpawns.length });
        continue;
      }
      const p = this.randomOpen(f, r, this.arrivals[f], 30);
      this.monsterSpawns.push({ f, x: p.x, z: p.z, yaw: r() * 6.283, id: this.monsterSpawns.length });
    }
  }
}
