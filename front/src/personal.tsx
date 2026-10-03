// 复用 main 的真实账号界面，登录成功进入 src/ 的文件 Agent。
import "./app/formal.css";
import "./features/home/entry.css";
import "./personal.css";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, Navigate } from "react-router";
import { ApiClient, ApiError } from "./shared/api";
import { AuthForm } from "./features/auth/AuthForm";
import { ErrorNotice } from "./shared/ui";
import type { User } from "./shared/types";

const api = new ApiClient();
function Entry() {
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    const controller = new AbortController();
    void api
      .request<User>("/auth/me", { signal: controller.signal })
      .then(() => window.location.replace("/files"))
      .catch((e) => {
        if (controller.signal.aborted) return;
        if (!(e instanceof ApiError && e.status === 401)) setError(e);
        setPending(false);
      });
    return () => controller.abort();
  }, []);
  if (pending)
    return (
      <main className="loading-screen" role="status">
        正在检查登录状态…
      </main>
    );
  if (error)
    return (
      <main className="loading-screen">
        <ErrorNotice error={error} retry={() => window.location.reload()} />
        <a href="/intro/">返回首页</a>
      </main>
    );
  const form = (
    <AuthForm api={api} onLogin={() => window.location.replace("/files")} />
  );
  return (
    <>
      <a className="entry-back entry-auth-back" href="/intro/">
        ← 返回首页
      </a>
      <Routes>
        <Route path="/login" element={form} />
        <Route path="/register" element={form} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Entry />
    </BrowserRouter>
  </StrictMode>,
);
