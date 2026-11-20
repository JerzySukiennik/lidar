// Dev snippet evaluated in the page: teleports to a floor, scans around and looks down the longest sightline.
(async (f, mode) => {
  const g = window.__lidar.game, p = g.player, w = g.world;
  g.god = true;
  const F = w.floors[f];
  let best = null;
  if (mode === 'arrive') best = { x: w.arrivals[f].x, z: w.arrivals[f].z };
  else if (mode === 'exit') best = { x: w.exits[f].x, z: w.exits[f].z };
  else if (mode === 'goal') best = { x: w.goal.x + 9, z: w.goal.z + 3 };
  else {
    let bd = -1;
    for (let k = 0; k < 400; k++) {
      const i = F.open[(k * 7919) % F.open.length], x = (i % 72) + 0.5, z = ((i / 72) | 0) + 0.5;
      if (F.block[i]) continue;
      let far = 0;
      for (let a = 0; a < 8; a++) { const h = g.caster.cast(x, F.y + 1.6, z, Math.cos(a * 0.785), 0, Math.sin(a * 0.785), 60); far = Math.max(far, h ? h.t : 60); }
      if (far > bd) { bd = far; best = { x, z }; }
    }
  }
  p.x = best.x; p.z = best.z; p.f = f; p.y = w.groundY(f, p.x, p.z);
  let yaw = 0, far = 0;
  for (let a = 0; a < 32; a++) { const t = a * 0.19635, h = g.caster.cast(p.x, p.y + 1.6, p.z, -Math.sin(t), 0, -Math.cos(t), 60), d = h ? h.t : 60; if (d > far) { far = d; yaw = t; } }
  for (let k = 0; k < 10; k++) {
    p.yaw = yaw + k * 0.63; p.pitch = k % 2 ? -0.35 : 0.12;
    g.charge = 1; g.fireBurst(g.now());
    await new Promise((r) => setTimeout(r, 120));
  }
  p.yaw = yaw + (mode === 'goal' ? Math.PI : 0); p.pitch = -0.06;
  if (mode === 'goal') p.yaw = Math.atan2(p.x - w.goal.x, p.z - w.goal.z);
  g.charge = 1; g.fireBurst(g.now());
  await new Promise((r) => setTimeout(r, 900));
  return JSON.stringify({ f, far: far.toFixed(1), pts: g.app.cloud.count });
})
