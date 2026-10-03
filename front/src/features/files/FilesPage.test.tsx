import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FormalApp } from "../../app/FormalApp";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("选择文件后显示文件名和确认提示，确认前不上传", async () => {
  window.history.replaceState(null, "", "/files");
  const uploads: unknown[] = [];
  vi.stubGlobal("fetch", async (url: string, options?: RequestInit) => {
    let data: unknown = {};
    if (url.endsWith("/auth/me")) data = { id: "synthetic-upload", username: "synthetic", display_name: "合成", revision: 1 };
    else if (url.includes("/documents")) {
      if (options?.method === "POST") uploads.push(options.body);
      data = { items: [], next_cursor: null, has_more: false, total: 0 };
    }
    return Response.json({ data, request_id: "synthetic" });
  });
  render(<FormalApp />);
  fireEvent.click(await screen.findByRole("button", { name: "上传文件" }));
  expect(screen.getByRole("button", { name: "开始上传" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("选择文件", { exact: true }), {
    target: { files: [new File(["合成资料"], "合成通知.txt", { type: "text/plain" })] },
  });
  expect(screen.getByText("已选择：合成通知.txt")).toBeInTheDocument();
  expect(screen.getByText("确认使用方式后，点击下方“开始上传”。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "开始上传" })).toBeEnabled();
  expect(uploads).toHaveLength(0);
});

it("显示服务器总数并沿游标加载剩余文件，搜索发送到服务端", async () => {
  window.history.replaceState(null, "", "/files");
  const requests: string[] = [];
  const document = (id: string, name: string) => ({
    id, name, retention: "retained", revision: 1, parse_status: "ready",
    index_status: "not_requested", category: "notice",
  });
  vi.stubGlobal("fetch", async (url: string) => {
    requests.push(url);
    let data: unknown = [];
    if (url.endsWith("/auth/me")) data = { id: "synthetic", username: "synthetic", display_name: "合成", revision: 1 };
    else if (url.includes("/documents")) {
      const query = new URL(url, "http://synthetic.local").searchParams;
      data = query.has("cursor")
        ? { items: [document("two", "合成第二页.txt")], next_cursor: null, has_more: false, total: 2 }
        : { items: [document("one", "合成第一页.txt")], next_cursor: "synthetic-signed-cursor", has_more: true, total: 2 };
    }
    return Response.json({ data, request_id: "synthetic" });
  });
  render(<FormalApp />);
  expect(await screen.findByText("合成第一页.txt")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
  expect(await screen.findByText("合成第二页.txt")).toBeInTheDocument();
  expect(requests.some(url => url.includes("cursor=synthetic-signed-cursor"))).toBe(true);
  fireEvent.change(screen.getByPlaceholderText("搜索文件…"), { target: { value: "第二页" } });
  await vi.waitFor(() => expect(requests.some(url => url.includes("q="))).toBe(true));
});
