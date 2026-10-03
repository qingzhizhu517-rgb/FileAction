import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FormalApp } from "../../app/FormalApp";
import type { DocumentItem, Workspace } from "../../shared/types";

const originalDoc: DocumentItem = {
  id: "synthetic-d1", current_version_id: "synthetic-v1", name: "合成通知.txt",
  revision: 1, retention: "temporary", parse_status: "ready", index_status: "not_indexed",
};
const supplement: DocumentItem = {
  ...originalDoc, id: "synthetic-d2", current_version_id: "synthetic-v2", name: "合成证明.txt",
};
const envelope = {
  summary: "合成解读：需要确认背景及补充附件。", coverage: "full_selected_text",
  claims: [], questions: ["你的校区是什么？"], unknowns: ["附件课程清单未提供。", "开课时间尚未通知。"],
  memory_candidates: [], action_candidates: [], artifact: null,
};
let workspace: Workspace;
let requests: { path: string; method: string; body: any }[];
let attachFails: boolean;
const json = (data: unknown) => Response.json({ data });
beforeEach(() => {
  requests = [];
  attachFails = false;
  workspace = { id: "synthetic-w", title: "合成通知理解", status: "active", revision: 1,
    retention: "temporary", facts: [], documents: [originalDoc] };
  window.history.replaceState(null, "", "/workspaces/synthetic-w");
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = url.replace("/api/v1", "");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    requests.push({ path, method, body });
    if (path === "/auth/me") return json({ id: "synthetic-u", display_name: "合成用户" });
    if (path === "/auth/csrf") return json({ csrf_token: "synthetic" });
    if (path.endsWith("/messages")) return json({ items: [], next_cursor: null });
    if (path === "/documents" && method === "POST") return json(supplement);
    if (path.endsWith("/documents") && method === "PUT") {
      if (attachFails) return Response.json({ error: { code: "ATTACH_FAILED", message: "合成附加失败" } }, { status: 503 });
      expect(body.expected_revision).toBe(workspace.revision);
      workspace = { ...workspace, revision: workspace.revision + 1,
        documents: [originalDoc, supplement].filter(doc => body.document_version_ids.includes(doc.current_version_id)) };
      return json(workspace);
    }
    if (path.endsWith("/facts") && method === "POST") {
      expect(body.expected_revision).toBe(workspace.revision);
      workspace = { ...workspace, revision: workspace.revision + 1, facts: [...workspace.facts!,
        { id: "synthetic-f1", version: 1, text: body.text, confirmed: true, retention: "temporary" }] };
      return json(workspace);
    }
    if (path.endsWith("/context-preview")) return json({
      preview_id: "synthetic-p", manifest_hash: "synthetic-hash", expires_at: new Date(Date.now() + 120000).toISOString(),
      manifest: { documents: workspace.documents!.map(doc => ({ document_id: doc.id,
        document_version_id: doc.current_version_id, name: doc.name, segments: [{ segment_id: "synthetic-s", text: "明确标注的合成原文" }] })),
      facts: workspace.facts, history: [], message: body.message, goal: "", kind: body.kind,
      retrieval_mode: "full_text", model: { domain: "synthetic.invalid", name: "HTTP测试替身" },
      coverage: "full_selected_text", character_counts: {}, estimated_tokens: 100 },
    });
    if (path.endsWith("/runs") && method === "POST") return json({ id: "synthetic-r", workspace_id: workspace.id, status: "succeeded", phase: "saving" });
    if (path.endsWith("/result")) return json({ run_id: "synthetic-r", workspace_id: workspace.id, answer_id: "synthetic-a", envelope });
    if (path === "/workspaces/synthetic-w") return json(workspace);
    return json([]);
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function showResult() {
  render(<FormalApp />);
  fireEvent.click(await screen.findByRole("button", { name: "预览外发内容" }));
  fireEvent.click(await screen.findByRole("button", { name: "开始本次理解" }));
  return await screen.findByRole("region", { name: "补充后再判断" });
}

it("补充文字明确确认仅本次，旧结论失效且新预览包含回答，不自动生成", async () => {
  const panel = await showResult();
  const card = within(panel).getByRole("article", { name: "你的校区是什么？" });
  fireEvent.click(within(card).getByRole("button", { name: "补充回答" }));
  fireEvent.change(within(card).getByLabelText("你的回答"), { target: { value: "合成青州校区" } });
  expect(requests.filter(req => req.path.endsWith("/facts"))).toHaveLength(0);
  fireEvent.click(within(card).getByRole("button", { name: "确认回答并用于本次" }));
  await waitFor(() => expect(workspace.facts).toHaveLength(1));
  expect(workspace.facts![0].text).toContain("你的校区是什么？");
  expect(workspace.facts![0].text).toContain("合成青州校区");
  expect(await screen.findByText("回答已确认 · 待重新理解")).toBeInTheDocument();
  expect(screen.queryByText(envelope.summary)).not.toBeInTheDocument();
  expect(requests.filter(req => req.path.endsWith("/runs"))).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "用补充内容重新理解" }));
  const preview = await screen.findByRole("dialog");
  expect(preview).toHaveTextContent("合成青州校区");
  expect(requests.filter(req => req.path.endsWith("/context-preview")).at(-1)!.body.kind).toBe("interpret");
  fireEvent.click(within(preview).getByRole("button", { name: "取消" }));
  expect(requests.filter(req => req.path.endsWith("/runs"))).toHaveLength(1);
  expect(requests.some(req => req.path.includes("/memories") || req.path.includes("/retain"))).toBe(false);
});

