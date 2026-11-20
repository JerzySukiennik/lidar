// LiDAR Point Cloud 001: seeded random numbers and value noise shared by every client.

export function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);

export function vnoise2(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = fade(x - xi), v = fade(y - yi);
  const a = hash3(xi, yi, s), b = hash3(xi + 1, yi, s);
  const c = hash3(xi, yi + 1, s), d = hash3(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function vnoise3(x, y, z, s) {
  const zi = Math.floor(z), w = fade(z - zi);
  const a = vnoise2(x, y, s + zi * 131), b = vnoise2(x, y, s + (zi + 1) * 131);
  return a + (b - a) * w;
}

export function fbm2(x, y, s) {
  return vnoise2(x, y, s) * 0.6 + vnoise2(x * 2.1, y * 2.1, s + 17) * 0.28 + vnoise2(x * 4.3, y * 4.3, s + 41) * 0.12;
}

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
