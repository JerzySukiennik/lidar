// LiDAR Point Cloud 001: boot, title-to-game hand-off, input, readouts and the render loop.

import * as THREE from 'three';
import { Cloud, Beams } from './cloud.js';
import { Sound } from './audio.js';
import { Net } from './net.js';
import { Title } from './title.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const auto = params.has('auto');
const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const canvas = $('view');

const ui = {
  hud(on) { $('hud').hidden = !on; },
  hint(on) {
    $('hint').classList.toggle('on', on);
    if (on) setTimeout(() => $('hint').classList.remove('on'), 11000);
  },
  toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.toggle('on', !!text);
    clearTimeout(ui.toastT);
    if (text) ui.toastT = setTimeout(() => t.classList.remove('on'), 5000);
  },
  level(f, label) {
    const el = $('level');
    el.firstElementChild.textContent = `LEVEL 0${f + 1} — ${label}`;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1800);
  },
  depth(m) {
    const s = `DEPTH ${m.toFixed(1).padStart(4, '0')} M`;
    if (s !== ui.depthS) { ui.depthS = s; $('level').lastElementChild.textContent = s; }
  },
  charge(v) {
    if (v === ui.chargeV) return;
    ui.chargeV = v;
    $('cross').querySelector('circle').style.strokeDashoffset = String(106.8 * (1 - v));
  },
  mic(on, level) {
    const el = $('mic');
    if (on !== ui.micOn) { ui.micOn = on; el.classList.toggle('off', !on); el.firstElementChild.textContent = on ? 'MIC' : 'MIC OFF'; }
    if (on) el.querySelector('em').style.width = `${Math.round(level * 100)}%`;
  },
  dead(on) { $('dead').classList.toggle('on', on); },
  win(name, me) {
    $('win').classList.toggle('on', !!name);
    if (name) $('win').firstElementChild.textContent = me ? 'YOU REACHED THE BOTTOM' : `${name} REACHED THE BOTTOM`;
  },
  winCount(n) {
    const s = n > 0 ? `NEW SCAN IN ${n}` : 'SCANNING';
    if (s !== ui.winS) { ui.winS = s; $('win').lastElementChild.textContent = s; }
  },
  pause(on) { $('pause').classList.toggle('on', on); },
  online(n) { $('online').textContent = n > 1 ? `${n} IN THE DARK` : n === 1 ? '1 IN THE DARK' : 'NOBODY IN THE DARK'; },
};

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 1);
const app = {
  renderer, params, ui, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(60, 1, 0.04, 300),
  cloud: new Cloud(), beams: new Beams(), sound: new Sound(), width: 1, height: 1, dpr: 1,
};
app.scene.add(app.cloud.points, app.beams.lines);
app.net = new Net(params.get('realm') || (local ? 'dev' : 'main'), params.has('solo'));
const title = new Title(app), game = new Game(app);
let cap = Number(params.get('dpr')) || 1.5, slow = 0, ema = 16;

function resize() {
  const w = innerWidth || 1, h = innerHeight || 1;
  app.dpr = Math.min(devicePixelRatio || 1, cap);
  renderer.setPixelRatio(app.dpr);
  renderer.setSize(w, h, false);
  app.width = w * app.dpr;
  app.height = h * app.dpr;
  app.camera.aspect = w / h;
  app.camera.updateProjectionMatrix();
  if (title.active) title.resize(); else if (game.state !== 'idle') game.resize();
}
addEventListener('resize', resize);

const stored = (() => { try { return localStorage.getItem('lidar001.name'); } catch (e) { return null; } })();
const nameEl = $('name');
nameEl.value = stored || `OP-${100 + Math.floor(Math.random() * 900)}`;
const cleanName = () => (nameEl.value.toUpperCase().replace(/[^A-Z0-9 _-]/g, '').trim().slice(0, 10) || 'OPERATOR');
nameEl.addEventListener('change', () => { nameEl.value = cleanName(); try { localStorage.setItem('lidar001.name', nameEl.value); } catch (e) { nameEl.blur(); } });
if (!matchMedia('(pointer: fine)').matches) $('note').textContent = 'KEYBOARD AND MOUSE REQUIRED';

app.sound.init();
const soundsReady = app.sound.load('assets/audio');
const netReady = app.net.connect().then(() => ui.online(app.net.count()));
app.net.on.count = () => ui.online(app.net.count());

const locked = () => document.pointerLockElement === canvas;
const lock = () => { if (!auto && canvas.requestPointerLock) { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let starting = false;

async function begin() {
  if (starting) return;
  starting = true;
  const btn = $('play');
  btn.disabled = true;
  btn.lastElementChild.textContent = 'CONNECTING';
  app.sound.resume();
  const mic = auto ? Promise.resolve(false) : Promise.race([app.sound.mic(), wait(20000)]);
  await Promise.all([netReady, Promise.race([soundsReady, wait(7000)]), mic]);
  document.body.classList.add('leaving');
  await wait(750);
  title.stop();
  game.enter(cleanName());
  resize();
  document.body.classList.add('playing');
  document.body.classList.remove('leaving');
  if (!auto) { lock(); await wait(250); ui.pause(!locked()); }
}
$('play').addEventListener('click', begin);
$('pause').addEventListener('click', lock);
canvas.addEventListener('click', () => { if (game.state !== 'idle' && !locked()) lock(); });
document.addEventListener('pointerlockchange', () => {
  if (game.state !== 'idle' && !auto) ui.pause(!locked());
  if (locked()) $('pause').firstElementChild.textContent = 'CLICK TO RETURN'; else release();
});

function release() {
  game.keys.clear();
  game.mouse.l = false;
  game.mouse.r = false;
}
addEventListener('blur', release);
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('mousedown', (e) => { if (game.state !== 'idle' && (locked() || auto)) { game.button(e.button, true); e.preventDefault(); } });
document.addEventListener('mouseup', (e) => game.button(e.button, false));
document.addEventListener('mousemove', (e) => { if (locked()) game.look(e.movementX, e.movementY); });
document.addEventListener('wheel', (e) => { if (game.state !== 'idle') game.wheel(e.deltaY); }, { passive: true });
addEventListener('keydown', (e) => {
  if (game.state === 'idle' || e.target === nameEl) return;
  game.key(e.code, true);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => game.key(e.code, false));

resize();
title.start();
document.body.classList.add('ready');

let last = performance.now();
function loop(t) {
  requestAnimationFrame(loop);
  const raw = (t - last) / 1000, dt = Math.min(0.05, Math.max(0.001, raw));
  last = t;
  if (title.active) title.frame(dt);
  else if (game.state !== 'idle') {
    game.frame(dt);
    app.sound.micTick(dt);
    ema += (raw * 1000 - ema) * 0.05;
    slow = ema > 21 ? slow + raw : 0;
    if (slow > 2.5 && cap > 1) { cap = Math.max(1, cap - 0.25); slow = 0; ema = 16; resize(); }
  }
  app.cloud.flush();
  renderer.render(app.scene, app.camera);
}
requestAnimationFrame(loop);

window.__lidar = { app, game, title, begin };
window.__ready = true;
if (params.has('play')) begin();
