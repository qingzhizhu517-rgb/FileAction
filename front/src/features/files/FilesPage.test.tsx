import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FormalApp } from "../../app/FormalApp";

vi.mock("../workspace/WorkspacePage", () => ({
  WorkspacePage: () => <h1>真实工作区页面</h1>,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("最近继续直接打开现有会话，默认以列表浏览保存文件", async () => {
  window.history.replaceState(null, "", "/files");
  const writes: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") writes.push(url);
    return Response.json({ data: url.endsWith("/auth/me") ? { id: "recent-test", display_name: "合成" } :
      url.endsWith("/workspaces/temporary") ? [{ id: "existing", title: "合成最近会话", status: "active" }] : [] });
  });
  render(<FormalApp />);
  const recent = await screen.findByRole("region", { name: "最近继续" });
  expect(screen.getByRole("button", { name: "列表视图" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(within(recent).getByRole("link", { name: /合成最近会话/ }));
  expect(await screen.findByText("真实工作区页面")).toBeInTheDocument();
  expect(window.location.pathname).toBe("/workspaces/existing");
  expect(writes).toEqual([]);
});

it("拖入文件只打开已选文件的确认层，取消不上传", async () => {
  window.history.replaceState(null, "", "/files");
  const writes: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") writes.push(url);
    return Response.json({ data: url.endsWith("/auth/me") ? { id: "drop-test", display_name: "合成" } :
      url.endsWith("/config") ? { storage_notice_version: "1", cos: { configured: true } } : [] });
  });
  render(<FormalApp />);
  const dropzone = await screen.findByRole("region", { name: "上传一份文件" });
  fireEvent.drop(dropzone, { dataTransfer: { files: [new File(["合成测试"], "合成拖入.txt", { type: "text/plain" })] } });
  expect(await screen.findByText("已选择：合成拖入.txt")).toBeInTheDocument();
  expect(writes).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(writes).toEqual([]);
});

it("选择文件后显示文件名和确认提示，确认前不上传", async () => {
  window.history.replaceState(null, "", "/files");
  const uploads: unknown[] = [];
  vi.stubGlobal("fetch", async (url: string, options?: RequestInit) => {
    let data: unknown = {};
    if (url.endsWith("/config")) data = { storage_notice_version: "1", cos: { configured: true, region: "ap-beijing" } };
    else if (url.endsWith("/auth/me"))
      data = {
        id: "synthetic-upload",
        username: "synthetic",
        display_name: "合成",
        revision: 1,
      };
    else if (url.includes("/documents")) {
      if (options?.method === "POST") uploads.push(options.body);
      data = { items: [], next_cursor: null, has_more: false, total: 0 };
    }
    return Response.json({ data, request_id: "synthetic" });
  });
  render(<FormalApp />);
  fireEvent.click(await screen.findByRole("button", { name: /上传并理解/ }));
  expect(screen.getByRole("button", { name: "开始上传" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("选择文件", { exact: true }), {
    target: {
      files: [new File(["合成资料"], "合成通知.txt", { type: "text/plain" })],
    },
  });
  expect(screen.getByText("已选择：合成通知.txt")).toBeInTheDocument();
  expect(
    screen.getByText("点击“开始上传”，保存到文件空间并开始阅读。"),
  ).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "开始上传" })).toBeEnabled());
  expect(uploads).toHaveLength(0);
  expect(screen.queryByRole("radio")).not.toBeInTheDocument();
});

