import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FormalApp } from "../../app/FormalApp";

// HTTP替身与全部内容均为合成测试数据，不代表真实模型验收。
let calls: { path: string; body: any; method: string }[];
let workspace: any;
let expiresAt: string;
const json = (data: unknown) => Response.json({ data });
it("首屏按文档主线先理解文件，不暴露检索技术选项", async () => {
  render(<FormalApp />);
  expect(await screen.findByRole("heading", {name:"这份文件，对现在的你意味着什么？"})).toBeInTheDocument();
  expect(screen.getByText("先理解，再决定下一步")).toBeInTheDocument();
  expect(screen.queryByLabelText("检索方式")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("本次请求")).not.toBeInTheDocument();
  expect(screen.getByText("开始理解")).toBeInTheDocument();
});
it("未配置模型时不渲染空白服务方，并说明无法开始", async () => {
  const originalFetch = fetch;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.endsWith("/config"))
      return json({ storage_notice_version: "1", cos: { configured: false },
        generation: { configured: false, model: null, domain: null }, embedding: { configured: false } });
    return originalFetch(url, init);
  });
  render(<FormalApp />);
  await screen.findByLabelText("本次问题");
  fireEvent.change(screen.getByLabelText("本次问题"), { target: { value: "合成问题" } });
  fireEvent.click(screen.getByRole("button", { name: "预览外发内容" }));
  expect(await screen.findByText("当前没有可用的模型服务。")).toBeInTheDocument();
  // 不再出现「发送至  的 。」这类空白服务方拼接。
  expect(screen.queryByText(/发送至\s*的/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "模型未配置，暂不能开始" })).toBeDisabled();
});
it("混合检索预览不需外发同意，创建运行必须独立确认查询Embedding", async () => {
  const originalFetch = fetch;
  const submissions: any[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.endsWith("/context-preview")) {
      const request = JSON.parse(init!.body as string);
      expect(request.retrieval_mode).toBe("full_text");
      const response = await originalFetch(url, init);
      const body = await response.json();
      body.data.manifest.retrieval_mode = "hybrid";
      body.data.manifest.embedding = {domain:"embedding.synthetic.invalid", model:"synthetic-embed", dimensions:768, profile_version:"1"};
      body.data.manifest.query_embedding_authorization = {query:"合成查询", max_requests:1, max_queries:6, max_characters:1200, request_seconds:15};
      return Response.json(body);
    }
    if (url.endsWith("/runs") && init?.method === "POST") {
      submissions.push(JSON.parse(init.body as string));
      return json({id:"r-hybrid", workspace_id:"synthetic-w", status:"failed", phase:"failed"});
    }
    return originalFetch(url, init);
  });
  render(<FormalApp />);
  await screen.findByLabelText("本次问题");
  fireEvent.change(screen.getByLabelText("本次问题"), {target:{value:"合成查询"}});
  fireEvent.click(screen.getByRole("button", {name:"预览外发内容"}));
  const send = await screen.findByRole("button", {name:"开始本次理解"});
  expect(send).toBeDisabled();
  expect(screen.getByText("embedding.synthetic.invalid")).toBeInTheDocument();
  expect(submissions).toEqual([]);
  fireEvent.click(screen.getByLabelText("同意将本次查询及授权上下文内的派生检索词发送给 Embedding 服务"));
  fireEvent.click(send);
  await waitFor(()=>expect(submissions).toHaveLength(1));
  expect(submissions[0].consent_to_embed_query).toBe(true);
  expect(submissions[0].consent_to_send).toBe(true);
});
it.each(["goal", "fact"])("领域修订后重新核对消息并隐藏旧助手缓存：%s", async (change) => {
  const originalFetch = fetch;
  let messageReads = 0;
  const userMessage = { id: "u-old", role: "user", text: "合成仍保留的用户问题" };
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url.endsWith("/messages")) {
      messageReads++;
      return Promise.resolve(json({ items: workspace.revision === 1
        ? [userMessage, { id: "a-old", role: "assistant", text: "合成旧助手回复" }]
        : [userMessage], next_cursor: null }));
    }
    return originalFetch(url, init);
  });
  render(<FormalApp />);
  expect(await screen.findByText("合成旧助手回复")).toBeInTheDocument();
  if (change === "goal") {
    fireEvent.change(screen.getByLabelText("本次目标"), { target: { value: "合成新目标" } });
    fireEvent.click(screen.getByRole("button", { name: "更新目标" }));
  } else {
    fireEvent.change(screen.getByLabelText("补充本次背景"), { target: { value: "合成新背景" } });
    fireEvent.click(screen.getByRole("button", { name: "确认属实，仅用于本次" }));
  }
  expect(screen.queryByText("合成旧助手回复")).not.toBeInTheDocument();
  await waitFor(() => expect(messageReads).toBeGreaterThan(1));
  expect(await screen.findByText("合成仍保留的用户问题")).toBeInTheDocument();
  expect(workspace.revision).toBe(2);
  expect(screen.queryByText("合成旧助手回复")).not.toBeInTheDocument();
});

