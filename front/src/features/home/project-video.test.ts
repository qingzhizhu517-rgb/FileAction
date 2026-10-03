import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const html = readFileSync(resolve(import.meta.dirname, "../../../../frontend/index.html"), "utf8");
const script = readFileSync(resolve(import.meta.dirname, "../../../../frontend/project-video.js"), "utf8");
let trigger: HTMLAnchorElement;
let dialog: HTMLDialogElement;
let video: HTMLVideoElement;
let status: HTMLElement;
let retry: HTMLButtonElement;
beforeEach(() => {
  // DOM 单元测试替身：原生弹窗与媒体解码另用真实浏览器验证。
  document.body.innerHTML = html.match(/<a[^>]*id="open-project-video"[\s\S]*?<\/a>/)![0]
    + html.match(/<dialog id="project-video-dialog"[\s\S]*?<\/dialog>/)![0];
  trigger = document.querySelector("#open-project-video")!;
  dialog = document.querySelector("#project-video-dialog")!;
  video = document.querySelector("#project-video")!;
  status = document.querySelector("#project-video-status")!;
  retry = document.querySelector("#retry-project-video")!;
  dialog.showModal = vi.fn(() => { dialog.open = true; });
  dialog.close = vi.fn(() => { dialog.open = false; dialog.dispatchEvent(new Event("close")); });
  vi.spyOn(video, "play").mockResolvedValue();
  vi.spyOn(video, "pause").mockImplementation(() => {});
  vi.spyOn(video, "load").mockImplementation(() => {});
  new Function(script)();
});
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; document.body.className = ""; });
it("点击前不加载视频；点击打开弹窗并播放", () => {
  expect(video.hasAttribute("src")).toBe(false);
  expect(video.play).not.toHaveBeenCalled();
  trigger.click();
  expect(dialog.open).toBe(true);
  expect(video.getAttribute("src")).toBe("project-video.mp4");
  expect(video.play).toHaveBeenCalledOnce();
  expect(document.body).toHaveClass("project-video-open");
});
it("关闭停止媒体、释放加载并把焦点交还入口；再次打开可播放", () => {
  trigger.focus(); trigger.click();
  document.querySelector<HTMLButtonElement>("#close-project-video")!.click();
  expect(dialog.open).toBe(false);
  expect(video.pause).toHaveBeenCalled();
  expect(video.hasAttribute("src")).toBe(false);
  expect(video.load).toHaveBeenCalled();
  expect(document.body).not.toHaveClass("project-video-open");
  expect(document.activeElement).toBe(trigger);
  trigger.click();
  expect(dialog.open).toBe(true);
  expect(video.play).toHaveBeenCalledTimes(2);
});
it("浏览器阻止自动开始时提供手动播放提示", async () => {
  vi.mocked(video.play).mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
  trigger.click();
  await Promise.resolve();
  expect(status.hidden).toBe(false);
  expect(status.textContent).toContain("播放按钮");
});
it("媒体错误显示重试；重试后恢复播放且清除错误", () => {
  trigger.click(); video.dispatchEvent(new Event("error"));
  expect(status.hidden).toBe(false);
  expect(status.textContent).toContain("暂时无法播放");
  expect(retry.hidden).toBe(false);
  retry.click();
  expect(video.load).toHaveBeenCalled();
  expect(video.play).toHaveBeenCalledTimes(2);
  expect(status.hidden).toBe(true);
  expect(retry.hidden).toBe(true);
});
it("原生关闭事件同样清理播放；关闭后的媒体错误不重新显示提示", () => {
  trigger.click(); dialog.close(); video.dispatchEvent(new Event("error"));
  expect(video.pause).toHaveBeenCalled();
  expect(status.hidden).toBe(true);
  expect(retry.hidden).toBe(true);
});