it("显示服务器总数并沿游标加载剩余文件，搜索发送到服务端", async () => {
  window.history.replaceState(null, "", "/files");
  const requests: string[] = [];
  const document = (id: string, name: string) => ({
    id,
    name,
    retention: "retained",
    revision: 1,
    parse_status: "ready",
    index_status: "not_requested",
    category: "notice",
  });
  vi.stubGlobal("fetch", async (url: string) => {
    requests.push(url);
    let data: unknown = [];
    if (url.endsWith("/auth/me"))
      data = {
        id: "synthetic",
        username: "synthetic",
        display_name: "合成",
        revision: 1,
      };
    else if (url.includes("/documents")) {
      const query = new URL(url, "http://synthetic.local").searchParams;
      data = query.has("cursor")
        ? {
            items: [document("two", "合成第二页.txt")],
            next_cursor: null,
            has_more: false,
            total: 2,
          }
        : {
            items: [document("one", "合成第一页.txt")],
            next_cursor: "synthetic-signed-cursor",
            has_more: true,
            total: 2,
          };
    }
    return Response.json({ data, request_id: "synthetic" });
  });
  render(<FormalApp />);
  expect(await screen.findByText("合成第一页.txt")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
  expect(await screen.findByText("合成第二页.txt")).toBeInTheDocument();
  expect(
    requests.some((url) => url.includes("cursor=synthetic-signed-cursor")),
  ).toBe(true);
  fireEvent.change(screen.getByPlaceholderText("搜索文件…"), {
    target: { value: "第二页" },
  });
  await vi.waitFor(() =>
    expect(requests.some((url) => url.includes("q="))).toBe(true),
  );
});

it("文件默认聚焦阅读，索引、版本和删除操作按需展开", async () => {
  window.history.replaceState(null, "", "/files");
  vi.stubGlobal("fetch", async (url: string) =>
    Response.json({
      data: url.endsWith("/auth/me")
        ? { id: "synthetic", display_name: "合成" }
        : url.endsWith("/documents")
          ? [
              {
                id: "one",
                name: "合成通知.txt",
                revision: 1,
                retention: "retained",
                parse_status: "ready",
                index_status: "not_requested",
              },
            ]
          : [],
      request_id: "synthetic",
    }),
  );
  render(<FormalApp />);
  expect(
    await screen.findByRole("button", { name: "读懂这份文件" }),
  ).toBeVisible();
  const management = screen.getByText("文件管理").closest("details");
  expect(management).not.toHaveAttribute("open");
  expect(screen.getByText("管理语义索引")).not.toBeVisible();
  fireEvent.click(screen.getByText("文件管理"));
  expect(screen.getByText("管理语义索引")).toBeVisible();
});
it("上传保存到文件空间，不让用户选择存储方式且不自动向模型发送", async () => {
  window.history.replaceState(null, "", "/files");
  const writes: { url: string; body: unknown }[] = [];
  const doc = {
    id: "synthetic-document",
    name: "合成通知.txt",
    revision: 1,
    retention: "retained",
    parse_status: "ready",
    index_status: "not_requested",
  };
  vi.stubGlobal("fetch", async (url: string, options?: RequestInit) => {
    let data: unknown = [];
    if (url.endsWith("/auth/me"))
      data = { id: "synthetic", display_name: "合成" };
    if (url.endsWith("/auth/csrf")) data = { csrf_token: "synthetic" };
    if (url.endsWith("/config")) data = { storage_notice_version: "1", cos: { configured: true, region: "ap-beijing" } };
    if (options?.method === "POST") {
      writes.push({ url, body: options.body });
      data = url.endsWith("/documents")
        ? doc
        : { id: "synthetic-workspace", documents: [doc], facts: [] };
    }
    return Response.json({ data, request_id: "synthetic" });
  });
  render(<FormalApp />);
  fireEvent.click(await screen.findByRole("button", { name: /上传并理解/ }));
  fireEvent.change(screen.getByLabelText("选择文件", { exact: true }), {
    target: {
      files: [new File(["合成通知"], "合成通知.txt", { type: "text/plain" })],
    },
  });
  await waitFor(() => expect(screen.getByRole("button", { name: "开始上传" })).toBeEnabled());
  fireEvent.submit(
    screen.getByRole("button", { name: "开始上传" }).closest("form")!,
  );
  expect(await screen.findByText("真实工作区页面")).toBeInTheDocument();
  await waitFor(() =>
    expect(window.location.pathname).toBe("/workspaces/synthetic-workspace"),
  );
  expect(writes.map((write) => write.url)).toEqual([
    "/api/v1/documents",
    "/api/v1/workspaces",
  ]);
  expect((writes[0].body as FormData).get("retention")).toBe("retained");
  expect((writes[0].body as FormData).get("consent_to_store")).toBe("true");
  expect(JSON.parse(writes[1].body as string)).toEqual({
    primary_document_id: "synthetic-document",
    retention: "temporary",
  });
});

it("示例入口先展示合成角色和保存说明，取消不上传也不调用模型", async () => {
  window.history.replaceState(null, "", "/files");
  const writes: string[] = [];
  vi.stubGlobal("fetch", async (url: string, options?: RequestInit) => {
    if (options?.method === "POST") writes.push(url);
    return Response.json({ data: url.endsWith("/auth/me") ? { id: "synthetic", display_name: "合成" } : [] });
  });
  render(<FormalApp />);
  fireEvent.click(await screen.findByRole("button", { name: "体验预设场景" }));
  expect(screen.getByRole("dialog", { name: "开始一段示例体验" })).toBeInTheDocument();
  expect(screen.getByText(/合成角色，仅用于本次体验/)).toBeInTheDocument();
  expect(screen.getByText(/文件会保存到你的文件空间/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(writes).toHaveLength(0);
});
