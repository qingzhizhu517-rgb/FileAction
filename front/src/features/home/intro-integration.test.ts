// @vitest-environment node
import { afterAll, beforeAll, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { resolve, join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

let server: ViteDevServer;
let origin: string;
let cacheDirectory: string;
beforeAll(async () => {
  cacheDirectory = await mkdtemp(join(tmpdir(), "fileaction-intro-test-"));
  server = await createServer({
    root: resolve(import.meta.dirname, "../../.."),
    // 集成测试不能改写正在运行的预览服务的依赖缓存。
    cacheDir: cacheDirectory,
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  const address = server.httpServer!.address();
  if (!address || typeof address === "string")
    throw new Error("测试服务器未监听");
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await server?.close();
  if (cacheDirectory) await rm(cacheDirectory, { recursive: true, force: true });
});

it("根入口与旧首页地址只跳转到完整宣传首页，并保留查询参数", async () => {
  for (const path of [
    "/",
    "/index.html",
    "/?from=logo",
    "/index.html?from=logo",
  ]) {
    const response = await fetch(origin + path, { redirect: "manual" });
    expect(response.status, path).toBe(308);
    expect(response.headers.get("location"), path).toBe(
      "/intro/" + (path.includes("?") ? "?from=logo" : ""),
    );
  }
  const response = await fetch(origin + "/");
  const html = await response.text();
  for (const section of [
    "hero-title",
    "file-order",
    "opportunity-radar",
    "trusted-reuse",
    "closing",
  ])
    expect(html).toContain(`id="${section}"`);
  expect(html).not.toContain('src="/src/main.tsx"');
});

it("完整宣传页及脚本样式在 /intro/ 同源可用，CTA 连接真实产品", async () => {
  const redirect = await fetch(origin + "/intro", { redirect: "manual" });
  expect(redirect.status).toBe(308);
  expect(redirect.headers.get("location")).toBe("/intro/");
  const page = await fetch(origin + "/intro/");
  const html = await page.text();
  expect(page.headers.get("content-type")).toContain("text/html");
  expect(html).toContain('id="hero-title"');
  expect(html).toContain('id="opportunity-radar"');
  expect(html).toContain('href="/files"');
  expect(html).toContain('href="/intro/" aria-label="文启 FileAction 首页"');
  expect(html).not.toContain("../docs/");
  const resources = [
    ...html.matchAll(/(?:src|href)="([^"?#]+\.(?:css|js))"/g),
  ].map((match) => match[1]);
  expect(resources.length).toBeGreaterThan(10);
  for (const resource of resources) {
    const response = await fetch(`${origin}/intro/${resource}`);
    expect(response.status, resource).toBe(200);
    expect(response.headers.get("content-type"), resource).toContain(
      resource.endsWith("css") ? "text/css" : "javascript",
    );
  }
});

it("宣传资源请求不能越过目录，也不暴露仓库文档或以首页代替缺失脚本", async () => {
  for (const path of [
    "/intro/%2e%2e%2fAGENTS.md",
    "/intro/%2e%2e%5cAGENTS.md",
    "/intro/missing.js",
    "/intro/missing.svg",
    "/intro/可行动事务Agent-宣传页说明.md",
  ]) {
    const response = await fetch(origin + path);
    expect(response.status, path).toBe(404);
  }
});

it("品牌 SVG 可按图像读取，内容与指定品牌素材一致", async () => {
  const response = await fetch(origin + "/intro/wenqi-icon.svg");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("image/svg+xml");
  const source = await readFile(
    resolve(import.meta.dirname, "../../../../docs/01-产品方案/品牌素材/可行动事务Agent-文启图标.svg"),
    "utf8",
  );
  expect(await response.text()).toBe(source);
  const head = await fetch(origin + "/intro/wenqi-icon.svg", { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(head.headers.get("content-type")).toContain("image/svg+xml");
  expect(await head.text()).toBe("");
});

it("首页头部只保留品牌与上传入口，不展示流程导航或探索按钮", async () => {
  const html = await (await fetch(origin + "/intro/")).text();
  const header = html.match(/<header\b[\s\S]*?<\/header>/)![0];
  expect(header).toContain('aria-label="文启 FileAction 首页"');
  expect(header).toContain('href="/files"');
  for (const text of ["阅读重点", "与你有关", "继续行动", "进入产品", "打开导航"])
    expect(header).not.toContain(text);
  expect(html).not.toContain("探索文启");
  expect(html).not.toContain('class="announcement"');
});

it("看看如何理解指向项目视频，并提供按需加载的播放弹窗", async () => {
  const html = await (await fetch(origin + "/intro/")).text();
  expect(html).toMatch(/<a[^>]*href="project-video\.mp4"[^>]*id="open-project-video"/);
  expect(html).toContain('aria-controls="project-video-dialog"');
  expect(html).toContain('src="project-video.js"');
  expect(html).toContain('id="project-video-dialog"');
  const video = html.match(/<video\b[^>]*>/)?.[0];
  expect(video).toBeDefined();
  expect(video).toContain('preload="none"');
  expect(video).toContain("controls");
  expect(video).toContain("playsinline");
  expect(video).not.toMatch(/\ssrc=|autoplay/);
});
