import { expect, test } from "@playwright/test";
// 合成HTTP合同测试，不是实际模型或持久化服务验收。
for (const width of [390, 768, 1440]) {
  test("临时工作区实际浏览器交互与外发确认 " + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    let generated = 0;
    let cancelled = false;
    const w = {
      id: "synthetic-w",
      title: "合成通知工作区",
      goal: "理解申请要求",
      revision: 1,
      retention: "temporary",
      status: "active",
      facts: [],
      documents: [
        {
          id: "d1",
          current_version_id: "v1",
          name: "合成通知.txt",
          parse_status: "ready",
          retention: "temporary",
          revision: 1,
        },
      ],
    };
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname.replace(
        "/api/v1",
        "",
      );
      const data = (value: unknown) => route.fulfill({ json: { data: value } });
      if (path === "/auth/me")
        return data({ id: "u1", display_name: "合成账号" });
      if (path === "/auth/csrf") return data({ csrf_token: "test" });
      if (path.endsWith("/segments"))
        return data([
          { id: "s1", text: "合成原文：材料要求尚待确认。", location: "第1段" },
        ]);
      if (path.endsWith("/messages"))
        return data({ items: [], next_cursor: null });
      if (path.endsWith("/context-preview")) {
        const body = route.request().postDataJSON();
        expect(body.retrieval_mode).toBe("full_text");
        return data({
          preview_id: "p1",
          manifest_hash: "h1",
          expires_at: new Date(Date.now() + 120000).toISOString(),
          manifest: {
            documents: [
              {
                document_id: "d1",
                document_version_id: "v1",
                name: "合成通知.txt",
                segments: [
                  {
                    segment_id: "s1",
                    text: "合成原文：材料要求尚待确认。",
                    location: "第1段",
                  },
                ],
              },
            ],
            facts: [],
            history: [],
            goal: w.goal,
            message: body.message,
            model: { domain: "synthetic.example", name: "合成合同模型" },
            coverage: "全文",
            estimated_tokens: 30,
          },
        });
      }
      if (path.endsWith("/runs")) {
        generated++;
        if (generated === 1)
          return route.fulfill({
            status: 503,
            json: { error: { code: "MODEL_FAILED", message: "合成模型失败" } },
          });
        return data({
          id: "r" + generated,
          workspace_id: w.id,
          status: "queued",
          phase: "queued",
        });
      }
      if (path.endsWith("/cancel")) {
        cancelled = true;
        return data({
          id: "r2",
          workspace_id: w.id,
          status: "cancelled",
          phase: "generating",
        });
      }
      if (path === "/runs/r2")
        return data({
          id: "r2",
          workspace_id: w.id,
          status: cancelled ? "cancelled" : "running",
          phase: "generating",
        });
      if (path === "/runs/r3")
        return data({
          id: "r3",
          workspace_id: w.id,
          status: "succeeded",
          phase: "saving",
        });
      if (path === "/runs/r3/result")
        return data({
          run_id: "r3",
          workspace_id: w.id,
          answer_id: "a3",
          envelope: {
            summary: "合成结果：先核对材料要求",
            claims: [
              {
                id: "c1",
                text: "材料要求尚待确认",
                kind: "document_fact",
                evidence: [
                  {
                    type: "document",
                    document_id: "d1",
                    version: "v1",
                    segment_id: "s1",
                    quote: "材料要求尚待确认",
                    location: "第1段",
                  },
                ],
              },
            ],
            unknowns: ["未提供资格要求"],
            questions: ["是否需要补充背景？"],
            memory_candidates: [],
            action_candidates: [],
            coverage: "full_selected_text",
            artifact: null,
          },
        });
      if (path === "/workspaces/synthetic-w") return data(w);
      return data([]);
    });
    await page.goto("/workspaces/synthetic-w");
    await expect(page.getByRole("heading", { name: w.title })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "阅读 合成通知.txt" }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "合成原文：材料要求尚待确认。",
    );
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "跳过背景，直接提问" }).click();
    await expect(page.getByLabel("本次问题")).toBeFocused();
    await page.getByLabel("本次问题").fill("有哪些未知信息？");
    await page.getByRole("button", { name: "预览外发内容" }).click();
    await expect(page.getByRole("dialog")).toContainText("synthetic.example");
    await expect(page.getByRole("dialog")).toContainText(
      "合成原文：材料要求尚待确认。",
    );
    expect(generated).toBe(0);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    expect(generated).toBe(0);
    await page.getByRole("button", { name: "预览外发内容" }).click();
    await page.getByRole("button", { name: "同意发送并开始解读" }).click();
    await expect(page.getByRole("alert")).toContainText("合成模型失败");
    expect(generated).toBe(1);
    await page.getByRole("button", { name: "预览外发内容" }).click();
    await page.getByRole("button", { name: "同意发送并开始解读" }).click();
    await expect(
      page.getByRole("button", { name: "取消本次生成" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "取消本次生成" }).click();
    await expect(page.getByText("本次生成已取消")).toBeVisible();
    await page.getByRole("button", { name: "预览外发内容" }).click();
    await page.getByRole("button", { name: "同意发送并开始解读" }).click();
    await expect(page.getByText("合成结果：先核对材料要求")).toBeVisible();
    await page.getByRole("button", { name: "查看来源 c1-1" }).click();
    await expect(page.getByRole("dialog")).toContainText("第1段");
    await expect(page.getByRole("dialog")).toContainText(
      "合成原文：材料要求尚待确认。",
    );
    expect(generated).toBe(3);
    await page.keyboard.press("Escape");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path:
        "../.planning/2026-10-03-workspace-runs-4dff0066/workspace-result-" +
        width +
        ".png",
      fullPage: true,
    });
  });
}
