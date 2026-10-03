import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../app/session";
import { ApiError, items } from "../../shared/api";
import { Empty, ErrorNotice, Modal } from "../../shared/ui";
import type { Workspace } from "../../shared/types";
import { forgetRetainedMemory } from "./retainedFacts";

type SavedMemory = {
  id: string;
  text: string;
  revision: number;
  current_version: number;
  active: boolean;
  available?: boolean;
  availability?: string;
};
const reasons: Record<string, string> = {
  inactive: "已停用",
  expired: "已过期",
  not_yet_valid: "尚未生效",
  source_deleted: "来源已失效",
};
export function MemoryLibrary({
  workspace,
  close,
  use,
}: {
  workspace: Workspace;
  close: () => void;
  use: (memory: SavedMemory) => Promise<void>;
}) {
  const { api, user } = useSession();
  const cache = useQueryClient();
  const memories = useQuery({
    queryKey: [user.id, "memories"],
    queryFn: async ({ signal }) => {
      const all: SavedMemory[] = [];
      let cursor: string | null = null;
      do {
        const page: { items: SavedMemory[]; next_cursor: string | null } =
          await api.request(
            "/memories?limit=100" +
              (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
            { signal },
          );
        all.push(...items(page));
        cursor = page.next_cursor;
      } while (cursor);
      return { items: all };
    },
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [editing, setEditing] = useState<SavedMemory>();
  const [draft, setDraft] = useState("");
  const [removing, setRemoving] = useState<SavedMemory>();
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(failure);
      if (failure instanceof ApiError && failure.status === 409)
        await memories.refetch();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="已保留背景"
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="session-drawer-content">
        <p>
          选择与这份文件有关的背景，加入「{workspace.title}
          」。不会自动发送模型，也不会自动带入其他背景。
        </p>
        {error != null && <ErrorNotice error={error} />}
        {memories.error ? (
          <ErrorNotice
            error={memories.error}
            retry={() => void memories.refetch()}
          />
        ) : memories.isPending ? (
          <p role="status">正在读取已保留背景…</p>
        ) : !items(memories.data).length ? (
          <Empty title="还没有保留的背景">
            本次背景确认后，可在「本次对话沉淀」中选择长期保留。
          </Empty>
        ) : (
          items(memories.data).map((memory) => (
            <article className="session-fact" key={memory.id}>
              {editing?.id === memory.id ? (
                <form
                  className="note-editor"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void perform(async () => {
                      await api.request("/memories/" + memory.id, {
                        method: "PATCH",
                        body: {
                          expected_revision: editing.revision,
                          text: draft.trim(),
                        },
                      });
                      forgetRetainedMemory(cache, user.id, memory.id);
                      setEditing(undefined);
                      await memories.refetch();
                    });
                  }}
                >
                  <label>
                    更正已保留背景
                    <textarea
                      value={draft}
                      maxLength={8000}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                  </label>
                  <button disabled={busy || !draft.trim()}>保存更正</button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setEditing(undefined)}
                  >
                    取消
                  </button>
                </form>
              ) : (
                <p>{memory.text}</p>
              )}
              <small>
                {memory.available === false || !memory.active
                  ? (reasons[memory.availability ?? "inactive"] ?? "暂不可用")
                  : "你已确认并选择保留"}{" "}
                · 第 {memory.current_version} 版
              </small>
              {removing?.id === memory.id ? (
                <div>
                  <p>
                    确认删除这条已保留背景？已加入本次的独立副本仍保留，可在本次背景中移除。
                  </p>
                  <button
                    disabled={busy}
                    onClick={() => setRemoving(undefined)}
                  >
                    取消
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await api.request(
                          `/memories/${memory.id}?expected_revision=${removing.revision}&confirmed=true`,
                          { method: "DELETE" },
                        );
                        forgetRetainedMemory(cache, user.id, memory.id);
                        setRemoving(undefined);
                        await memories.refetch();
                      })
                    }
                  >
                    确认删除背景
                  </button>
                </div>
              ) : (
                <div className="next-step-actions">
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      !memory.active ||
                      memory.available === false ||
                      Boolean(editing)
                    }
                    onClick={() =>
                      void perform(async () => {
                        await use(memory);
                        close();
                      })
                    }
                  >
                    用于本次理解
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setEditing(memory);
                      setDraft(memory.text);
                    }}
                  >
                    更正
                  </button>
                  <button disabled={busy} onClick={() => setRemoving(memory)}>
                    删除
                  </button>
                </div>
              )}
            </article>
          ))
        )}
        <p className="workspace-hint">
          这里只管理你明确保留的背景。更正或删除不会改写已有阅读记录。
        </p>
      </div>
    </Modal>
  );
}
