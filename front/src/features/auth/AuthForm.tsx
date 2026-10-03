import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation } from "react-router";
import { ApiClient } from "../../shared/api";
import { Brand, ErrorNotice } from "../../shared/ui";
import type { User } from "../../shared/types";
type AuthOptions = {
  registration_enabled: boolean;
  demo: { username: string } | null;
};
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
  const [options, setOptions] = useState<AuthOptions>();
  const [personal, setPersonal] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const lock = useRef(false);
  const demo = !register && !personal ? options?.demo : null;
  useEffect(() => {
    const controller = new AbortController();
    void api.request<AuthOptions>("/auth/options", { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setOptions(value); })
      .catch(() => { /* 普通账号仍可使用现有登录接口。 */ });
    return () => controller.abort();
  }, [api]);
  useEffect(() => {
    setCreated(false);
    setError(undefined);
    setUsername("");
    setPassword("");
    setDisplayName("");
    setPersonal(false);
  }, [register]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (register && !created) {
        await api.request("/auth/register", {
          method: "POST",
          body: {
            username,
            password,
            display_name: displayName,
          },
        });
        setCreated(true);
      }
      const result = await api.request<{ user: User }>(demo ? "/auth/demo-login" : "/auth/login", {
        method: "POST",
        ...(demo ? {} : { body: { username, password } }),
      });
      api.reset();
      setPassword("");
      onLogin(result.user);
    } catch (e) {
      setError(e);
    } finally {
      lock.current = false;
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
        <h2>{register ? "创建你的文启账号" : demo ? "快速体验文启" : "欢迎回来"}</h2>
        <p>
          {register
            ? "每个账号拥有独立的文件与工作区。"
            : demo ? "管理员体验已就绪，也可以使用自己的账号。" : "登录，继续属于你的下一步。"}
        </p>
        {created && <p role="status">账号已创建{busy ? "，正在进入文件空间…" : "，请继续登录，无需再次注册。"}</p>}
        {register && options?.registration_enabled === false && <p role="status">当前未开放注册，请使用已有账号登录。</p>}
          <form onSubmit={submit}>
            {register && (
              <label>
                显示名
                <input
                  name="display_name"
                  autoComplete="nickname"
                  maxLength={40}
                  required
                  value={displayName}
                  disabled={busy || created}
                  onChange={(event) => setDisplayName(event.target.value)}
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
                pattern="[A-Za-z0-9_.\-]{3,32}"
                aria-describedby={register ? "username-format" : undefined}
                value={demo?.username ?? username}
                readOnly={Boolean(demo) || created}
                disabled={busy}
                onChange={(event) => { setPersonal(true); setUsername(event.target.value); }}
                required
              />
            </label>
            {register && <small id="username-format">3–32 位字母、数字、下划线、点或短横线</small>}
            <label>
              密码
              <input
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                minLength={register ? 12 : undefined}
                maxLength={128}
                value={password}
                placeholder={demo ? "体验密码已由服务端配置" : undefined}
                disabled={busy || Boolean(demo)}
                onChange={(event) => { setPersonal(true); setPassword(event.target.value); }}
                required={!demo}
              />
            </label>
            {register && <small>密码12–128字符；支持粘贴与密码管理器。</small>}
            {error != null && <ErrorNotice error={error} />}
            <button className="primary" disabled={busy || (register && !created && options?.registration_enabled === false)}>
              {busy ? "请稍候…" : demo ? "进入管理员体验" : created ? "登录并继续" : register ? "注册并进入" : "登录"}
            </button>
            {demo && <button type="button" disabled={busy} onClick={() => setPersonal(true)}>使用个人账号</button>}
          </form>
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
        <small>上传文件后开始阅读，发送给模型前会说明使用范围。</small>
      </section>
    </main>
  );
}
