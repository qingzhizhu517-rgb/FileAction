export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
  ) {
    super(message);
  }
}
type Options = {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  idempotencyKey?: string;
  binary?: boolean;
};
export class ApiClient {
  private csrf?: string;
  constructor(
    private base = "/api/v1",
    private onUnauthorized?: () => void,
  ) {}
  reset() {
    this.csrf = undefined;
  }
  async request<T = void>(path: string, options: Options = {}): Promise<T> {
    if (!path.startsWith("/") || path.startsWith("//"))
      throw new Error("无效的API路径");
    const method = options.method ?? "GET";
    const headers = new Headers({
      Accept: options.binary ? "application/octet-stream" : "application/json",
    });
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      if (!this.csrf)
        this.csrf = (
          await this.request<{ csrf_token: string }>("/auth/csrf", {
            signal: options.signal,
          })
        ).csrf_token;
      if (!this.csrf)
        throw new ApiError(
          503,
          "CSRF_UNAVAILABLE",
          "无法建立安全会话，请重试。",
        );
      headers.set("X-CSRF-Token", this.csrf);
    }
    let body: BodyInit | undefined;
    if (options.body instanceof FormData) body = options.body;
    else if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }
    if (options.idempotencyKey)
      headers.set("Idempotency-Key", options.idempotencyKey);
    // Anonymous nonce is consumed by an attempted login/register, even on failure.
    if (method === "POST" && ["/auth/login", "/auth/register"].includes(path))
      this.reset();
    let response: Response;
    try {
      response = await fetch(this.base + path, {
        method,
        headers,
        body,
        credentials: "same-origin",
        signal: options.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        throw error;
      throw new ApiError(
        0,
        "NETWORK_UNAVAILABLE",
        "无法连接服务，请检查后端是否已启动。",
      );
    }
    if (response.status === 204) return undefined as T;
    if (response.ok && options.binary) return (await response.blob()) as T;
    let payload: {
      data?: T;
      error?: { code?: string; message?: string; request_id?: string };
    };
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
    if (!response.ok) {
      if (response.status === 401 && !path.startsWith("/auth/")) {
        this.reset();
        this.onUnauthorized?.();
      }
      if (response.status === 403) this.reset();
      throw new ApiError(
        response.status,
        payload.error?.code ?? "SERVICE_UNAVAILABLE",
        payload.error?.message ?? "服务暂不可用，请稍后重试。",
        payload.error?.request_id,
      );
    }
    if (!("data" in payload))
      throw new ApiError(502, "INVALID_RESPONSE", "服务返回格式不正确。");
    return payload.data as T;
  }
}
export function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : "操作失败，请重试。";
}
export function items<T>(value: T[] | { items?: T[] } | undefined): T[] {
  return Array.isArray(value) ? value : (value?.items ?? []);
}
