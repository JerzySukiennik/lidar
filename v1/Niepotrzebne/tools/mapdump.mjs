// Dev tool: prints ASCII maps of every floor for a seed and checks generation speed.
import { World, N, SOLID, OPEN, RAMP } from '../../js/world.js';
const seed = Number(process.argv[2] || 12345), only = process.argv[3];
const t0 = performance.now();
const w = new World(seed);
console.log('gen ms', (performance.now() - t0).toFixed(0), 'boxes', w.boxes.length, 'cones', w.cones.length, 'blobs', w.blobs.length, 'statues', w.statues.length);
console.log('ramps', w.ramps.map((r) => `f${r.f} L${r.L} at ${r.ex},${r.ez} dir ${r.dx},${r.dz}`).join(' | '));
for (const F of w.floors) {
  if (only !== undefined && Number(only) !== F.f) continue;
  let open = 0;
  const rows = [];
  for (let z = 0; z < N; z++) {
    let s = '';
    for (let x = 0; x < N; x++) {
      const i = z * N + x, c = F.cells[i];
      if (c === OPEN) open++;
      const A = w.arrivals[F.f], E = w.exits[F.f];
      if (Math.floor(A.x) === x && Math.floor(A.z) === z) s += 'A';
      else if (E && Math.floor(E.x) === x && Math.floor(E.z) === z) s += 'E';
      else if (w.monsterSpawns.some((m) => m.f === F.f && Math.floor(m.x) === x && Math.floor(m.z) === z)) s += 'M';
      else if (w.statues.some((m) => m.f === F.f && Math.floor(m.x) === x && Math.floor(m.z) === z)) s += 's';
      else s += c === RAMP ? '=' : c === SOLID ? '#' : F.block[i] ? 'o' : F.corr[i] ? '.' : ' ';
    }
    rows.push(s);
  }
  console.log(`--- floor ${F.f} ${F.theme.key} open ${open}`);
  console.log(rows.join('\n'));
}
