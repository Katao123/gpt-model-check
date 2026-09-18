// Optional documentation-only renderer; Playwright is not a skill runtime dependency.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const moduleId = process.env.GPT_MODEL_CHECK_PLAYWRIGHT_MODULE;
const { chromium } = await import(moduleId ? pathToFileURL(path.resolve(moduleId)).href : 'playwright');
const output = new URL('../../assets/examples/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 920, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Documentation rendering is offline. No provider or host follow-up API is available.
  await page.route(/^https?:\/\//, route => route.abort());
  await page.goto(new URL('./gallery.html', import.meta.url).href);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('article').count(), 5);
  assert.equal(await page.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true);
  for (const state of ['match', 'mismatch', 'inconclusive', 'unsupported', 'error']) {
    const card = page.locator(`[data-state="${state}"]`);
    assert.match(await card.innerText(), /SIMULATED/);
    assert.match(await card.innerText(), /未发起检测/);
    assert.match(await card.innerText(), /输入 Token/);
    assert.equal(await card.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await card.screenshot({ path: fileURLToPath(new URL(`${state}.png`, output)) });
  }
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 375, height: 900 });
  assert.equal(await page.locator('article').evaluateAll(cards => cards.every(card => card.scrollWidth <= card.clientWidth)), true);
  console.log('Captured five complete examples; images loaded, labels present, and layouts fit at 920px and 375px.');
} finally {
  await browser.close();
}
