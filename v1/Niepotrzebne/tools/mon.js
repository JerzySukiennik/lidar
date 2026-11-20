// Dev snippet evaluated in the page: stands a few metres from the creature of a floor and scans it.
(async (f, dist) => {
  const g = window.__lidar.game, p = g.player, w = g.world;
  g.god = true;
  const m = g.pack.list.find((q) => q.f === f);
  let best = null, bd = 1e9;
  for (const i of w.floors[f].open) {
    const x = (i % 72) + 0.5, z = ((i / 72) | 0) + 0.5, d = Math.hypot(x - m.x, z - m.z);
    if (Math.abs(d - dist) < bd && w.lineClear(f, x, z, m.x, m.z)) { bd = Math.abs(d - dist); best = { x, z }; }
  }
  p.x = best.x; p.z = best.z; p.f = f; p.y = w.groundY(f, p.x, p.z);
  p.yaw = Math.atan2(p.x - m.x, p.z - m.z); p.pitch = 0.02;
  g.app.net.isHost = false;
  await new Promise((r) => setTimeout(r, 200));
  g.charge = 1; g.fireBurst(g.now());
  await new Promise((r) => setTimeout(r, 300));
  g.mouse.l = true;
  await new Promise((r) => setTimeout(r, 500));
  return JSON.stringify({ f, d: Math.hypot(p.x - m.x, p.z - m.z).toFixed(1), state: m.state });
})
