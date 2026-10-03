import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FormalApp } from "../../app/FormalApp";
import { StrictMode } from "react";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup({ wrongWorkspace = false, stale = false, initialNetworkFailure = false } = {}) {
  window.history.replaceState(null, "", "/workspaces/recovery");
  const writes: string[] = [];
  let stateReads = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") writes.push(url);
    let data: unknown = { items: [] };
    if (url.endsWith("/auth/me")) data = { id: "synthetic", display_name: "合成" };
    else if (url.endsWith("/config")) data = { generation: { configured: true } };
    else if (url.endsWith("/workspaces/recovery")) data = { id: "recovery", revision: 1, status: "active", title: "合成恢复测试", facts: [], documents: [] };
    else if (url.endsWith("/messages")) data = { items: [{ id: "m1", role: "assistant", text: "此前对话", run_id: "r1" }] };
    else if (url.endsWith("/runs/r1") && initialNetworkFailure && stateReads++ === 0) return Response.json({error:{code:"DEPENDENCY_UNAVAILABLE",message:"合成网络失败"}},{status:503});
    else if (url.endsWith("/runs/r1")) data = { id: "r1", workspace_id: "recovery", status: stale ? "stale" : "succeeded", phase: "saving" };
    else if (url.endsWith("/runs/r1/result")) data = {
      run_id: "r1", workspace_id: "recovery", answer_id: "a1",
      context: { workspace_id: wrongWorkspace ? "another" : "recovery", workspace_revision: 1, documents: [{ document_id: "d", document_version_id: "v", name: "合成通知", segments: [{ segment_id: "s", text: "申请时间待确认" }] }], facts: [] },
      envelope: { summary: "合成已恢复解读", coverage: "full_selected_text", questions: [], unknowns: [], action_candidates: [], memory_candidates: [], artifact: null, claims: [{ id: "c", kind: "document_fact", text: "原文未给日期", evidence: [{ type: "document", document_id: "d", version: "v", segment_id: "s", quote: "申请时间待确认" }] }] },
    };
    return Response.json({ data });
  });
  return writes;
}
it("重新进入恢复有效解读、冻结引用和继续行动，不重新调用模型", async () => {
  const writes = setup(); render(<FormalApp />);
  expect(await screen.findByText("合成已恢复解读")).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"继续行动"})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:"查看来源 c-1"}));
  expect(await screen.findByText("已校验原文引句")).toBeInTheDocument();
  expect(writes).toHaveLength(0);
});
it("不恢复已经失效的结果", async () => {
  setup({ stale: true }); render(<FormalApp />);
  expect(await screen.findByText("来源或目标已变化，请重新预览")).toBeInTheDocument();
  expect(screen.queryByText("合成已恢复解读")).not.toBeInTheDocument();
});
it("拒绝把其他工作区的原文快照用于此结果", async () => {
  setup({ wrongWorkspace: true }); render(<FormalApp />);
  expect(await screen.findByRole("alert")).toHaveTextContent("解读来源与当前工作区不匹配");
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("解读来源与当前工作区不匹配");
  expect(screen.queryByText("合成已恢复解读")).not.toBeInTheDocument();
});

it("恢复的首次状态读取失败后可重试，仍不新建模型运行", async () => {
  const writes = setup({ initialNetworkFailure: true }); render(<FormalApp />);
  expect(await screen.findByRole("alert")).toHaveTextContent("合成网络失败");
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(await screen.findByText("合成已恢复解读")).toBeInTheDocument();
  expect(writes).toHaveLength(0);
});

it("严格模式下离开再从缓存打开会话，仍恢复完整解读", async () => {
  const writes=setup(); render(<StrictMode><FormalApp /></StrictMode>);
  expect(await screen.findByText("合成已恢复解读")).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("link",{name:"文件空间"})[0]);
  await screen.findByRole("heading",{name:"文件空间"});
  window.history.pushState(null,"","/workspaces/recovery");
  fireEvent(window,new PopStateEvent("popstate"));
  expect(await screen.findByText("合成已恢复解读")).toBeInTheDocument();
  expect(writes).toHaveLength(0);
});
