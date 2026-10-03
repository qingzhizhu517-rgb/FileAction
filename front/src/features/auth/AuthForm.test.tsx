import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClient } from "../../shared/api";
import { AuthForm } from "./AuthForm";

const user = { id: "synthetic-user", username: "synthetic", display_name: "合成用户", revision: 1 };
const json = (data: unknown) => Response.json({ data });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(path = "/login") {
  const onLogin = vi.fn();
  render(<MemoryRouter initialEntries={[path]}><AuthForm api={new ApiClient()} onLogin={onLogin} /></MemoryRouter>);
  return onLogin;
}
function fillRegistration() {
  fireEvent.change(screen.getByLabelText("显示名"), { target: { value: "合成用户" } });
  fireEvent.change(screen.getByLabelText("账号"), { target: { value: "synthetic" } });
  fireEvent.change(screen.getByLabelText("密码"), { target: { value: "synthetic-long-password" } });
}
it("注册成功后使用新账号登录并进入文件空间", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (path: string) => {
    calls.push(path);
    if (path.endsWith("/options")) return json({ registration_enabled: true, demo: null });
    if (path.endsWith("/csrf")) return json({ csrf_token: "synthetic-token" });
    if (path.endsWith("/register")) return json(user);
    return json({ user });
  });
  const onLogin = mount("/register");
  fillRegistration();
  fireEvent.submit(screen.getByLabelText("账号").closest("form")!);
  await waitFor(() => expect(onLogin).toHaveBeenCalledWith(user));
  expect(calls.filter(path => path.endsWith("/csrf"))).toHaveLength(2);
  expect(calls.indexOf("/api/v1/auth/register")).toBeLessThan(calls.indexOf("/api/v1/auth/login"));
});
it("注册已成功但登录失败时重试登录，不重复注册", async () => {
  let registrations = 0;
  let logins = 0;
  vi.stubGlobal("fetch", async (path: string) => {
    if (path.endsWith("/options")) return json({ registration_enabled: true, demo: null });
    if (path.endsWith("/csrf")) return json({ csrf_token: "synthetic-token" });
    if (path.endsWith("/register")) { registrations++; return json(user); }
    if (++logins === 1) return Response.json({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "登录服务暂不可用" } }, { status: 503 });
    return json({ user });
  });
  const onLogin = mount("/register");
  fillRegistration();
  fireEvent.submit(screen.getByLabelText("账号").closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent("登录服务暂不可用");
  expect(screen.getByRole("status")).toHaveTextContent("账号已创建");
  fireEvent.click(screen.getByRole("button", { name: "登录并继续" }));
  await waitFor(() => expect(onLogin).toHaveBeenCalledWith(user));
  expect(registrations).toBe(1);
});
it("显式启用的体验入口预填账号，真实密码不返回浏览器", async () => {
  const requests: { path: string; body?: BodyInit | null }[] = [];
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    requests.push({ path, body: init?.body });
    if (path.endsWith("/options")) return json({ registration_enabled: true, demo: { username: "admin" } });
    if (path.endsWith("/csrf")) return json({ csrf_token: "synthetic-token" });
    return json({ user });
  });
  const onLogin = mount();
  await screen.findByRole("button", { name: "进入管理员体验" });
  expect(screen.getByLabelText("账号")).toHaveValue("admin");
  expect(screen.getByLabelText("密码")).toHaveAttribute("placeholder", "体验密码已由服务端配置");
  expect(screen.getByLabelText("密码")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "进入管理员体验" }));
  await waitFor(() => expect(onLogin).toHaveBeenCalledWith(user));
  expect(requests.find(item => item.path.endsWith("/demo-login"))?.body).toBeUndefined();
  expect(localStorage.length).toBe(0);
});
it("切换个人账号后输入为空且不再使用体验登录", async () => {
  vi.stubGlobal("fetch", async () => json({ registration_enabled: true, demo: { username: "admin" } }));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "使用个人账号" }));
  expect(screen.getByLabelText("账号")).toHaveValue("");
  expect(screen.getByLabelText("密码")).toBeEnabled();
  expect(screen.getByRole("button", { name: "登录" })).toBeInTheDocument();
});
it("注册页不填入体验账号，明确说明账号格式", async () => {
  vi.stubGlobal("fetch", async () => json({ registration_enabled: true, demo: { username: "admin" } }));
  mount("/register");
  expect(screen.getByLabelText("账号")).toHaveValue("");
  expect(screen.getByText("3–32 位字母、数字、下划线、点或短横线")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "进入管理员体验" })).not.toBeInTheDocument();
});
