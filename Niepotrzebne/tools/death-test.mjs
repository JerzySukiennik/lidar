// Dev tool: solo run where the creature is pulled next to the player. Captures the catch, the blackout and the respawn.
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
const require = createRequire(process.env.PLAYWRIGHT_MODULES || `${homedir()}/openclaw/node_modules/`);
const { chromium } = require('playwright-core');
const OUT = decodeURIComponent(new URL('../shots/', import.meta.url).pathname);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 620 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push('pageerror ' + e.message));
await page.goto('http://localhost:8641/?solo=1&auto=1&play=1&seed=5&dpr=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__lidar && window.__lidar.game.state === 'play', null, { timeout: 40000 });
await page.waitForTimeout(800);
const setup = await page.evaluate(() => {
  const g = window.__lidar.game, p = g.player, w = g.world, m = g.pack.list[0];
  g.charge = 1; g.fireBurst(g.now());
  let best = null, bd = 1e9;
  for (const i of w.floors[0].open) {
    const x = (i % 72) + 0.5, z = ((i / 72) | 0) + 0.5, d = Math.hypot(x - p.x, z - p.z);
    if (Math.abs(d - 9) < bd && w.lineClear(0, x, z, p.x, p.z)) { bd = Math.abs(d - 9); best = { x, z }; }
  }
  m.x = best.x; m.z = best.z; m.tx = m.x; m.tz = m.z;
  p.yaw = Math.atan2(p.x - m.x, p.z - m.z);
  g.pack.noise(0, p.x, p.z, 60, 'me', g.now()); g.pack.noise(0, p.x, p.z, 60, 'me', g.now());
  return { d: Math.hypot(m.x - p.x, m.z - p.z), sounds: Object.keys(g.app.sound.buf).length, ctx: g.app.sound.ctx.state };
});
console.log('setup', JSON.stringify(setup));
await page.waitForTimeout(700);
await page.evaluate(() => { const g = window.__lidar.game; g.charge = 0.7; g.fireBurst(g.now()); });
await page.waitForTimeout(450);
await page.screenshot({ path: OUT + 'hunt.png' });
await page.waitForFunction(() => window.__lidar.game.state === 'dead', null, { timeout: 15000 });
await page.waitForTimeout(350);
await page.screenshot({ path: OUT + 'scare.png' });
await page.waitForTimeout(1600);
await page.screenshot({ path: OUT + 'lost.png' });
await page.waitForFunction(() => window.__lidar.game.state === 'play', null, { timeout: 8000 });
const end = await page.evaluate(() => { const g = window.__lidar.game, w = g.world; return { state: g.state, atSpawn: Math.hypot(g.player.x - w.spawn.x, g.player.z - w.spawn.z) < 0.1, monster: g.pack.list[0].state, fps: Math.round(1000 / (window.__lidar.app.renderer.info.render.frame ? 16 : 16)) }; });
console.log('end', JSON.stringify(end));
console.log(logs.slice(0, 8).join('\n'));
await browser.close();
