// 逐帧导出：无头 Chromium 打开 index.html?capture=1，按 1/30 秒调用 frame(t) 取画布 JPEG。
// 用法：node capture.mjs [--preview 3,12.5,40] [--workers 6]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
// 复用本机已安装的 playwright-core（与 06-讲解视频/src/capture.mjs 相同），不新增依赖
const { chromium } = require(process.env.PW_CORE || `${process.env.HOME}/.npm-global/lib/node_modules/openclaw/node_modules/playwright-core`);

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const preview = opt('--preview');
const workers = Number(opt('--workers') || 6);
const url = pathToFileURL(join(here, 'index.html')).href + '?capture=1';

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', e => { console.error('页面错误：', e.message); process.exitCode = 1; });
  await page.goto(url);
  await page.waitForFunction(() => window.READY === true);
  return page;
}
const save = (path, dataUrl) => writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));

const browser = await chromium.launch();
const probe = await openPage(browser);
const { FPS, TOTAL } = await probe.evaluate(() => window.META);
if (preview) {
  const out = join(root, 'build/preview'); mkdirSync(out, { recursive: true });
  for (const t of preview.split(',').map(Number)) save(join(out, `t${t.toFixed(2).padStart(6, '0')}.jpg`), await probe.evaluate(x => window.frame(x, 0.85), t));
  console.log('预览已输出到', out);
} else {
  const out = join(root, 'build/frames'); mkdirSync(out, { recursive: true });
  const total = Math.round(TOTAL * FPS);
  let next = 0, done = 0; const t0 = Date.now();
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const page = w ? await openPage(browser) : probe;
    while (next < total) {
      const i = next++;
      save(join(out, `f${String(i).padStart(5, '0')}.jpg`), await page.evaluate(x => window.frame(x, 0.93), i / FPS));
      if (++done % 300 === 0) console.log(`${done}/${total} 帧，${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }));
  console.log(`完成 ${total} 帧，用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await browser.close();
