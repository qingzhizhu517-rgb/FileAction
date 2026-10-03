import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FormalApp } from "../../app/FormalApp";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("只在本次工作区打开已保存成果，编辑时携带版本且保留模型原稿", async () => {
  // 合成HTTP合同测试，不代表模型输出质量。
  window.history.replaceState(null, "", "/workspaces/w-artifact");
  let artifact = { id: "artifact-1", workspace_id: "w-artifact", title: "合成材料清单", body: "合成模型原稿", version: 1, current_version: 1, revision: 1, author_kind: "model", retention: "temporary", validity: "current", historical: false, unknowns: [] };
  const patches: unknown[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const path = url.replace("/api/v1", ""); const data = (value: unknown) => Response.json({ data: value });
    if (path === "/auth/me") return data({ id: "artifact-u", display_name: "合成用户" });
    if (path === "/auth/csrf") return data({ csrf_token: "synthetic" });
    if (path === "/config") return data({ storage_notice_version: "1", cos: { configured: false },
      generation: { configured: true, model: "合成模型", domain: "synthetic.invalid" }, embedding: { configured: false } });
    if (path === "/workspaces/w-artifact") return data({ id: "w-artifact", title: "合成阅读", revision: 1, status: "active", documents: [], facts: [] });
    if (path === "/workspaces/w-artifact/artifacts") return data({ items: [artifact] });
    if (path === "/artifacts/artifact-1" && init?.method === "PATCH") {
      const body = JSON.parse(init.body as string); patches.push(body);
      artifact = { ...artifact, body: body.body, version: 2, current_version: 2, revision: 2, author_kind: "user" }; return data(artifact);
    }
    if (path === "/artifacts/artifact-1/versions") return data({ items: [artifact] });
    if (path.startsWith("/artifacts/artifact-1?version=")) return data(artifact);
    return data({ items: [], next_cursor: null });
  });
  render(<FormalApp />);
  fireEvent.click(await screen.findByRole("button", { name: "编辑与下载 合成材料清单" }));
  const editor = await screen.findByLabelText("成果正文");
  expect(editor).toHaveValue("合成模型原稿");
  fireEvent.change(editor, { target: { value: "合成用户修改后的清单" } });
  expect(screen.getByRole("button", { name: "下载此版本 Markdown" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "保存为新版本" }));
  await screen.findByText("v2 · 用户编辑");
  expect(patches).toEqual([{ expected_revision: 1, body: "合成用户修改后的清单" }]);
});