it("补充上传临时材料并加入当前工作区，新预览包含原文件和补充材料", async () => {
  const panel = await showResult();
  const card = within(panel).getByRole("article", { name: "附件课程清单未提供。" });
  fireEvent.click(within(card).getByRole("button", { name: "上传材料" }));
  fireEvent.change(within(card).getByLabelText("选择补充材料"), { target: { files: [new File(["合成课程清单"], "合成证明.txt", { type: "text/plain" })] } });
  expect(requests.filter(req => req.path === "/documents")).toHaveLength(0);
  fireEvent.click(within(card).getByRole("button", { name: "上传并用于本次" }));
  await waitFor(() => expect(workspace.documents).toHaveLength(2));
  const form = requests.find(req => req.path === "/documents")!.body as FormData;
  expect(form.get("retention")).toBe("temporary");
  expect(form.get("consent_to_store")).toBe("false");
  expect(requests.find(req => req.method === "PUT")!.body.document_version_ids).toEqual(["synthetic-v1", "synthetic-v2"]);
  expect(await screen.findByText("材料已加入 · 待重新理解")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "用补充内容重新理解" }));
  const preview = await screen.findByRole("dialog");
  expect(preview).toHaveTextContent("合成通知.txt");
  expect(preview).toHaveTextContent("合成证明.txt");
  expect(requests.filter(req => req.path.endsWith("/runs"))).toHaveLength(1);
});

it("补充材料附加失败保留已解析文件，重试不重复上传；移除须确认", async () => {
  attachFails = true;
  const panel = await showResult();
  const card = within(panel).getByRole("article", { name: "附件课程清单未提供。" });
  fireEvent.click(within(card).getByRole("button", { name: "上传材料" }));
  fireEvent.change(within(card).getByLabelText("选择补充材料"), { target: { files: [new File(["合成材料"], "合成证明.txt")] } });
  fireEvent.click(within(card).getByRole("button", { name: "上传并用于本次" }));
  expect(await within(card).findByText("合成附加失败")).toBeInTheDocument();
  expect(workspace.documents).toHaveLength(1);
  attachFails = false;
  fireEvent.click(within(card).getByRole("button", { name: "重试加入本次材料" }));
  await waitFor(() => expect(workspace.documents).toHaveLength(2));
  expect(requests.filter(req => req.path === "/documents")).toHaveLength(1);
  fireEvent.click(within(card).getByRole("button", { name: "移除本次材料" }));
  expect(workspace.documents).toHaveLength(2);
  fireEvent.click(within(card).getByRole("button", { name: "确认移除材料" }));
  await waitFor(() => expect(workspace.documents).toHaveLength(1));
});

it("补充可跳过或取消，未确认草稿不会创建事实或上传，也不等于解决未知", async () => {
  const panel = await showResult();
  const card = within(panel).getByRole("article", { name: "你的校区是什么？" });
  fireEvent.click(within(card).getByRole("button", { name: "补充回答" }));
  fireEvent.change(within(card).getByLabelText("你的回答"), { target: { value: "未确认合成背景" } });
  fireEvent.click(within(card).getByRole("button", { name: "取消补充" }));
  fireEvent.click(within(card).getByRole("button", { name: "暂时跳过" }));
  expect(within(card).getByText("已跳过 · 仍待核实")).toBeInTheDocument();
  expect(workspace.facts).toHaveLength(0);
  expect(requests.filter(req => req.method === "PUT" || req.path.endsWith("/facts") || req.path === "/documents")).toHaveLength(0);
});
