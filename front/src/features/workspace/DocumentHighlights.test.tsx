import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DocumentHighlights } from "./DocumentHighlights";
import type { ContextPreview } from "../../shared/types";
afterEach(() => { cleanup(); vi.useRealTimers(); });
function snapshot(lines: string[]): ContextPreview {
  return { manifest: { documents: [{ name: "合成通知.pdf", document_id: "synthetic", document_version_id: "v1", segments: lines.map((text,i) => ({ text, location: `第${i+1}行` })) }] } } as ContextPreview;
}
it("将原文日期和链接单列，明确北京时间的截止才计算倒计时", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-03T10:00:00Z"));
  render(<DocumentHighlights snapshot={snapshot(["报名截止：2026年10月15日18:00（北京时间）。", "演示报名链接：https://example.org/campus-innovation", "线上交流：2026年10月18日14:00至16:00（北京时间）。"])} />);
  expect(screen.getByText("距原文截止 12 天 0 小时")).toBeInTheDocument();
  expect(screen.getByRole("link",{name:"https://example.org/campus-innovation"})).toHaveAttribute("href","https://example.org/campus-innovation");
  expect(screen.getByText("演示入口 · 无真实报名功能")).toBeInTheDocument();
  expect(screen.getByText("线上交流：2026年10月18日14:00至16:00（北京时间）。", { selector: "strong" })).toBeInTheDocument();
});
it("日期不完整、无时区或无效时只展示原文，不推断倒计时", () => {
  render(<DocumentHighlights snapshot={snapshot(["截止：10月15日18:00", "截止：2026年10月15日18:00", "截止：2026年2月30日18:00（北京时间）。", "报名截止日期尚未公布。宣讲会定于2026年10月15日18:00（北京时间）。", "截止：2026年10月15日18:00（UTC+80）。"])} />);
  expect(screen.queryByText(/距原文截止/)).not.toBeInTheDocument();
  expect(screen.queryByText(/原文截止时间已过/)).not.toBeInTheDocument();
});
it("不生成危险协议、含登录信息的网址或缺少原文的重点", () => {
  render(<DocumentHighlights snapshot={snapshot(["报名入口：javascript:alert(1)", "入口：https://user:pass@example.org/x", "普通合成段落"])} />);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
});
