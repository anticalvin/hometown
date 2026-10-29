// Smoke test: bitmap pass is active by default and F8 disables it.
import { chromium } from 'playwright-core';

let browser;
try { browser = await chromium.launch({ channel: 'msedge', headless: true }); }
catch { browser = await chromium.launch({ channel: 'chrome', headless: true }); }

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => { if (!/pointer lock/.test(e.message)) errors.push(e.message); });

await page.goto('http://localhost:8080', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__debug, null, { timeout: 15000 });
await page.click('#playbtn');
await page.waitForTimeout(800);

const st = () => page.evaluate(() => {
  const b = window.__debug.bitmapPass;
  return { on: b.enabled, preset: b.presetName, cell: b.uniforms.uCell.value };
});
const a = await st();
await page.keyboard.press('F8');
const b = await st();
await page.screenshot({ path: 'test/bitmap-off.png' });
await page.keyboard.press('F8');
await page.screenshot({ path: 'test/bitmap-on.png' });
console.log('default', a, 'after F8', b, 'errors', errors);
const ok = a.on && a.preset === 'tiny' && !b.on && errors.length === 0;
console.log(ok ? 'PASS' : 'FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
