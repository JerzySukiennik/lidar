// LiDAR Point Cloud 001: the point cloud (GPU ring buffer where age and type decide colour) and the scanner beams.

import * as THREE from 'three';

export const T_LIVE_BLUE = 5, T_LIVE_RED = 6, T_FACE = 7;

const VERT = /* glsl */ `
attribute vec4 aInfo;
uniform float uTime, uScale, uMaxPx, uMinPx, uEnvLife, uEnvFloor, uGlitch, uFade;
uniform vec4 uMon[3];
varying vec4 vCol;
float hash(float n) { return fract(sin(n) * 43758.5453123); }
void main() {
  float age = uTime - aInfo.x, type = aInfo.y, rnd = aInfo.z;
  vec3 p = position;
  float shake = uGlitch, env = (type < 0.5 || (type > 2.5 && type < 4.5)) ? 0.55 : 0.0;
  for (int i = 0; i < 3; i++) shake += env * uMon[i].w * smoothstep(6.5, 1.0, distance(p, uMon[i].xyz));
  if (shake > 0.001) {
    float tt = floor(uTime * 24.0);
    p += (vec3(hash(rnd * 91.7 + tt), hash(rnd * 37.3 + tt * 1.3), hash(rnd * 17.1 + tt * 1.7)) - 0.5) * shake * 0.24;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = max(-mv.z, 0.05), a, big = 1.0;
  vec3 col;
  if (type < 0.5 || (type > 2.5 && type < 4.5)) {
    col = type < 0.5 ? vec3(0.82, 0.91, 1.0) : (type < 3.5 ? vec3(0.12, 1.0, 0.42) : vec3(1.0, 0.8, 0.2));
    a = 1.35 * mix(uEnvFloor, 1.0, exp(-age / 16.0)) + exp(-age * 5.0) * 1.4;
    a *= 1.0 - smoothstep(uEnvLife * 0.7, uEnvLife, age);
    a *= aInfo.w * (type > 2.5 ? 1.3 : 1.0);
  } else if (type < 1.5) {
    col = vec3(0.1, 0.42, 1.0);
    a = 1.7 * (1.0 - smoothstep(1.2, 3.4, age));
    big = 1.25;
  } else if (type < 2.5) {
    col = vec3(1.0, 0.03, 0.015);
    a = 1.7 * (1.0 - smoothstep(0.9, 2.8, age));
    big = 1.35;
  } else {
    col = type < 5.5 ? vec3(0.04, 0.3, 1.0) : vec3(1.0, 0.03, 0.015);
    a = mix(0.8, 1.7, uFade) * (1.0 - smoothstep(0.04, 0.2, age));
    big = mix(1.5, 1.3, uFade);
    if (type > 6.5) { big = 0.3; a = 2.4 * (1.0 - smoothstep(0.03, 0.09, age)); }
  }
  a *= 0.75 + 0.5 * rnd;
  a *= mix(1.0, mix(1.0, 0.5, smoothstep(8.0, 60.0, d)), uFade);
  float px = uScale * big * (0.85 + 0.3 * rnd) / d;
  if (px < uMinPx) { a *= mix(1.0, max(px / uMinPx, 0.5), uFade); px = uMinPx; }
  gl_PointSize = min(px, uMaxPx);
  if (age < 0.0 || a < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vCol = vec4(col, a);
}`;

const FRAG = /* glsl */ `
varying vec4 vCol;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float k = 1.0 - dot(c, c) * 4.0;
  if (k <= 0.0) discard;
  gl_FragColor = vec4(vCol.rgb * vCol.a * smoothstep(0.0, 0.55, k), 1.0);
}`;