it("旧消息在途响应不能跨领域修订回填且请求已取消", async () => {
  const originalFetch = fetch;
  let oldSignal: AbortSignal | null | undefined;
  let resolveOld: ((value: Response) => void) | undefined;
  let messageReads = 0;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url.endsWith("/messages")) {
      messageReads++;
      if (messageReads === 1) {
        oldSignal = init?.signal;
        // Deliberately ignore abort in this HTTP test double to exercise late completion.
        return new Promise<Response>((resolve) => { resolveOld = resolve; });
      }
      return Promise.resolve(json({ items: [], next_cursor: null }));
    }
    return originalFetch(url, init);
  });
  render(<FormalApp />);
  await screen.findByLabelText("本次目标");
  await waitFor(() => expect(resolveOld).toBeDefined());
  fireEvent.change(screen.getByLabelText("本次目标"), { target: { value: "合成新目标" } });
  fireEvent.click(screen.getByRole("button", { name: "更新目标" }));
  await waitFor(() => expect(messageReads).toBeGreaterThan(1));
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => resolveOld!(json({ items: [{ id: "late-old", role: "assistant", text: "合成迟到旧上下文答案" }], next_cursor: null })));
  expect(screen.queryByText("合成迟到旧上下文答案")).not.toBeInTheDocument();
});
it("生成失败保留输入，重试获取新预览和幂等键，不自动重复写请求", async () => {
  const originalFetch = fetch;
  let previewCount = 0;
  const keys: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.endsWith("/context-preview")) {
      const response = await originalFetch(url, init);
      const payload = await response.json();
      payload.data.preview_id = "retry-" + ++previewCount;
      return Response.json(payload);
    }
    if (url.endsWith("/runs")) {
      keys.push(new Headers(init?.headers).get("Idempotency-Key")!);
      return json({
        id: "r1",
        workspace_id: "synthetic-w",
        status: "failed",
        phase: "validating",
        error_code: "MODEL_SCHEMA_INVALID",
      });
    }
    return originalFetch(url, init);
  });
  render(<FormalApp />);
  await startRun();
  expect(await screen.findByText("本次生成失败")).toBeInTheDocument();
  expect(screen.getByLabelText("本次问题")).toHaveValue("合成运行问题");
  expect(keys).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "预览外发内容" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "开始本次理解" }),
  );
  await waitFor(() => expect(keys).toHaveLength(2));
  expect(previewCount).toBe(2);
  expect(keys[0]).not.toBe(keys[1]);
});
it("结束清理失败刷新ending版本，重试使用新版本且禁用修改", async () => {
  const originalFetch = fetch;
  const revisions: number[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.endsWith("/end")) {
      revisions.push(JSON.parse(init?.body as string).expected_revision);
      if (revisions.length === 1) {
        workspace = { ...workspace, status: "ending", revision: 2 };
        return Response.json(
          { error: { code: "CLEANUP_FAILED", message: "清理失败，可重试" } },
          { status: 503 },
        );
      }
      return new Response(null, { status: 204 });
    }
    return originalFetch(url, init);
  });
  render(<FormalApp />);
  fireEvent.click(await screen.findByRole("button", { name: "结束本次" }));
  fireEvent.click(
    screen.getByRole("button", { name: "确认结束并清除临时内容" }),
  );
  expect(
    await screen.findByText("结束处理中 · 请继续结束以重试清理"),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "修改标题" })).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "确认结束并清除临时内容" }),
  );
  expect(
    await screen.findByRole("heading", { name: "文件空间" }),
  ).toBeInTheDocument();
  expect(revisions).toEqual([1, 2]);
});
it("切换页面后晚到结果不能显示在其他页面", async () => {
  const originalFetch = fetch;
  let resolveResult: ((r: Response) => void) | undefined;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url.endsWith("/runs"))
      return Promise.resolve(
        json({
          id: "r1",
          workspace_id: "synthetic-w",
          status: "succeeded",
          phase: "saving",
        }),
      );
    if (url.endsWith("/runs/r1/result"))
      return new Promise<Response>((resolve) => {
        resolveResult = resolve;
      });
    return originalFetch(url, init);
  });
  render(<FormalApp />);
  await startRun();
  await waitFor(() => expect(resolveResult).toBeDefined());
  fireEvent.click(screen.getAllByRole("link", { name: "文件空间" })[0]);
  expect(
    await screen.findByRole("heading", { name: "文件空间" }),
  ).toBeInTheDocument();
  resolveResult!(
    json({
      run_id: "r1",
      workspace_id: "synthetic-w",
      answer_id: "ans1",
      envelope: answer,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByText("合成有效结果")).not.toBeInTheDocument();
});
async function startRun() {
  fireEvent.change(await screen.findByLabelText("本次问题"), {
    target: { value: "合成运行问题" },
  });
  fireEvent.click(screen.getByRole("button", { name: "预览外发内容" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "开始本次理解" }),
  );
}
const answer = {
  summary: "合成有效结果",
  coverage: "full_selected_text",
  artifact: null,
  claims: [
    {
      id: "c1",
      text: "截止日尚未确定",
      kind: "document_fact",
      evidence: [
        {
          type: "document",
          document_id: "synthetic-d",
          version: "synthetic-v",
          segment_id: "s1",
          quote: "申请截止日尚未确定",
          location: "第1段",
          char_start: 5,
          char_end: 14,
        },
      ],
    },
    { id: "c2", text: "需要进一步确认", kind: "inference", evidence: [] },
    { id: "c3", text: "资格仍未知", kind: "unknown", evidence: [] },
  ],
  questions: ["你希望何时申请？"],
  unknowns: ["尚无日期"],
  memory_candidates: [{ id: "m1", text: "合成待确认背景", evidence: [] }],
  action_candidates: [{ id: "a1", text: "合成行动建议", evidence: [] }],
};
it("真实阶段轮询完成后展示来源、推断、未知和待确认建议，不自动写入", async () => {
  const originalFetch = fetch;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url.endsWith("/runs"))
      return Promise.resolve(
        json({
          id: "r1",
          workspace_id: "synthetic-w",
          status: "queued",
          phase: "queued",
        }),
      );
    if (url.endsWith("/runs/r1"))
      return Promise.resolve(
        json({
          id: "r1",
          workspace_id: "synthetic-w",
          status: "succeeded",
          phase: "saving",
        }),
      );
    if (url.endsWith("/runs/r1/result"))
      return Promise.resolve(
        json({
          run_id: "r1",
          workspace_id: "synthetic-w",
          answer_id: "ans1",
          envelope: answer,
        }),
      );
    return originalFetch(url, init);
  });
  render(<FormalApp />);
  await startRun();
  // 生产轮询间隔为800ms；给并行测试下的渲染和请求留出余量。
  expect(await screen.findByText("合成有效结果", {}, {timeout:3000})).toBeInTheDocument();
  expect(screen.getByText("系统推断")).toBeInTheDocument();
  expect(await screen.findByText("尚无日期")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "查看来源 c1-1" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("申请截止日尚未确定");
  expect(screen.getByRole("dialog")).toHaveTextContent("第1段");
  expect(
    calls.some(
      (c) =>
        c.path.includes("/facts") ||
        c.path.includes("/actions") ||
        c.path.includes("/memories"),
    ),
  ).toBe(false);
});
it("取消运行只发一次取消请求并保留问题，失败重试必须重新预览", async () => {
  const originalFetch = fetch;
  let cancels = 0;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url.endsWith("/cancel")) {
      cancels++;
      return Promise.resolve(
        json({
          id: "r1",
          workspace_id: "synthetic-w",
          status: "cancelled",
          phase: "generating",
        }),
      );
    }
    if (url.endsWith("/runs"))
      return Promise.resolve(
        json({
          id: "r1",
          workspace_id: "synthetic-w",
          status: "running",
          phase: "generating",
        }),
      );
    if (url.endsWith("/runs/r1"))
      return Promise.resolve(
        json({
          id: "r1",
          workspace_id: "synthetic-w",
          status: "running",
          phase: "generating",
        }),
      );
    return originalFetch(url, init);
  });
  render(<FormalApp />);
  await startRun();
  fireEvent.click(await screen.findByRole("button", { name: "取消本次生成" }));
  expect(await screen.findByText("本次生成已取消")).toBeInTheDocument();
  expect(cancels).toBe(1);
  expect(screen.getByLabelText("本次问题")).toHaveValue("合成运行问题");
  expect(
    screen.queryByRole("button", { name: "开始本次理解" }),
  ).not.toBeInTheDocument();
});
it("修改目标后丢弃已在途的晚到结果", async () => {
  const originalFetch = fetch;
  let resolveResult: ((r: Response) => void) | undefined;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (url.endsWith("/runs"))
      return Promise.resolve(
        json({
          id: "r1",
          workspace_id: "synthetic-w",
          status: "succeeded",
          phase: "saving",
        }),
      );
    if (url.endsWith("/runs/r1/result"))
      return new Promise<Response>((resolve) => {
        resolveResult = resolve;
      });
    return originalFetch(url, init);
  });
  render(<FormalApp />);
  await startRun();
  await waitFor(() => expect(resolveResult).toBeDefined());
  fireEvent.change(screen.getByLabelText("本次目标"), {
    target: { value: "新目标" },
  });
  resolveResult!(
    json({
      run_id: "r1",
      workspace_id: "synthetic-w",
      answer_id: "ans1",
      envelope: answer,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByText("合成有效结果")).not.toBeInTheDocument();
});
it('首次理解不前置起草意图，默认请求只解释文件', async () => {
  render(<FormalApp />);
  await screen.findByLabelText('本次问题');
  expect(screen.queryByLabelText('本次请求')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'预览外发内容'}));
  expect(await screen.findByRole('button',{name:'开始本次理解'})).toBeInTheDocument();
  expect(calls.find(c=>c.path.endsWith('/context-preview'))?.body.kind).toBe('interpret');
  expect(calls.some(c=>c.path.endsWith('/runs'))).toBe(false);
});
beforeEach(() => {
  calls = [];
  expiresAt = new Date(Date.now() + 120000).toISOString();
  workspace = {
    id: "synthetic-w",
    title: "合成工作区",
    goal: "",
    status: "active",
    revision: 1,
    retention: "temporary",
    facts: [],
    documents: [
      {
        id: "synthetic-d",
        current_version_id: "synthetic-v",
        name: "合成通知.txt",
        parse_status: "ready",
        index_status: "not_indexed",
        retention: "temporary",
        revision: 1,
      },
    ],
  };
  window.history.replaceState(null, "", "/workspaces/synthetic-w");
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = url.replace("/api/v1", "");
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body });
    if (path === "/auth/me")
      return json({ id: "synthetic-u", display_name: "合成用户" });
    if (path === "/auth/csrf") return json({ csrf_token: "synthetic" });
    if (path === "/config")
      return json({
        storage_notice_version: "1",
        cos: { configured: false },
        generation: {
          configured: true,
          model: "合成模型",
          domain: "synthetic.example",
        },
        embedding: { configured: false },
      });
    if (path.endsWith("/segments"))
      return json({
        items: [
          {
            id: "s1",
            text: "合成原文：申请截止日尚未确定。",
            location: "第1段",
          },
        ],
        next_cursor: null,
      });
    if (path.endsWith("/messages"))
      return json({ items: [], next_cursor: null });
    if (path.endsWith("/context-preview"))
      return json({
        preview_id: "p1",
        manifest_hash: "hash",
        expires_at: expiresAt,
        manifest: {
          documents: [
            {
              document_id: "synthetic-d",
              document_version_id: "synthetic-v",
              name: "合成通知.txt",
              segments: [
                {
                  segment_id: "s1",
                  text: "合成原文：申请截止日尚未确定。",
                  location: "第1段",
                  char_start: 0,
                  char_end: 20,
                  content_hash: "hash",
                },
              ],
            },
          ],
          facts: workspace.facts,
          history: [],
          message: body.message,
          goal: workspace.goal,
          kind: body.kind,
          retrieval_mode: "fulltext",
          model: { domain: "synthetic.example", name: "合成模型" },
          coverage: "全文",
          character_counts: { total: 24 },
          estimated_tokens: 20,
        },
      });
    if (path.endsWith("/runs"))
      return Response.json(
        { error: { code: "NOT_IMPLEMENTED", message: "生成服务尚未接入" } },
        { status: 503 },
      );
    if (path.endsWith("/end")) return new Response(null, { status: 204 });
    if (path.includes("/facts")) {
      workspace = {
        ...workspace,
        revision: workspace.revision + 1,
        facts:
          method === "DELETE"
            ? []
            : [
                {
                  id: "f1",
                  version: 1,
                  text: body.text,
                  confirmed: true,
                  retention: "temporary",
                },
              ],
      };
      return json(workspace);
    }
    if (path === "/workspaces/synthetic-w") {
      if (method === "PATCH")
        workspace = { ...workspace, ...body, revision: workspace.revision + 1 };
      return json(workspace);
    }
    return json([]);
  });
});
it("标题修改使用工作区版本；未保存目标时不允许预览旧目标", async () => {
  render(<FormalApp />);
  fireEvent.click(await screen.findByRole("button", { name: "修改标题" }));
  fireEvent.change(screen.getByLabelText("工作区标题"), {
    target: { value: "新合成标题" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存标题" }));
  expect(
    await screen.findByRole("heading", { name: "新合成标题" }),
  ).toBeInTheDocument();
  expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
    title: "新合成标题",
    expected_revision: 1,
  });
  fireEvent.change(screen.getByLabelText("本次目标"), {
    target: { value: "尚未保存" },
  });
  fireEvent.change(screen.getByLabelText("本次问题"), {
    target: { value: "提问" },
  });
  expect(screen.getByRole("button", { name: "预览外发内容" })).toBeDisabled();
});
it("外发快照过期后拒绝生成，要求重新预览", async () => {
  expiresAt = new Date(Date.now() - 1000).toISOString();
  render(<FormalApp />);
  fireEvent.change(await screen.findByLabelText("本次问题"), {
    target: { value: "合成提问" },
  });
  fireEvent.click(screen.getByRole("button", { name: "预览外发内容" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "开始本次理解" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("外发预览已过期");
  expect(calls.some((c) => c.path.endsWith("/runs"))).toBe(false);
});
it("结束失败在确认弹窗中显示错误，保留临时工作区供重试", async () => {
  const originalFetch = fetch;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    url.endsWith("/end")
      ? Promise.resolve(
          Response.json(
            { error: { code: "UNAVAILABLE", message: "暂时无法结束本次" } },
            { status: 503 },
          ),
        )
      : originalFetch(url, init),
  );
  render(<FormalApp />);
  fireEvent.click(await screen.findByRole("button", { name: "结束本次" }));
  fireEvent.click(
    screen.getByRole("button", { name: "确认结束并清除临时内容" }),
  );
  expect(
    await within(screen.getByRole("dialog")).findByRole("alert"),
  ).toHaveTextContent("暂时无法结束本次");
  expect(
    screen.getByRole("heading", { name: "合成工作区" }),
  ).toBeInTheDocument();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("显示真实接口材料和空对话，未确认前不生成也不保留", async () => {
  render(<FormalApp />);
  expect(
    await screen.findByRole("heading", { name: "合成工作区" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "阅读 合成通知.txt" }));
  expect(
    await screen.findByText("合成原文：申请截止日尚未确定。"),
  ).toBeInTheDocument();
  expect(
    calls.some((c) => c.path.endsWith("/runs") || c.path.endsWith("/retain")),
  ).toBe(false);
});
it("目标修改携带版本且背景可跳过", async () => {
  render(<FormalApp />);
  fireEvent.change(await screen.findByLabelText("本次目标"), {
    target: { value: "判断是否适合我" },
  });
  fireEvent.click(screen.getByRole("button", { name: "更新目标" }));
  await waitFor(() =>
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({
      goal: "判断是否适合我",
      expected_revision: 1,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "跳过背景，直接提问" }));
  expect(screen.getByLabelText("本次问题")).toHaveFocus();
});
it("独立确认本次事实，可以更正和确认移除，不等于长期保存", async () => {
  render(<FormalApp />);
  fireEvent.change(await screen.findByLabelText("补充本次背景"), {
    target: { value: "合成背景" },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认属实，仅用于本次" }));
  expect(await screen.findByText("合成背景")).toBeInTheDocument();
  expect(calls.find((c) => c.path.endsWith("/facts"))?.body).toEqual({
    text: "合成背景",
    confirmed: true,
    expected_revision: 1,
  });
  fireEvent.click(screen.getByRole("button", { name: "修改背景" }));
  fireEvent.change(screen.getByLabelText("补充本次背景"), {
    target: { value: "更正背景" },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认属实，仅用于本次" }));
  expect(await screen.findByText("更正背景")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "移除背景" }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "确认移除",
    }),
  );
  await waitFor(() =>
    expect(screen.queryByText("更正背景")).not.toBeInTheDocument(),
  );
});
it("预览展示实际原文和目标，取消不发出生成请求，确认后失败明确呈现", async () => {
  render(<FormalApp />);
  fireEvent.change(await screen.findByLabelText("本次问题"), {
    target: { value: "合成提问" },
  });
  fireEvent.click(screen.getByRole("button", { name: "预览外发内容" }));
  const dialog = await screen.findByRole("dialog", { name: "开始理解前确认范围" });
  expect(dialog).toHaveTextContent("synthetic.example");
  expect(dialog).toHaveTextContent("合成原文：申请截止日尚未确定。");
  expect(calls.some((c) => c.path.endsWith("/runs"))).toBe(false);
  fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  fireEvent.click(screen.getByRole("button", { name: "预览外发内容" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "开始本次理解" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "生成服务尚未接入",
  );
  expect(calls.find((c) => c.path.endsWith("/runs"))?.body).toEqual({
    preview_id: "p1",
    manifest_hash: "hash",
    expected_revision: 1,
    consent_to_send: true,
  });
});
it("结束本次必须先确认，清除工作区缓存并返回文件空间", async () => {
  render(<FormalApp />);
  fireEvent.click(await screen.findByRole("button", { name: "结束本次" }));
  expect(calls.some((c) => c.path.endsWith("/end"))).toBe(false);
  fireEvent.click(
    screen.getByRole("button", { name: "确认结束并清除临时内容" }),
  );
  expect(
    await screen.findByRole("heading", { name: "文件空间" }),
  ).toBeInTheDocument();
  expect(calls.find((c) => c.path.endsWith("/end"))?.body).toEqual({
    expected_revision: 1,
  });
});

it("第二次创建运行失败时保留错误，不自动恢复上一轮成功来覆盖", async () => {
  const originalFetch = fetch;
  let created = 0;
  let completed = false;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.endsWith("/runs") && init?.method === "POST") {
      created++;
      if (created === 2) return Response.json({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "合成二轮创建失败" } }, { status: 503 });
      return json({ id: "r1", workspace_id: "synthetic-w", status: "succeeded", phase: "saving" });
    }
    if (url.endsWith("/runs/r1")) return json({ id: "r1", workspace_id: "synthetic-w", status: "succeeded", phase: "saving" });
    if (url.endsWith("/runs/r1/result")) {
      completed = true;
      return json({ run_id: "r1", workspace_id: "synthetic-w", answer_id: "a1", envelope: answer });
    }
    if (url.endsWith("/messages")) return json({ items: completed ? [{ id: "m1", role: "assistant", text: "合成上一轮", run_id: "r1" }] : [] });
    return originalFetch(url, init);
  });
  render(<FormalApp />);
  await startRun();
  expect(await screen.findByText("合成有效结果")).toBeInTheDocument();
  await screen.findByText("合成上一轮");
  await startRun();
  expect(await screen.findByRole("alert")).toHaveTextContent("合成二轮创建失败");
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(screen.getByRole("alert")).toHaveTextContent("合成二轮创建失败");
  expect(screen.queryByText("本次解读已完成")).not.toBeInTheDocument();
});
