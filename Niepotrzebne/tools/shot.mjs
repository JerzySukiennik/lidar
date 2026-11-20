// Dev tool: headless Chrome (real GPU through ANGLE/Metal) screenshot and console capture.
// node shot.mjs <url> <out.png> [setupJS] [waitMs] [width] [height]
import { createRequire } from 'node:module';
const require = createRequire('/Users/jurek/openclaw/node_modules/');
const { chromium } = require('playwright-core');

const [url, out = 'shot.png', setup = '', wait = '1500', w = '960', h = '600'] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +(process.env.DPR || 1) });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`));
await page.goto(url, { waitUntil: 'load' });
try { await page.waitForFunction(() => document.title === 'ready' || window.__ready, null, { timeout: 30000 }); } catch (e) { logs.push('[harness] ready timeout'); }
const steps = setup ? setup.split('|||') : [];
for (let i = 0; i < Math.max(1, steps.length); i++) {
  if (steps[i]) {
    try { const r = await page.evaluate(steps[i]); if (r !== undefined) logs.push('[setup] ' + (typeof r === 'string' ? r : JSON.stringify(r))); } catch (e) { logs.push('[setup error] ' + e.message); }
  }
  await page.waitForTimeout(+wait);
  await page.screenshot({ path: steps.length > 1 ? out.replace('.png', `-${i}.png`) : out });
}
console.log(logs.slice(-40).join('\n'));
await browser.close();
