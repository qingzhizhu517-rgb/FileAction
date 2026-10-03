import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AnswerResult } from "./AnswerResult";
import type { AnswerEnvelope } from "./useWorkspaceRun";
import type { ContextPreview } from "../../shared/types";

// 合成模型结果只验证阅读层级和来源入口，不代表真实模型验收。
afterEach(cleanup);
const snapshot = { manifest: { documents: [{ document_id: "synthetic-doc", document_version_id: "v1", name: "合成通知", segments: [{ segment_id: "s1", text: "合成原文：条件待核实。", location: "第1段" }] }], facts: [] } } as unknown as ContextPreview;
function answer(count: number): AnswerEnvelope {
  return { summary: "合成摘要：先核实条件，再决定是否继续。", coverage: "full_selected_text", claims: Array.from({ length: count }, (_, index) => ({ id: `c${index}`, kind: "document_fact", text: `合成判断${index}`, evidence: [{ type: "document", document_id: "synthetic-doc", version: "v1", segment_id: "s1", quote: "条件待核实。" }] })), questions: [], unknowns: [], memory_candidates: [], action_candidates: [], artifact: null };
}
it("长解读默认只呈现摘要，展开判断后仍能核对原文来源", () => {
  render(<AnswerResult answer={answer(4)} snapshot={snapshot} />);
  expect(screen.getByText("合成摘要：先核实条件，再决定是否继续。")).toBeVisible();
  expect(screen.getByText("合成判断0")).not.toBeVisible();
  fireEvent.click(screen.getByText("查看详细判断与来源（4）"));
  expect(screen.getByText("合成判断0")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "查看来源 c0-1" }));
  expect(within(screen.getByRole("dialog")).getByText("条件待核实。", { selector: "blockquote" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  fireEvent.click(screen.getByText("查看详细判断与来源（4）"));
  expect(screen.getByText("合成判断0")).not.toBeVisible();
});
it("三条以内的判断保持展开，无判断时不显示空折叠入口", () => {
  const view = render(<AnswerResult answer={answer(3)} snapshot={snapshot} />);
  expect(screen.getByText("合成判断2")).toBeVisible();
  view.rerender(<AnswerResult answer={answer(0)} snapshot={snapshot} />);
  expect(screen.queryByText(/查看详细判断与来源/)).not.toBeInTheDocument();
});
