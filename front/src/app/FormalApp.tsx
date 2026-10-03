import { useCallback, useMemo, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  BrowserRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router";
import { Grid2X2, Layers, Package, Settings, LogOut } from "lucide-react";
import { ApiClient, ApiError } from "../shared/api";
import { Brand, ErrorNotice } from "../shared/ui";
import type { User } from "../shared/types";
import { SessionContext } from "./session";
import { AuthForm } from "../features/auth/AuthForm";
import { FilesPage } from "../features/files/FilesPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { WorkspacePage } from "../features/workspace/WorkspacePage";
import { ActionsPage } from "../features/actions/ActionsPage";
import { DeliverablesPage } from "../features/deliverables/DeliverablesPage";
import "./formal.css";
export function FormalApp() {
  const [cache] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 15_000,
            refetchOnWindowFocus: false,
          },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={cache}>
      <BrowserRouter>
        <Application cache={cache} />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
function Application({ cache }: { cache: QueryClient }) {
  const navigate = useNavigate();
  const [logoutError, setLogoutError] = useState<unknown>();
  const reset = useCallback(() => {
    void cache.cancelQueries();
    cache.clear();
    cache.setQueryData(["session"], null);
  }, [cache]);
  const api = useMemo(() => new ApiClient("/api/v1", reset), [reset]);
  const session = useQuery({
    queryKey: ["session"],
    queryFn: async ({ signal }) => {
      try {
        return await api.request<User>("/auth/me", { signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
  });
  if (session.isPending)
    return (
      <main className="loading-screen" role="status">
        正在检查登录状态…
      </main>
    );
  if (session.error)
    return (
      <main className="loading-screen">
        <Brand />
        <h1>服务尚未就绪</h1>
        <ErrorNotice
          error={session.error}
          retry={() => void session.refetch()}
        />
      </main>
    );
  if (!session.data)
    return (
      <Routes>
        <Route
          path="/login"
          element={
            <AuthForm
              api={api}
              onLogin={(user) => {
                cache.clear();
                cache.setQueryData(["session"], user);
                navigate("/files", { replace: true });
              }}
            />
          }
        />
        <Route
          path="/register"
          element={
            <AuthForm
              api={api}
              onLogin={(user) => cache.setQueryData(["session"], user)}
            />
          }
        />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  const user = session.data;
  async function logout() {
    try {
      await api.request("/auth/logout", { method: "POST" });
      reset();
      api.reset();
      navigate("/login", { replace: true });
    } catch (error) {
      setLogoutError(error);
    }
  }
  return (
    <SessionContext.Provider value={{ user, api, logout }}>
      <div className="formal-app">
        <header className="app-header">
          <Link className="brand-link" to="/files">
            <Brand />
          </Link>
          <nav aria-label="主导航">
            <NavLink to="/files">
              <Grid2X2 size={15} />
              文件空间
            </NavLink>
            <NavLink to="/actions">
              <Layers size={15} />
              我的行动
            </NavLink>
            <NavLink to="/deliverables">
              <Package size={15} />
              成果包
            </NavLink>
          </nav>
          <div className="account-nav">
            <Link aria-label="账号设置" to="/settings">
              <Settings size={18} />
            </Link>
            <span className="avatar" title={user.display_name}>
              {user.display_name.slice(0, 1)}
            </span>
            <button
              className="icon-button"
              aria-label="退出登录"
              onClick={() => void logout()}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        {logoutError != null && <ErrorNotice error={logoutError} />}
        <Routes>
          <Route path="/files" element={<FilesPage />} />
          <Route path="/workspaces/:id" element={<WorkspacePage />} />
          <Route path="/actions" element={<ActionsPage />} />
          <Route
            path="/deliverables"
            element={<DeliverablesPage />}
          />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/files" replace />} />
        </Routes>
      </div>
    </SessionContext.Provider>
  );
}
