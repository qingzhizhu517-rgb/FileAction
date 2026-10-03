import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "./api";

afterEach(() => vi.unstubAllGlobals());
describe("正式API客户端（仅HTTP合同替身）", () => {
  it("匿名登录失败后重新获取单次CSRF nonce", async () => {
    let nonces = 0;
    vi.stubGlobal("fetch", async (path: string) => {
      if (path.endsWith("/auth/csrf")) return Response.json({ data: { csrf_token: "synthetic-" + ++nonces } });
      return Response.json({ error: { code: "INVALID_CREDENTIALS", message: "账号或密码错误" } }, { status: 401 });
    });
    const client = new ApiClient();
    await expect(client.request("/auth/login", { method: "POST", body: {} })).rejects.toBeInstanceOf(ApiError);
    await expect(client.request("/auth/login", { method: "POST", body: {} })).rejects.toBeInstanceOf(ApiError);
    expect(nonces).toBe(2);
  });
  it("写请求先获取CSRF，携带Cookie并保留幂等key", async () => {
    const requests: { path: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
      requests.push({ path, init });
      return Response.json({
        data: path.endsWith("/auth/csrf")
          ? { csrf_token: "synthetic-csrf" }
          : { id: "run-1" },
        request_id: "synthetic-request",
      });
    });
    const result = await new ApiClient().request<{ id: string }>(
      "/workspaces/w/runs",
      {
        method: "POST",
        body: { consent_to_send: true },
        idempotencyKey: "synthetic-once",
      },
    );
    expect(result.id).toBe("run-1");
    expect(requests.map((r) => r.path)).toEqual([
      "/api/v1/auth/csrf",
      "/api/v1/workspaces/w/runs",
    ]);
    expect(requests[1].init?.credentials).toBe("same-origin");
    expect(new Headers(requests[1].init?.headers).get("X-CSRF-Token")).toBe(
      "synthetic-csrf",
    );
    expect(new Headers(requests[1].init?.headers).get("Idempotency-Key")).toBe(
      "synthetic-once",
    );
  });
  it("提交失败不会自动重放有副作用请求", async () => {
    let writes = 0;
    vi.stubGlobal("fetch", async (path: string) =>
      path.endsWith("/auth/csrf")
        ? Response.json({ data: { csrf_token: "synthetic-csrf" } })
        : (++writes,
          Response.json(
            {
              error: {
                code: "WORKSPACE_REVISION_CONFLICT",
                message: "内容已变化",
                request_id: "r1",
              },
            },
            { status: 409 },
          )),
    );
    await expect(
      new ApiClient().request("/workspaces/w", {
        method: "PATCH",
        body: { expected_revision: 1 },
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "WORKSPACE_REVISION_CONFLICT",
      requestId: "r1",
    });
    expect(writes).toBe(1);
  });
  it("HTML代理错误不会泄漏为产品正文", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("<html>internal secret exception</html>", { status: 502 }),
    );
    await expect(new ApiClient().request("/documents")).rejects.toBeInstanceOf(
      ApiError,
    );
    await expect(
      new ApiClient().request("/documents"),
    ).rejects.not.toMatchObject({ message: expect.stringContaining("secret") });
  });
  it("204响应不解析JSON，FormData保持浏览器boundary", async () => {
    let header: Headers | undefined;
    vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
      if (path.endsWith("/auth/csrf"))
        return Response.json({ data: { csrf_token: "synthetic-csrf" } });
      header = new Headers(init?.headers);
      return new Response(null, { status: 204 });
    });
    const form = new FormData();
    form.set("retention", "temporary");
    expect(
      await new ApiClient().request("/documents", {
        method: "POST",
        body: form,
      }),
    ).toBeUndefined();
    expect(header?.has("Content-Type")).toBe(false);
  });
});
