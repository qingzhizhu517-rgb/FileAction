import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../app/session";
import { items } from "../../shared/api";
import { ErrorNotice } from "../../shared/ui";
import { ArtifactEditor } from "../deliverables/DeliverablesPage";
import type { ArtifactItem } from "../deliverables/types";

export function WorkspaceArtifacts({
  workspaceId,
  runId,
}: {
  workspaceId: string;
  runId?: string;
}) {
  const { api, user } = useSession();
  const cache = useQueryClient();
  const [editing, setEditing] = useState<ArtifactItem>();
  const artifacts = useQuery({
    queryKey: [user.id, "workspace-artifacts", workspaceId, runId],
    queryFn: ({ signal }) =>
      api.request<{ items: ArtifactItem[] }>(
        `/workspaces/${encodeURIComponent(workspaceId)}/artifacts`,
        { signal },
      ),
  });
  if (artifacts.error)
    return (
      <ErrorNotice
        error={artifacts.error}
        retry={() => void artifacts.refetch()}
      />
    );
  if (!items(artifacts.data).length) return null;
  return (
    <section className="workspace-artifacts" aria-label="本次成果">
      <h3>本次成果，继续写成你的版本</h3>
      <p>模型原稿可编辑。保存修改后再下载，原稿和每次修改分别保留。</p>
      {items(artifacts.data).map((item) => (
        <article key={item.id}>
          <div>
            <strong>{item.title}</strong>
            <small>
              v{item.version} ·{" "}
              {item.author_kind === "model" ? "模型原稿" : "用户编辑"}
              {item.validity !== "current" ? " · 来源已变化，需重新核对" : ""}
            </small>
          </div>
          <button
            className="primary"
            aria-label={"编辑与下载 " + item.title}
            onClick={() => setEditing(item)}
          >
            编辑与下载
          </button>
        </article>
      ))}
      {editing && (
        <ArtifactEditor
          key={editing.id}
          item={editing}
          api={api}
          userId={user.id}
          close={() => setEditing(undefined)}
          refreshed={() => {
            void artifacts.refetch();
            void cache.invalidateQueries({ queryKey: [user.id, "artifacts"] });
          }}
        />
      )}
    </section>
  );
}
