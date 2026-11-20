// Dev snippet evaluated in the page: stages a readable scene (creature, a second operator, fresh scans) for a hero screenshot.
(async (scene) => {
  const g = window.__lidar.game, p = g.player, w = g.world, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  g.god = true;
  g.app.net.isHost = false;
  g.phantomT = g.now() + 1e6;
  for (const id of ['hint', 'mic', 'toast']) document.getElementById(id).style.display = 'none';
  const place = (f, x, z) => { p.f = f; p.x = x; p.z = z; p.y = w.groundY(f, x, z); };
  const burst = async (yaw, pitch, power = 1) => { p.yaw = yaw; p.pitch = pitch; g.charge = power; g.cool = 0; g.fireBurst(g.now()); await sleep(240); };
  const mon = (f, x, z) => { const m = g.pack.list.find((q) => q.f === f); m.x = m.tx = x; m.z = m.tz = z; m.state = 2; m.yaw = m.tyaw = Math.atan2(x - p.x, z - p.z); return m; };
  const operator = (f, x, z, yaw) => g.remote.set('demo', { id: 'demo', name: 'OP-204', x, y: w.groundY(f, x, z), z, yaw, tx: x, ty: w.groundY(f, x, z), tz: z, tyaw: yaw, phase: 1.1, step: 0, move: 0, caps: new Float32Array(70), f, gait: 0, scan: 1, mic: 0, alive: true, crouch: 0, t: Date.now() + 1e8 });
  const sight = (f) => {
    const F = w.floors[f];
    let best = null, bd = -1;
    for (let k = 0; k < 500; k++) {
      const i = F.open[(k * 7919) % F.open.length], x = (i % 72) + 0.5, z = ((i / 72) | 0) + 0.5;
      if (F.block[i] || F.keep[i]) continue;
      for (let a = 0; a < 16; a++) {
        const t = a * 0.3927, h = g.caster.cast(x, F.y + 1.6, z, -Math.sin(t), 0, -Math.cos(t), 60), d = h ? h.t : 60;
        const score = Math.min(d, 22) + (F.corr[i] ? 0 : 3);
        if (score > bd) { bd = score; best = { x, z, yaw: t, far: d }; }
      }
    }
    return best;
  };
  if (scene === 'bottom') {
    const G = w.goal;
    let spot = null;
    for (let a = 0; a < 6.28 && !spot; a += 0.2) {
      const x = G.x + Math.cos(a) * 12.5, z = G.z + Math.sin(a) * 12.5;
      if (w.walkable(4, Math.floor(x), Math.floor(z)) && !g.caster.cast(x, w.floors[4].y + 1.6, z, (G.x - x) / 12.5, 0, (G.z - z) / 12.5, 12)) spot = { x, z };
    }
    place(4, spot.x, spot.z);
    const yaw = Math.atan2(p.x - G.x, p.z - G.z);
    for (const pitch of [0.05, -0.16]) for (let k = -3; k <= 3; k++) await burst(yaw + k * 0.3, pitch);
    await burst(yaw, -0.05);
    p.yaw = yaw; p.pitch = -0.04;
  } else {
    const f = scene === 'hall' ? 1 : 0, S = sight(f);
    place(f, S.x, S.z);
    const fx = -Math.sin(S.yaw), fz = -Math.cos(S.yaw), rx = Math.cos(S.yaw), rz = -Math.sin(S.yaw), d = Math.min(S.far - 1.6, 8.5);
    mon(f, p.x + fx * d, p.z + fz * d);
    for (const side of [0.85, -0.85]) {
      const x = p.x + fx * 3.1 + rx * side, z = p.z + fz * 3.1 + rz * side;
      if (w.walkable(f, Math.floor(x), Math.floor(z))) { operator(f, x, z, S.yaw + (side > 0 ? 0.35 : -0.35)); break; }
    }
    await sleep(150);
    for (const [k, pitch] of [[-2.4, -0.2], [2.4, -0.2], [-1.5, 0.1], [1.5, 0.1], [-0.8, -0.3], [0.8, -0.3], [-0.4, 0.15], [0.4, 0.15], [0, -0.25]]) await burst(S.yaw + k, pitch);
    await burst(S.yaw, -0.03);
    p.yaw = S.yaw; p.pitch = -0.03;
  }
  await sleep(520);
  return scene + ' ' + g.app.cloud.count;
})