export class Cloud {
  constructor(capacity = 900000) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.info = new Float32Array(capacity * 4);
    this.head = 0;
    this.pending = 0;
    this.count = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aInfo = new THREE.BufferAttribute(this.info, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aInfo', this.aInfo);
    this.uniforms = {
      uTime: { value: 0 }, uScale: { value: 20 }, uMaxPx: { value: 16 }, uMinPx: { value: 1.3 },
      uEnvLife: { value: 300 }, uEnvFloor: { value: 0.62 }, uGlitch: { value: 0 }, uFade: { value: 1 },
      uMon: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.clear();
  }

  clear() {
    for (let i = 0; i < this.cap; i++) this.info[i * 4] = 1e9;
    this.head = 0;
    this.pending = 0;
    this.count = 0;
    this.aPos.clearUpdateRanges();
    this.aInfo.clearUpdateRanges();
    this.aPos.needsUpdate = true;
    this.aInfo.needsUpdate = true;
    this.full = true;
  }

  purge(type) {
    for (let i = 0; i < this.cap; i++) if (this.info[i * 4 + 1] === type) this.info[i * 4] = 1e9;
    this.pending = this.cap;
  }

  add(x, y, z, type, time, shade = 1) {
    const i = this.head, k = i * 3, q = i * 4;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.info[q] = time; this.info[q + 1] = type; this.info[q + 2] = Math.random(); this.info[q + 3] = shade;
    this.head = (i + 1) % this.cap;
    this.pending++;
    this.count++;
  }

  flush() {
    if (this.full) { this.full = false; this.pending = 0; return; }
    if (!this.pending) return;
    if (this.pending >= this.cap) {
      this.aPos.clearUpdateRanges();
      this.aInfo.clearUpdateRanges();
    } else {
      const start = (this.head - this.pending + this.cap) % this.cap, first = Math.min(this.pending, this.cap - start);
      this.aPos.addUpdateRange(start * 3, first * 3);
      this.aInfo.addUpdateRange(start * 4, first * 4);
      if (first < this.pending) {
        this.aPos.addUpdateRange(0, (this.pending - first) * 3);
        this.aInfo.addUpdateRange(0, (this.pending - first) * 4);
      }
    }
    this.aPos.needsUpdate = true;
    this.aInfo.needsUpdate = true;
    this.pending = 0;
  }

  resize(heightPx, fov, dpr, size = 0.013, minPx = 0) {
    this.uniforms.uScale.value = (size * heightPx) / (2 * Math.tan((fov * Math.PI) / 360));
    this.uniforms.uMaxPx.value = 5.5 * dpr;
    this.uniforms.uMinPx.value = minPx || 0.6 * dpr + 0.55;
  }
}

export class Beams {
  constructor(capacity = 700) {
    this.cap = capacity;
    this.list = [];
    this.pos = new Float32Array(capacity * 6);
    this.col = new Float32Array(capacity * 6);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('color', this.aCol);
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.lines.frustumCulled = false;
    g.setDrawRange(0, 0);
  }

  add(ox, oy, oz, x, y, z, kind, now, own) {
    if (this.list.length >= this.cap) return;
    this.list.push({ ox, oy, oz, x, y, z, kind, t: now, own });
  }

  update(now, muzzle) {
    const L = this.list;
    let n = 0;
    for (let i = 0; i < L.length; i++) {
      const b = L[i], age = now - b.t;
      if (age > 0.07 || age < 0) continue;
      L[n] = b;
      const k = n * 6, f = (1 - age / 0.07) * (b.own ? 0.3 : 0.2);
      this.pos[k] = b.own ? muzzle.x : b.ox; this.pos[k + 1] = b.own ? muzzle.y : b.oy; this.pos[k + 2] = b.own ? muzzle.z : b.oz;
      this.pos[k + 3] = b.x; this.pos[k + 4] = b.y; this.pos[k + 5] = b.z;
      const r = b.kind === 2 ? 1 : b.kind === 1 ? 0.25 : 0.55, g = b.kind === 2 ? 0.1 : b.kind === 1 ? 0.5 : 0.75, bl = b.kind === 2 ? 0.08 : 1;
      this.col[k] = r * f * 0.2; this.col[k + 1] = g * f * 0.2; this.col[k + 2] = bl * f * 0.2;
      this.col[k + 3] = r * f; this.col[k + 4] = g * f; this.col[k + 5] = bl * f;
      n++;
    }
    L.length = n;
    this.lines.geometry.setDrawRange(0, n * 2);
    if (n) { this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; }
  }

  clear() {
    this.list.length = 0;
    this.lines.geometry.setDrawRange(0, 0);
  }
}
