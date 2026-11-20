// Dev tool: two real clients in the dev realm. Checks presence, host election, shared scans, blue traces, creature sync and the win/new-round flow.
import { createRequire } from 'node:module';
const require = createRequire('/Users/jurek/openclaw/node_modules/');
const { chromium } = require('playwright-core');

const TARGET = process.argv[2] || 'http://localhost:8641/?auto=1&play=1&realm=dev&dpr=1';
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const logs = [];
const open = async (tag) => {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 400 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${tag} ${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[${tag} pageerror] ${e.message}`));
  await page.goto(TARGET, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__lidar && window.__lidar.game.state === 'play', null, { timeout: 40000 });
  return page;
};
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); console.log(results[results.length - 1]); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const A = await open('A');
const B = await open('B');
await sleep(4000);
const info = (p) => p.evaluate(() => { const g = window.__lidar.game, n = g.app.net; return { online: n.online, host: n.isHost, id: n.id, seed: g.round.seed, n: g.round.n, remote: g.remote.size, pts: g.app.cloud.count, state: g.state, count: n.count() }; });
let a = await info(A), b = await info(B);
check('both online', a.online && b.online);
check('same round', a.seed === b.seed && a.n === b.n, `seed ${a.seed}`);
check('exactly one host', a.host !== b.host, `A ${a.host} B ${b.host}`);
check('see each other', a.remote === 1 && b.remote === 1, `count ${a.count}/${b.count}`);

await A.evaluate(() => { const g = window.__lidar.game; g.god = true; g.player.yaw += 0.5; });
await B.evaluate(() => { const g = window.__lidar.game; g.god = true; g.player.x += 2.2; g.player.z += 0.5; });
await sleep(1200);
const before = (await info(B)).pts;
await A.evaluate(() => { const g = window.__lidar.game; g.charge = 1; g.fireBurst(g.now()); });
await sleep(2500);
const afterBurst = (await info(B)).pts;
check('burst replicated', afterBurst - before > 5000, `+${afterBurst - before} points on B`);
await A.evaluate(() => { window.__lidar.game.mouse.l = true; });
await sleep(1500);
await A.evaluate(() => { window.__lidar.game.mouse.l = false; });
await sleep(700);
const afterStream = (await info(B)).pts;
check('stream replicated', afterStream - afterBurst > 300, `+${afterStream - afterBurst} points on B`);

const blue = await A.evaluate(async () => {
  const g = window.__lidar.game, p = g.player, R = [...g.remote.values()][0], c = g.app.cloud;
  p.yaw = Math.atan2(p.x - R.x, p.z - R.z); p.pitch = -0.1;
  const start = c.count;
  g.charge = 0.6; g.fireBurst(g.now());
  await new Promise((r) => setTimeout(r, 900));
  let n = 0;
  for (let i = start; i < c.count; i++) if (c.info[(i % c.cap) * 4 + 1] === 1) n++;
  return { n, d: Math.hypot(p.x - R.x, p.z - R.z).toFixed(1) };
});
check('other player shows as blue trace', blue.n > 30, `${blue.n} blue dots at ${blue.d} m`);
await A.screenshot({ path: '/Users/jurek/Downloads/Claude/Projects/LiDAR Point Cloud 001/Niepotrzebne/shots/mp-a.png' });

const mons = async (p) => p.evaluate(() => window.__lidar.game.pack.list.slice(0, 2).map((m) => [m.f, +m.x.toFixed(1), +m.z.toFixed(1), m.state]));
const hostPage = (await info(A)).host ? A : B, guest = hostPage === A ? B : A;
await hostPage.evaluate(() => { const g = window.__lidar.game, m = g.pack.list[0]; g.pack.noise(0, g.player.x, g.player.z, 60, 'x', g.now()); g.pack.noise(0, g.player.x, g.player.z, 60, 'x', g.now()); });
await sleep(3000);
const mh = await mons(hostPage), mg = await mons(guest);
check('creature synced to guest', Math.hypot(mh[0][1] - mg[0][1], mh[0][2] - mg[0][2]) < 2.5 && mh[0][3] === mg[0][3], `host ${JSON.stringify(mh[0])} guest ${JSON.stringify(mg[0])}`);

await guest.evaluate(() => { const g = window.__lidar.game, w = g.world; g.player.f = 4; g.player.x = w.goal.x; g.player.z = w.goal.z; g.player.y = w.groundY(4, w.goal.x, w.goal.z); });
await sleep(2500);
a = await info(A); b = await info(B);
check('win seen by both', a.state === 'won' && b.state === 'won', `${a.state}/${b.state}`);
const oldSeed = a.seed;
await sleep(11500);
a = await info(A); b = await info(B);
check('new round for both', a.seed === b.seed && a.seed !== oldSeed && a.state === 'play' && b.state === 'play', `seed ${a.seed} states ${a.state}/${b.state}`);
console.log(logs.slice(0, 12).join('\n'));
await browser.close();
