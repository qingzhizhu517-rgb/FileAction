// @vitest-environment node
import { afterAll, beforeAll, expect, it } from "vitest";
import { createServer, type ViteDevServer } from "vite";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { introPage } from "../../../introPlugin";

// 合成字节只验证媒体 HTTP 传输，不冒充可播放视频。
const fixture = Buffer.from("synthetic-video-http-fixture-0123456789abcdefghijklmnopqrstuvwxyz");
let directory: string;
let server: ViteDevServer;
let origin: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "fileaction-video-test-"));
  await writeFile(join(directory, "project-video.mp4"), fixture);
  await writeFile(join(directory, "private.md"), "private fixture");
  await symlink(join(directory, "private.md"), join(directory, "linked.mp4"));
  server = await createServer({
    root: directory, configFile: false, cacheDir: join(directory, "cache"),
    plugins: [introPage(directory)], logLevel: "silent",
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  const address = server.httpServer!.address();
  if (!address || typeof address === "string") throw new Error("未监听");
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await server?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
it("视频 GET 返回原始字节，HEAD 返回相同长度且不发送正文", async () => {
  const full = await fetch(origin + "/intro/project-video.mp4");
  expect(full.status).toBe(200);
  expect(full.headers.get("content-type")).toBe("video/mp4");
  expect(full.headers.get("accept-ranges")).toBe("bytes");
  expect(Buffer.from(await full.arrayBuffer())).toEqual(fixture);
  const head = await fetch(origin + "/intro/project-video.mp4", { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(head.headers.get("content-length")).toBe(String(fixture.length));
  expect(await head.text()).toBe("");
});
it.each([
  ["bytes=0-15", 0, 15],
  ["bytes=10-", 10, fixture.length - 1],
  ["bytes=-8", fixture.length - 8, fixture.length - 1],
  ["bytes=0-99999", 0, fixture.length - 1],
]) ("进度拖动分段请求 %s 返回正确字节", async (range, start, end) => {
  const response = await fetch(origin + "/intro/project-video.mp4", { headers: { Range: range } });
  expect(response.status).toBe(206);
  expect(response.headers.get("content-range")).toBe(`bytes ${start}-${end}/${fixture.length}`);
  expect(response.headers.get("content-length")).toBe(String(end - start + 1));
  expect(Buffer.from(await response.arrayBuffer())).toEqual(fixture.subarray(start, end + 1));
});
it.each(["bytes=99999-", "bytes=20-10", "bytes=-0", "bytes=bad", "bytes=0-1,4-5"])("无效分段 %s 明确返回416", async (range) => {
  const response = await fetch(origin + "/intro/project-video.mp4", { headers: { Range: range } });
  expect(response.status).toBe(416);
  expect(response.headers.get("content-range")).toBe(`bytes */${fixture.length}`);
  expect(await response.text()).toBe("");
});
it("缺失视频与符号链接不可读取", async () => {
  for (const path of ["missing.mp4", "linked.mp4", "%2e%2e%2fprivate.md"])
    expect((await fetch(origin + "/intro/" + path)).status).toBe(404);
  expect((await fetch(origin + "/intro/project-video.mp4", { method: "POST" })).status).toBe(405);
});
