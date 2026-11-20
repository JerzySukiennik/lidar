// Dev tool: pure-logic test of the creature AI (no browser). A loud player gets hunted and caught, a silent one is lost.
import { World } from '../../js/world.js';
import { Pack, ROAM, STALK, LISTEN, HUNT, SEARCH } from '../../js/monster.js';
const NAMES = ['ROAM', 'STALK', 'LISTEN', 'HUNT', 'SEARCH', 'FEED', 'STATUE'];
function run(seed, f, behave, secs = 120) {
  const w = new World(seed), pack = new Pack(w), m = pack.list.find((q) => q.f === f);
  const A = w.arrivals[f], p = { id: 'p', f, x: A.x, z: A.z, alive: true };
  const log = [];
  pack.onState = (mm, a, b) => { if (mm === m) log.push(`${t.toFixed(1)}s ${NAMES[a]}>${NAMES[b]}`); };
  let t = 0, caught = -1, minD = 1e9;
  const start = Math.hypot(m.x - p.x, m.z - p.z);
  for (let i = 0; i < secs * 30; i++) {
    t = i / 30;
    behave(t, p, pack, m);
    pack.update(1 / 30, [p], t);
    const d = Math.hypot(m.x - p.x, m.z - p.z);
    minD = Math.min(minD, d);
    if (d < 0.95 && m.state !== 5 && m.state !== 6) { caught = t; break; }
  }
  return `seed ${seed} f${f} start ${start.toFixed(0)}m caught ${caught < 0 ? 'no' : caught.toFixed(1) + 's'} min ${minD.toFixed(1)}m :: ${log.slice(0, 9).join(' ')}`;
}
const loud = (t, p, pack) => { if (Math.round(t * 30) % 60 === 0) pack.noise(p.f, p.x, p.z, 50, 'p', t); if (Math.round(t * 30) % 10 === 0) pack.noise(p.f, p.x, p.z, 9, 'p', t); };
const oneBurst = (t, p, pack) => { if (Math.round(t * 30) === 30) pack.noise(p.f, p.x, p.z, 50, 'p', t); };
const walker = (t, p, pack) => { if (Math.round(t * 30) % 12 === 0) pack.noise(p.f, p.x, p.z, 6, 'p', t); };
const silent = () => {};
for (const s of [5, 77]) for (const f of [0, 2, 4]) console.log('LOUD   ', run(s, f, loud));
for (const s of [5, 77]) console.log('1 BURST', run(s, 0, oneBurst));
for (const s of [5, 77]) console.log('WALKING', run(s, 1, walker, 180));
console.log('SILENT ', run(5, 0, silent));
