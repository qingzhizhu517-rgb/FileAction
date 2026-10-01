// 逐帧渲染：用无头 Chromium 打开 index.html，按 1/fps 步进调用 render(t) 并截图。
// 用法：node capture.mjs [--preview t1,t2,...] [--workers N]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
// 复用本机已安装的 playwright-core，不新增依赖
const { chromium } = require(process.env.PW_CORE || `${process.env.HOME}/.npm-global/lib/node_modules/openclaw/node_modules/playwright-core`);

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const tl = JSON.parse(readFileSync(join(root, 'build/timeline.json'), 'utf8'));
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const preview = opt('--preview');
const workers = Number(opt('--workers') || 6);
const url = pathToFileURL(join(here, 'index.html')).href + '?capture=1';

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(url);
  await page.waitForFunction(() => window.READY === true);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

const browser = await chromium.launch();
if (preview) {
  const out = join(root, 'build/preview'); mkdirSync(out, { recursive: true });
  const page = await openPage(browser);
  for (const t of preview.split(',').map(Number)) {
    await page.evaluate(x => window.render(x), t);
    await page.screenshot({ path: join(out, `t${String(t).padStart(6, '0')}.png`) });
  }
  console.log('预览已输出到', out);
} else {
  const out = join(root, 'build/frames'); mkdirSync(out, { recursive: true });
  const total = Math.ceil(tl.total * tl.fps);
  let next = 0, done = 0; const t0 = Date.now();
  await Promise.all(Array.from({ length: workers }, async () => {
    const page = await openPage(browser);
    while (next < total) {
      const i = next++;
      await page.evaluate(x => window.render(x), i / tl.fps);
      await page.screenshot({ path: join(out, `f${String(i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
      if (++done % 300 === 0) console.log(`${done}/${total} 帧，${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }));
  console.log(`完成 ${total} 帧，用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await browser.close();
