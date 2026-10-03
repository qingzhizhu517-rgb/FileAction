import { Blob as NodeBlob } from "node:buffer";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "../../shared/api";
import { startJudgeExample, JUDGE_EXAMPLE } from "./judgeExample";

afterEach(() => vi.unstubAllGlobals());
function setup({ exists = false, configured = true, sampleOk = true, different = false, failFact = false, missingSource = false, allowed = true } = {}) {
  const writes: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", async (url: string, options?: RequestInit) => {
    if (url === JUDGE_EXAMPLE.url) return new Response("synthetic-pdf-test-bytes", { status: sampleOk ? 200 : 404 });
    if (url.endsWith("/source")) {
      if (missingSource) return Response.json({ error: { code: "RESOURCE_NOT_FOUND", message: "已失效" } }, { status: 404 });
      const body = different ? "user-edited-file" : "synthetic-pdf-test-bytes";
      const response = new Response(body);
      response.blob = async () => new NodeBlob([body]) as unknown as Blob;
      return response;
    }
    let data: unknown = {};
    if (url.endsWith("/config")) data = { storage_notice_version: "1", cos: { configured }, judge_example_available: allowed };
    else if (url.endsWith("/auth/csrf")) data = { csrf_token: "synthetic" };
    else if (url.includes("/documents?")) data = { items: exists ? [{ id: "old", name: JUDGE_EXAMPLE.name, parse_status: "ready" }] : [] };
    if (options?.method && options.method !== "GET") {
      const body = options.body instanceof FormData ? options.body : JSON.parse(options.body as string);
      writes.push({ url, body });
      if (url.endsWith("/documents")) data = { id: "new", parse_status: "ready" };
      else if (url.endsWith("/workspaces")) data = { id: "workspace", revision: 1 };
      else if (url.endsWith("/facts")) {
        if (failFact) return Response.json({ error: { code: "CONFLICT", message: "合成冲突" } }, { status: 409 });
        data = { id: "workspace", revision: 3 };
      } else data = { id: "workspace", revision: 2 };
    }
    return Response.json({ data });
  });
  return writes;
}
it("合成场景在点击后保存 PDF、目标和可编辑背景，不创建模型运行", async () => {
  const writes = setup();
  expect((await startJudgeExample(new ApiClient())).id).toBe("workspace");
  expect(writes.map(x => x.url)).toEqual(["/api/v1/documents", "/api/v1/workspaces", "/api/v1/workspaces/workspace", "/api/v1/workspaces/workspace/facts"]);
  expect((writes[0].body as FormData).get("retention")).toBe("retained");
  expect((writes[0].body as FormData).get("consent_to_store")).toBe("true");
  expect(writes[3].body).toMatchObject({ expected_revision: 2, confirmed: true, text: expect.stringContaining("合成角色") });
});
it("复用内容完全相同的预设文件，每次创建独立体验", async () => {
  const writes = setup({ exists: true });
  await startJudgeExample(new ApiClient());
  expect(writes[0]).toMatchObject({ url: "/api/v1/workspaces", body: { primary_document_id: "old" } });
});
it("不把同名但已被修改的文件当成预设资料", async () => {
  const writes = setup({ exists: true, different: true });
  await startJudgeExample(new ApiClient());
  expect(writes[0].url).toBe("/api/v1/documents");
});
it("存储不可用时停止，不能悄悄退回临时保存", async () => {
  const writes = setup({ configured: false });
  await expect(startJudgeExample(new ApiClient())).rejects.toThrow("文件空间暂不可用");
  expect(writes).toHaveLength(0);
});
it("PDF资源加载失败时不创建空工作区", async () => {
  const writes = setup({ sampleOk: false });
  await expect(startJudgeExample(new ApiClient())).rejects.toThrow("示例文件未能加载");
  expect(writes).toHaveLength(0);
});
it("背景保存失败时不冒充体验准备完成", async () => {
  setup({ failFact: true });
  await expect(startJudgeExample(new ApiClient())).rejects.toThrow("合成冲突");
});

it("失效的同名原件不阻止重新准备示例", async () => {
  const writes = setup({ exists: true, missingSource: true });
  await startJudgeExample(new ApiClient());
  expect(writes[0].url).toBe("/api/v1/documents");
});

it("未获体验配置时不下载或创建预设内容", async () => {
  const writes = setup({ allowed: false });
  await expect(startJudgeExample(new ApiClient())).rejects.toThrow("当前账号未开放预设体验");
  expect(writes).toHaveLength(0);
});
