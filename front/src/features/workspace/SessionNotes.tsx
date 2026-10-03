import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Candidate } from "./useWorkspaceRun";
import type { Workspace, WorkspaceFact } from "../../shared/types";
import { useSession } from "../../app/session";
import { ErrorNotice, Modal } from "../../shared/ui";

export function SessionNotes({
  workspace,
  candidates,
  disabled,
  confirm,
  close,
}: {
  workspace: Workspace;
  candidates: Candidate[];
  disabled: boolean;
  confirm: (text: string, factId?: string) => Promise<void>;
  close: () => void;
}) {
  const { api, user } = useSession();
  const cache = useQueryClient();
  const savedKey = [user.id, "retained-facts", workspace.id];
  const [saved, setSaved] = useState<Record<string, string>>(
    () => cache.getQueryData(savedKey) ?? {},
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmedCandidates, setConfirmedCandidates] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState("");
  const [dirtyFacts, setDirtyFacts] = useState<Record<string, boolean>>({});
  const facts = workspace.facts ?? [];
  const signature = (fact: WorkspaceFact) => fact.id + ":" + fact.version;
  const selectedHasEdits = facts.some(
    (fact) => selected.includes(signature(fact)) && dirtyFacts[signature(fact)],
  );
  async function retain() {
    if (busy || disabled || selectedHasEdits) return;
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      for (const fact of facts.filter(
        (f) =>
          selected.includes(signature(f)) &&
          !saved[signature(f)] &&
          !dirtyFacts[signature(f)],
      )) {
        const memory = await api.request<{ id: string }>(
          `/workspaces/${encodeURIComponent(workspace.id)}/facts/${encodeURIComponent(fact.id)}/retain`,
          {
            method: "POST",
            idempotencyKey:
              cache.getQueryData<Record<string, string>>([
                user.id,
                "retain-request-keys",
                workspace.id,
              ])?.[signature(fact)] ??
              `retain:${workspace.id}:${fact.id}:${fact.version}`,
            body: {
              expected_revision: workspace.revision,
              fact_version: fact.version,
              consent_to_retain: true,
            },
          },
        );
        if (!memory.id) throw new Error("未能确认保存结果，请重试。");
        setSaved((current) => {
          const next = { ...current, [signature(fact)]: memory.id };
          cache.setQueryData(savedKey, next);
          return next;
        });
      }
      setSelected([]);
      setNotice("所选背景已保存到你的账号，下次阅读时可以主动选用。");
      void cache.invalidateQueries({ queryKey: [user.id, "memories"] });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="本次对话沉淀"
      close={() => {
        if (!busy) close();
      }}
    >
      <div className="session-drawer-content">
        <p>
          这次阅读中与你有关的积累。确认属实只用于本次，长期保留需另外勾选。
        </p>
        {candidates.filter((c) => !confirmedCandidates.includes(c.id)).length >
          0 && (
          <section>
            <h3>文启整理的背景候选</h3>
            <p className="workspace-hint">
              模型建议可能不准确，请修改并确认；不需要的内容可以忽略。
            </p>
            {candidates
              .filter((c) => !confirmedCandidates.includes(c.id))
              .map((candidate) => (
                <NoteEditor
                  key={candidate.id}
                  initial={candidate.text}
                  label="修改背景候选"
                  action="确认属实，用于本次"
                  disabled={disabled || busy}
                  save={async (text) => {
                    await confirm(text);
                    setConfirmedCandidates((current) => [
                      ...current,
                      candidate.id,
                    ]);
                  }}
                />
              ))}
          </section>
        )}
        <section>
          <h3>你已确认的背景</h3>
          {facts.length ? (
            facts.map((fact) => (
              <article className="session-fact" key={signature(fact)}>
                <NoteEditor
                  initial={fact.text}
                  label="修改已确认背景"
                  action="保存本次修改"
                  disabled={disabled || busy}
                  requireChange
                  save={(text) => confirm(text, fact.id)}
                  dirty={(value) =>
                    setDirtyFacts((current) => ({
                      ...current,
                      [signature(fact)]: value,
                    }))
                  }
                />
                {saved[signature(fact)] ? (
                  <p className="saved-note" role="status">
                    当前版本已长期保留
                  </p>
                ) : (
                  <label className="choice">
                    <input
                      type="checkbox"
                      aria-label={"长期保留：" + fact.text}
                      disabled={busy || disabled || dirtyFacts[signature(fact)]}
                      checked={selected.includes(signature(fact))}
                      onChange={(event) => {
                        setNotice("");
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, signature(fact)]
                            : current.filter((id) => id !== signature(fact)),
                        );
                      }}
                    />
                    长期保留这条已确认背景
                  </label>
                )}
              </article>
            ))
          ) : (
            <p>暂无已确认背景。你可以补充，也可以直接完成本次阅读。</p>
          )}
        </section>
        <p className="workspace-hint">
          仅保存勾选的已确认版本，不包含原文件、整段聊天和未确认推断。编辑框中的修改需先保存到本次。
        </p>
        {notice && (
          <p role="status" className="saved-note">
            {notice}
          </p>
        )}
        {error != null && <ErrorNotice error={error} />}
        <div className="modal-actions">
          <button disabled={busy} onClick={close}>
            仅本次使用，返回阅读
          </button>
          <button
            className="primary"
            disabled={
              busy ||
              disabled ||
              selectedHasEdits ||
              !facts.some(
                (f) =>
                  selected.includes(signature(f)) &&
                  !saved[signature(f)] &&
                  !dirtyFacts[signature(f)],
              )
            }
            onClick={() => void retain()}
          >
            {busy ? "正在保存所选背景…" : "确认保留所选背景"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function NoteEditor({
  initial,
  label,
  action,
  disabled,
  requireChange = false,
  save,
  dirty,
}: {
  initial: string;
  label: string;
  action: string;
  disabled: boolean;
  requireChange?: boolean;
  save: (text: string) => Promise<void>;
  dirty?: (value: boolean) => void;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <form
      className="note-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || disabled || !text.trim()) return;
        setBusy(true);
        setError(undefined);
        try {
          await save(text.trim());
        } catch (failure) {
          setError(failure);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        {label}
        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            dirty?.(event.target.value.trim() !== initial);
          }}
          rows={2}
          maxLength={4000}
          disabled={busy || disabled}
        />
      </label>
      <button
        disabled={
          busy ||
          disabled ||
          !text.trim() ||
          (requireChange && text.trim() === initial)
        }
      >
        {busy ? "正在确认…" : action}
      </button>
      {error != null && <ErrorNotice error={error} />}
    </form>
  );
}
