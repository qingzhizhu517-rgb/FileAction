import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FormalApp } from "../../app/FormalApp";

// 合成 HTTP 数据只验证产品交互，不替代真实模型理解验收。
let calls: { path: string; method: string; body: any }[];
let history: { id: string; role: string; text: string }[];
let workspace: any;
const result = { summary: "合成解读：你的项目可能有关，资格仍待核实。", coverage: "full_selected_text",
  claims: [], questions: [], unknowns: [], memory_candidates: [{ id: "c1", text: "合成项目经历", evidence: [] }],
  action_candidates: [{ id: "a1", text: "合成下一步", evidence: [] }], artifact: null };
const json = (data: unknown) => Response.json({ data });
beforeEach(() => {
  calls = []; history = [];
  workspace = { id: "journey-w", title: "合成通知", revision: 1, status: "active", retention: "temporary", documents: [], facts: [] };
  window.history.replaceState(null, "", "/workspaces/journey-w");
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = url.replace("/api/v1", ""); const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body });
    if (path === "/auth/me") return json({ id: "journey-u", display_name: "合成用户" });
    if (path === "/auth/csrf") return json({ csrf_token: "synthetic" });
    if (path === "/config") return json({ storage_notice_version: "1", cos: { configured: false },
      generation: { configured: true, model: "合成模型", domain: "synthetic.invalid" }, embedding: { configured: false } });
    if (path.endsWith("/messages")) return json({ items: history, next_cursor: null });
    if (path.endsWith("/context-preview")) return json({ preview_id: "p", manifest_hash: "h", expires_at: new Date(Date.now()+120000).toISOString(),
      manifest: { documents: [], facts: workspace.facts, history: history.filter(m => body.history_message_ids.includes(m.id)),
        message: body.message, goal: "", kind: body.kind, retrieval_mode: "full_text", model: { name: "合成模型", domain: "synthetic.invalid" }, coverage: "full_selected_text", character_counts: {}, estimated_tokens: 100 } });
    if (path.endsWith("/runs") && method === "POST") return json({ id: "journey-r", workspace_id: workspace.id, status: "succeeded", phase: "saving" });
    if (path.endsWith("/result")) {
      history = [{ id: "u1", role: "user", text: "合成首问" }, { id: "a1", role: "assistant", text: result.summary }];
      return json({ run_id: "journey-r", workspace_id: workspace.id, answer_id: "answer1", envelope: result });
    }
    if (path.endsWith("/facts") && method === "POST") {
      workspace = { ...workspace, revision: workspace.revision+1, facts: [...workspace.facts, { id: "f1", version: 1, text: body.text, confirmed: true, retention: "temporary" }] };
      return json(workspace);
    }
    if (path === "/workspaces/journey-w") return json(workspace);
    return json({ items: [], next_cursor: null });
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function interpret() {
  render(<FormalApp />);
  fireEvent.click(await screen.findByRole("button", { name: "预览外发内容" }));
  fireEvent.click(await screen.findByRole("button", { name: "开始本次理解" }));
  await screen.findByText(result.summary);
}
it("下一轮读取最新历史，在外发预览中逐条展示，不自动运行", async () => {
  await interpret();
  fireEvent.change(screen.getByLabelText("本次问题"), { target: { value: "按刚才说的继续" } });
  fireEvent.click(screen.getByRole("button", { name: "预览外发内容" }));
  const dialog = await screen.findByRole("dialog");
  expect(calls.filter(c => c.path.endsWith("/context-preview")).at(-1)!.body.history_message_ids).toEqual(["u1", "a1"]);
  expect(dialog).toHaveTextContent("合成首问");
  expect(dialog).toHaveTextContent(result.summary);
  expect(calls.filter(c => c.path.endsWith("/runs"))).toHaveLength(1);
});
it("到这里就够了给出完成状态，可重新讨论且不保存、不清除临时内容", async () => {
  await interpret();
  fireEvent.click(screen.getByRole("button", { name: "到这里就够了" }));
  expect(await screen.findByText("本次理解已完成")).toBeInTheDocument();
  expect(screen.queryByLabelText("本次问题")).not.toBeInTheDocument();
  expect(calls.some(c => c.path.endsWith("/end") || c.path.includes("/retain"))).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "继续讨论" }));
  expect(screen.getByLabelText("本次问题")).toBeInTheDocument();
});
it("继续后选择具体产物，承接历史且仍需单独确认外发", async () => {
  await interpret();
  expect(screen.queryByRole("button", { name: "材料清单" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "继续行动" }));
  fireEvent.click(screen.getByRole("button", { name: "材料清单" }));
  expect((screen.getByLabelText("本次问题") as HTMLTextAreaElement).value).toContain("材料清单");
  fireEvent.click(screen.getByRole("button", { name: "预览外发内容" }));
  expect(await screen.findByRole("button", { name: "同意发送并起草成果" })).toBeInTheDocument();
  const preview = calls.filter(c => c.path.endsWith("/context-preview")).at(-1)!.body;
  expect(preview.kind).toBe("generate_artifact");
  expect(preview.history_message_ids).toEqual(["u1", "a1"]);
  expect(calls.filter(c => c.path.endsWith("/runs"))).toHaveLength(1);
});
it("背景候选可改再确认，仅写本次事实，长期保留另行选择", async () => {
  await interpret();
  fireEvent.click(screen.getByRole("button", { name: "本次对话沉淀" }));
  const notes = await screen.findByRole("dialog", { name: "本次对话沉淀" });
  fireEvent.change(within(notes).getByLabelText("修改背景候选"), { target: { value: "我已完成合成校园项目" } });
  fireEvent.click(within(notes).getByRole("button", { name: "确认属实，用于本次" }));
  await waitFor(() => expect(workspace.facts).toHaveLength(1));
  expect(workspace.facts[0].text).toBe("我已完成合成校园项目");
  expect(calls.some(c => c.path.includes("/retain") || c.method === "POST" && c.path.includes("/memories"))).toBe(false);
});
it("长期背景保留失败不报成功，重试仅发送选中的事实版本", async () => {
  workspace.facts = [
    { id: "f1", version: 2, text: "合成已确认经历", confirmed: true, retention: "temporary" },
    { id: "f2", version: 1, text: "合成不想保存的经历", confirmed: true, retention: "temporary" },
  ];
  const original = fetch; let attempts = 0; const requests: any[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.endsWith("/retain")) {
      attempts++; requests.push({ body: JSON.parse(init!.body as string), key: new Headers(init?.headers).get("Idempotency-Key") });
      if (attempts === 1) return Response.json({ error: { code: "UNAVAILABLE", message: "合成保存失败" } }, { status: 503 });
      return json({ id: "mem1" });
    }
    return original(url, init);
  });
  render(<FormalApp />);
  fireEvent.click(await screen.findByRole("button", { name: "本次对话沉淀" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("button", { name: "确认保留所选背景" })).toBeDisabled();
  fireEvent.click(within(dialog).getByLabelText("长期保留：合成已确认经历"));
  fireEvent.click(within(dialog).getByRole("button", { name: "确认保留所选背景" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("合成保存失败");
  expect(within(dialog).queryByText("当前版本已长期保留")).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "确认保留所选背景" }));
  expect(await within(dialog).findByText("当前版本已长期保留")).toBeInTheDocument();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  expect(requests[1].body).toEqual({ expected_revision: 1, fact_version: 2, consent_to_retain: true });
});
it("已保留背景需主动选择加入本次，携带所见版本且不自动调用模型", async () => {
  const original = fetch;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url === "/api/v1/memories?limit=100") return json({ items: [{ id: "mem1", text: "合成长期背景", revision: 3, current_version: 2, active: true }], next_cursor: null });
    if (url.endsWith("/memories/mem1/use")) {
      calls.push({ path: "/memories/mem1/use", method: "POST", body: JSON.parse(init!.body as string) });
      workspace = { ...workspace, revision: 2, facts: [{ id: "mf", text: "合成长期背景", version: 1, confirmed: true, retention: "temporary" }] };
      return json(workspace);
    }
    return original(url, init);
  });
  render(<FormalApp />);
  fireEvent.click(await screen.findByRole("button", { name: "选择已保留背景" }));
  const library = await screen.findByRole("dialog", { name: "已保留背景" });
  expect(await within(library).findByText("合成长期背景")).toBeInTheDocument();
  expect(calls.some(c => c.path.endsWith("/use"))).toBe(false);
  fireEvent.click(within(library).getByRole("button", { name: "用于本次理解" }));
  await waitFor(() => expect(workspace.facts).toHaveLength(1));
  expect(calls.find(c => c.path.endsWith("/use"))?.body).toEqual({ workspace_id: workspace.id, expected_revision: 1, expected_memory_revision: 3 });
  expect(calls.some(c => c.path.endsWith("/runs"))).toBe(false);
});
it("已确认背景编辑未保存时不能误保留旧版本", async () => {
  workspace.facts = [{ id: "f1", version: 1, text: "合成旧背景", confirmed: true, retention: "temporary" }];
  render(<FormalApp />);
  fireEvent.click(await screen.findByRole("button", { name: "本次对话沉淀" }));
  fireEvent.click(screen.getByLabelText("长期保留：合成旧背景"));
  fireEvent.change(screen.getByLabelText("修改已确认背景"), { target: { value: "合成尚未保存的新背景" } });
  expect(screen.getByRole("button", { name: "确认保留所选背景" })).toBeDisabled();
  expect(screen.getByLabelText("长期保留：合成旧背景")).toBeDisabled();
});
it("多项待核实按需展开，读懂完成后收起补充操作", async () => {
  const original = fetch;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const response = await original(url, init);
    if (!url.endsWith("/result")) return response;
    const payload = await response.json();
    payload.data.envelope.questions = ["合成问题一", "合成问题二", "合成问题三", "合成问题四"];
    return Response.json(payload);
  });
  await interpret();
  expect(await screen.findByText("查看待核实与可补充内容（4）")).toBeInTheDocument();
  expect(screen.getAllByText("补充回答")[0]).not.toBeVisible();
  fireEvent.click(screen.getByText("查看待核实与可补充内容（4）"));
  expect(screen.getAllByRole("button", { name: "补充回答" })).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "到这里就够了" }));
  expect(screen.queryByRole("button", { name: "补充回答" })).not.toBeInTheDocument();
});
it("工作区不可编辑时仍可关闭沉淀弹窗", async () => {
  workspace.status = "ending";
  render(<FormalApp />);
  fireEvent.click(await screen.findByRole("button", { name: "本次对话沉淀" }));
  const dialog = screen.getByRole("dialog", { name: "本次对话沉淀" });
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("删除保留背景清除保存状态，再次主动保留使用新请求标识", async () => {
  workspace.facts = [{ id: "f1", version: 1, text: "合成可删除背景", confirmed: true, retention: "temporary" }];
  const original = fetch; let present = false; const keys: (string | null)[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.endsWith("/retain")) { present = true; keys.push(new Headers(init?.headers).get("Idempotency-Key")); return json({ id: "mem-delete" }); }
    if (url.includes("/memories/mem-delete?") && init?.method === "DELETE") { present = false; return json({ deleted: true }); }
    if (url.includes("/memories?")) return json({ items: present ? [{ id: "mem-delete", text: "合成可删除背景", revision: 1, current_version: 1, active: true }] : [], next_cursor: null });
    return original(url, init);
  });
  render(<FormalApp />);
  async function retain() {
    fireEvent.click(await screen.findByRole("button", { name: "本次对话沉淀" }));
    fireEvent.click(screen.getByLabelText("长期保留：合成可删除背景"));
    fireEvent.click(screen.getByRole("button", { name: "确认保留所选背景" }));
    await screen.findByText("当前版本已长期保留");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  }
  await retain();
  fireEvent.click(screen.getByRole("button", { name: "选择已保留背景" }));
  fireEvent.click(await screen.findByRole("button", { name: "删除" }));
  fireEvent.click(screen.getByRole("button", { name: "确认删除背景" }));
  await screen.findByText("还没有保留的背景");
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  await retain();
  expect(keys).toHaveLength(2); expect(keys[1]).not.toBe(keys[0]);
});
