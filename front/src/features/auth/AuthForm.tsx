import { useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router";
import { ApiClient } from "../../shared/api";
import { Brand, ErrorNotice } from "../../shared/ui";
import type { User } from "../../shared/types";
export function AuthForm({
  api,
  onLogin,
}: {
  api: ApiClient;
  onLogin: (user: User) => void;
}) {
  const register = useLocation().pathname === "/register";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [created, setCreated] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      if (register) {
        await api.request("/auth/register", {
          method: "POST",
          body: {
            username: data.get("username"),
            password: data.get("password"),
            display_name: data.get("display_name"),
          },
        });
        setCreated(true);
      } else {
        const result = await api.request<{ user: User }>("/auth/login", {
          method: "POST",
          body: {
            username: data.get("username"),
            password: data.get("password"),
          },
        });
        api.reset();
        onLogin(result.user);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-screen">
      <section className="auth-story">
        <Brand />
        <p className="eyebrow">YOUR NEXT MOVE</p>
        <h1>
          收到文件，
          <br />
          先交给文启。
        </h1>
        <p>
          理解当下的意义，整理可以采取的下一步。
          <br />
          你的文件与背景，由你决定是否保留。
        </p>
        <div className="auth-art" aria-hidden="true">
          <div className="auth-file">
            一份新的文件<small>理解 · 关联 · 下一步</small>
          </div>
          <span>✦</span>
        </div>
      </section>
      <section className="auth-card">
        <h2>{register ? "创建你的文启账号" : "欢迎回来"}</h2>
        <p>
          {register
            ? "每个账号拥有独立的文件与工作区。"
            : "登录，继续属于你的下一步。"}
        </p>
        {created ? (
          <div role="status">
            账号已创建。
            <Link to="/login" onClick={() => setCreated(false)}>
              前往登录
            </Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            {register && (
              <label>
                显示名
                <input
                  name="display_name"
                  autoComplete="nickname"
                  maxLength={40}
                  required
                />
              </label>
            )}
            <label>
              账号
              <input
                name="username"
                autoComplete="username"
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9_.-]{3,32}"
                required
              />
            </label>
            <label>
              密码
              <input
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                minLength={register ? 12 : undefined}
                maxLength={128}
                required
              />
            </label>
            {register && <small>密码12–128字符；支持粘贴与密码管理器。</small>}
            {error != null && <ErrorNotice error={error} />}
            <button className="primary" disabled={busy}>
              {busy ? "请稍候…" : register ? "注册" : "登录"}
            </button>
          </form>
        )}
        <p className="auth-switch">
          <Link
            to={register ? "/login" : "/register"}
            onClick={() => {
              setError(undefined);
              setCreated(false);
            }}
          >
            {register ? "已有账号，返回登录" : "没有账号？创建账号"}
          </Link>
        </p>
        <small>文件上传、云端保存与模型外发分别确认。</small>
      </section>
    </main>
  );
}
