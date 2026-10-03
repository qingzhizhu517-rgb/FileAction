import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FormalApp } from "./FormalApp";

const user = {
  id: "synthetic-user-1",
  username: "synthetic",
  display_name: "合成账号",
  revision: 1,
};
const json = (data: unknown) =>
  Response.json({ data, request_id: "synthetic" });
beforeEach(() => {
  window.history.replaceState(null, "", "/files");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("未登录仅显示登录页，错误后可重新提交且密码不持久化", async () => {
  vi.stubGlobal("fetch", async (path: string) => {
    if (path.endsWith("/auth/csrf")) return json({ csrf_token: "synthetic" });
    return Response.json(
      { error: { code: "INVALID_CREDENTIALS", message: "账号或密码错误" } },
      { status: 401 },
    );
  });
  render(<FormalApp />);
  fireEvent.change(await screen.findByLabelText("账号"), {
    target: { value: "synthetic" },
  });
  fireEvent.change(screen.getByLabelText("密码"), {
    target: { value: "synthetic-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "登录" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("账号或密码错误");
  expect(screen.getByRole("button", { name: "登录" })).toBeEnabled();
  expect(localStorage.length).toBe(0);
});
it("空账号没有原型演示资料，上传默认临时且失败时保留选择", async () => {
  let sent: FormData | undefined;
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    if (path.endsWith("/auth/me")) return json(user);
    if (path.endsWith("/auth/csrf")) return json({ csrf_token: "synthetic" });
    if (path.endsWith("/config"))
      return json({
        storage_notice_version: "1",
        cos: { region: "未配置", configured: false },
      });
    if (init?.method === "POST") {
      sent = init.body as FormData;
      return Response.json(
        {
          error: {
            code: "DEPENDENCY_UNAVAILABLE",
            message: "临时存储暂不可用",
          },
        },
        { status: 503 },
      );
    }
    return json([]);
  });
  render(<FormalApp />);
  expect(await screen.findByText("还没有保存的文件")).toBeInTheDocument();
  expect(screen.queryByText("林同学")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "上传文件" }));
  await userEvent.upload(
    screen.getByLabelText("选择文件"),
    new File(["合成通知"], "合成.txt", { type: "text/plain" }),
  );
  // jsdom does not update native file validity; browser tests cover the actual click.
  fireEvent.submit(
    screen.getByRole("button", { name: "开始上传" }).closest("form")!,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "临时存储暂不可用",
  );
  expect(sent?.get("retention")).toBe("temporary");
  expect(sent?.get("consent_to_store")).toBe("false");
  expect(screen.getByRole("button", { name: "开始上传" })).toBeEnabled();
});
it("退出后移除账号内存缓存和文件内容", async () => {
  let loggedIn = true;
  vi.stubGlobal("fetch", async (path: string) => {
    if (path.endsWith("/auth/me"))
      return loggedIn ? json(user) : new Response(null, { status: 401 });
    if (path.endsWith("/auth/csrf")) return json({ csrf_token: "synthetic" });
    if (path.endsWith("/auth/logout")) {
      loggedIn = false;
      return new Response(null, { status: 204 });
    }
    if (path.endsWith("/config")) return json({});
    return json([
      {
        id: "synthetic-document",
        name: "合成私有文件",
        revision: 1,
        retention: "retained",
        parse_status: "ready",
        index_status: "not_indexed",
      },
    ]);
  });
  render(<FormalApp />);
  expect(await screen.findByText("合成私有文件")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
  await waitFor(() =>
    expect(screen.queryByText("合成私有文件")).not.toBeInTheDocument(),
  );
  expect(
    await screen.findByRole("button", { name: "登录" }),
  ).toBeInTheDocument();
});
