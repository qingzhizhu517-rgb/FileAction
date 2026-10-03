import { ApiClient, ApiError, items } from "../../shared/api";
import type { Configuration, DocumentItem, Workspace } from "../../shared/types";

export const JUDGE_EXAMPLE = {
  url: "/examples/campus-innovation-synthetic.pdf",
  name: "合成体验-校园创新实践计划.pdf",
  title: "合成体验 · 校园创新实践计划",
  goal: "判断这份通知对合成角色是否值得参与，梳理条件与缺口；选择继续后再准备一页项目说明。",
  background: "【合成角色，仅用于本次体验，不是真实个人资料】我是一名大二本科生，计划独自参加。我的想法是帮助同学整理校园通知，减少错过报名的情况。我每周可投入6小时，目前只有想法，还没有原型和用户访谈记录。在读证明尚未准备。",
  question: "结合我的背景，这份通知和我有什么关系？请区分已满足的条件、还需核实的内容和最小下一步，特别指出截止时间和需要准备的材料。",
};

export async function startJudgeExample(api: ApiClient): Promise<Workspace> {
  const config = await api.request<Configuration>("/config");
  if (config.judge_example_available !== true)
    throw new ApiError(403, "DEMO_DISABLED", "当前账号未开放预设体验");
  if (!config.cos?.configured || !config.storage_notice_version)
    throw new ApiError(503, "STORAGE_UNAVAILABLE", "文件空间暂不可用，请稍后重试。");
  let response: Response;
  try { response = await fetch(JUDGE_EXAMPLE.url); }
  catch { throw new ApiError(503, "EXAMPLE_UNAVAILABLE", "示例文件未能加载，请重试。"); }
  if (!response.ok) throw new ApiError(503, "EXAMPLE_UNAVAILABLE", "示例文件未能加载，请重试。");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new ApiError(503, "EXAMPLE_UNAVAILABLE", "示例文件未能加载，请重试。");
  const existing = items(await api.request<{ items: DocumentItem[] }>("/documents?q=" + encodeURIComponent(JUDGE_EXAMPLE.name)));
  let doc: DocumentItem | undefined;
  for (const candidate of existing.filter(value => value.name === JUDGE_EXAMPLE.name && value.parse_status === "ready")) {
    // 只复用字节相同的原件，避免把用户同名/新版材料误当成合成示例。
    let original: Blob;
    try { original = await api.request<Blob>("/documents/" + candidate.id + "/source", { binary: true }); }
    catch (error) { if (error instanceof ApiError && error.status === 404) continue; throw error; }
    const saved = new Uint8Array(await original.arrayBuffer());
    if (saved.length === bytes.length && saved.every((value, index) => value === bytes[index])) { doc = candidate; break; }
  }
  if (!doc) {
    const form = new FormData();
    form.set("file", new File([bytes], JUDGE_EXAMPLE.name, { type: "application/pdf" }));
    form.set("retention", "retained"); form.set("consent_to_store", "true");
    form.set("storage_notice_version", config.storage_notice_version);
    doc = await api.request<DocumentItem>("/documents", { method: "POST", body: form });
  }
  if (doc.parse_status !== "ready") throw new ApiError(422, "EXAMPLE_NOT_READY", "示例文件尚未解析完成，请稍后重试。");
  let workspace = await api.request<Workspace>("/workspaces", { method: "POST", body: {
    primary_document_id: doc.id, retention: "temporary", title: JUDGE_EXAMPLE.title,
  } });
  const base = "/workspaces/" + workspace.id;
  workspace = await api.request<Workspace>(base, { method: "PATCH", body: { expected_revision: workspace.revision, goal: JUDGE_EXAMPLE.goal } });
  await api.request(base + "/facts", { method: "POST", body: { expected_revision: workspace.revision, text: JUDGE_EXAMPLE.background, confirmed: true } });
  return workspace;
}
