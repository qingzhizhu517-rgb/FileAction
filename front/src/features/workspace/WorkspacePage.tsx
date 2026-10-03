import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { FileText, MessageCircle, ShieldCheck, ArrowLeft } from "lucide-react";
import { useSession } from "../../app/session";
import { ApiError, items } from "../../shared/api";
import {
  useWorkspaceRun,
  phaseLabels,
  terminalLabels,
} from "./useWorkspaceRun";
import { JUDGE_EXAMPLE } from "../files/judgeExample";
import { AnswerResult } from "./AnswerResult";
import { ClarificationPanel, type Clarification } from "./ClarificationPanel";
import { ConfirmActionSuggestions } from "../actions/ConfirmActionSuggestions";
import { SessionNotes } from "./SessionNotes";
import { NextStepPanel } from "./NextStepPanel";
import { MemoryLibrary } from "./MemoryLibrary";
import { WorkspaceArtifacts } from "./WorkspaceArtifacts";
import type { Candidate } from "./useWorkspaceRun";
import "./workspace-run.css";
import "./reading-workspace.css";
import { Empty, ErrorNotice, Modal } from "../../shared/ui";
import type {
  Configuration,
  ContextPreview,
  DocumentItem,
  SourceSegment,
  Workspace,
  WorkspaceFact,
  WorkspaceMessage,
} from "../../shared/types";

export function WorkspacePage() {
  const { id = "" } = useParams();
  return <WorkspaceContent key={id} id={id} />;
}
function WorkspaceContent({ id }: { id: string }) {
  const { user, api } = useSession();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const key = [user.id, "workspace", id];
  const base = "/workspaces/" + encodeURIComponent(id);
  const workspace = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.request<Workspace>(base, { signal }),
  });
  const [messagesChanging, setMessagesChanging] = useState(false);
  const configuration = useQuery({
    queryKey: [user.id, "config"],
    queryFn: ({ signal }) =>
      api.request<Configuration>("/config", { signal }),
  });
  const generationReady = configuration.data?.generation?.configured === true;
  const messages = useQuery({
    queryKey: [...key, "messages", workspace.data?.revision],
    enabled: workspace.data !== undefined && !messagesChanging,
    queryFn: ({ signal }) =>
      api.request<{ items: WorkspaceMessage[]; next_cursor: string | null }>(
        base + "/messages",
        { signal },
      ),
  });
  const [goalDraft, setGoalDraft] = useState<string>();
  const [titleDraft, setTitleDraft] = useState<string>();
  const location = useLocation();
  const [text, setText] = useState(location.state?.judgeExample ? JUDGE_EXAMPLE.question : "");
  const [embedQueryConsent, setEmbedQueryConsent] = useState(false);
  const [factText, setFactText] = useState("");
  const [editingFact, setEditingFact] = useState<WorkspaceFact>();
  const [removeFact, setRemoveFact] = useState<WorkspaceFact>();
  const [ending, setEnding] = useState(false);
  const [showSession, setShowSession] = useState(false);
  const [showMemories, setShowMemories] = useState(false);
  const [continueAction, setContinueAction] = useState(false);
  const [readingComplete, setReadingComplete] = useState(false);
  const [notesCandidates, setNotesCandidates] = useState<Candidate[]>([]);
  const [requestKind, setRequestKind] = useState<"interpret" | "generate_artifact">("interpret");
  const [source, setSource] = useState<DocumentItem>();
  const [preview, setPreview] = useState<ContextPreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const composer = useRef<HTMLTextAreaElement>(null);
  const [clarifications, setClarifications] = useState<{ runId: string; items: Clarification[] }>();
  const supplementLock = useRef(false);
  const w = workspace.data;
  const generation = useWorkspaceRun(api, id, w?.revision);
  const recoveredRun = useRef("");
  // StrictMode 的首次清理会取消恢复请求；再次挂载必须允许读取缓存中的运行。
  useEffect(() => () => { recoveredRun.current = ""; }, []);
  useEffect(() => {
    if (!w || messagesChanging || messages.isPending || generation.run || generation.submitting || generation.error != null) return;
    const last = items(messages.data).filter(message => message.role === "assistant" && message.run_id).at(-1);
    if (!last?.run_id) return;
    const signature = `${w.revision}:${last.run_id}`;
    if (recoveredRun.current === signature) return;
    recoveredRun.current = signature;
    void generation.resume(last.run_id);
  }, [messages.data, messagesChanging, messages.isPending, w?.revision, generation.run, generation.submitting, generation.error]);
  useEffect(() => {
    if (!generation.result) return;
    const answer = generation.result.envelope;
    setNotesCandidates(answer.memory_candidates);
    void cache.invalidateQueries({ queryKey: [...key, "messages"] });
    const entries = [
      ...answer.questions.map(text => ({ text, kind: "question" as const })),
      ...answer.unknowns.map(text => ({ text, kind: "unknown" as const })),
    ];
    setClarifications({ runId: generation.result.run_id, items: entries.filter((entry, index) => entries.findIndex(other => other.text.trim() === entry.text.trim()) === index).map((entry, index) => ({ ...entry, id: `${generation.result!.run_id}-${index}` })) });
  }, [generation.result]);
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(e);
      if (e instanceof ApiError && e.status === 409) {
        setPreview(undefined);
        await workspace.refetch();
      }
    } finally {
      setBusy(false);
    }
  }
  async function mutate(
    path: string,
    method: string,
    body: Record<string, unknown>,
    preserveClarifications = false,
  ) {
    if (!preserveClarifications) setClarifications(undefined);
    setReadingComplete(false);
    generation.invalidate();
    setMessagesChanging(true);
    setPreview(undefined);
    await cache.cancelQueries({ queryKey: [...key, "messages"] });
    cache.removeQueries({ queryKey: [...key, "messages"] });
    try {
      await api.request(base + path, {
        method,
        body: { ...body, expected_revision: w!.revision },
      });
    } finally {
      // A failed response may still follow a server-side change. Re-read the
      // domain revision before enabling its separate messages cache.
      const refreshed = await workspace.refetch();
      setMessagesChanging(false);
      if (refreshed.error) throw refreshed.error;
    }
  }
  async function historyForPreview() {
    const response = await messages.refetch();
    if (response.error) throw response.error;
    // 服务端每次预览最多接受12条、48,000字符；从最近消息保留连续上下文。
    const chosen: WorkspaceMessage[] = [];
    let length = 0;
    for (const message of items(response.data).slice(-12).reverse()) {
      if (length + message.text.length > 48000) break;
      chosen.unshift(message); length += message.text.length;
    }
    return chosen.map(message => message.id);
  }
  function chooseDraft(kind: string) {
    setRequestKind("generate_artifact"); setReadingComplete(false); setPreview(undefined);
    setText(kind === "自定义草稿" ? "请沿用刚才的文件、已确认背景和交流，为我起草：" :
      `请沿用本次文件、已确认背景和交流，整理一份${kind}。使用已确认信息，未知内容留待核实，不补写个人经历或宣称已经完成外部动作。`);
    composer.current?.focus();
  }
  async function supplementOperation<Result>(action: () => Promise<Result>): Promise<Result> {
    if (supplementLock.current || busy || generation.active || w?.status !== "active") throw new ApiError(409, "WORKSPACE_BUSY", "请等待当前操作完成后再补充。");
    supplementLock.current = true;
    setBusy(true);
    setPreview(undefined);
    try { return await action(); } catch (failure) {
      if (failure instanceof ApiError && failure.status === 409) await workspace.refetch();
      throw failure;
    } finally { supplementLock.current = false; setBusy(false); }
  }
  async function clarificationPreview(message: string) {
    if (!w) return;
    if (goalDraft !== undefined) throw new ApiError(409, "GOAL_NOT_UPDATED", "请先更新本次目标，或取消目标修改。");
    await supplementOperation(async () => {
      setRequestKind("interpret"); setEmbedQueryConsent(false);
      const historyIds = await historyForPreview();
      setPreview(await api.request<ContextPreview>(base + "/context-preview", { method: "POST", body: {
        expected_revision: w.revision, kind: "interpret", message, retrieval_mode: "full_text",
        fact_ids: (w.facts ?? []).map(fact => fact.id), history_message_ids: historyIds,
      } }));
    });
  }
  if (workspace.isPending)
    return (
      <main className="page" role="status">
        正在打开本次工作区…
      </main>
    );
  if (workspace.error || !w)
    return (
      <main className="page">
        <ErrorNotice
          error={workspace.error}
          retry={() => void workspace.refetch()}
        />
      </main>
    );
  return (
    <main className="workspace-page">
      <header className="workspace-heading">
        <div>
          <Link to="/files" className="workspace-back">
            <ArrowLeft size={14} /> 文件空间
          </Link>
          <h1>{w.title || "未命名工作区"}</h1>
          <p>一份文件，一次理解，由你决定下一步。</p>
        </div>
        <div className="workspace-heading-actions">
          <button onClick={() => setShowSession(true)}>本次对话沉淀</button>
          <button
            disabled={busy || w.status === "ending"}
            onClick={() => setTitleDraft(w.title)}
          >
            修改标题
          </button>
          <span className="workspace-badge">
            {w.status === "ending"
              ? "结束处理中 · 请继续结束以重试清理"
              : "仅本次 · 临时工作区"}
          </span>
          <button disabled={busy} onClick={() => setEnding(true)}>
            结束本次
          </button>
        </div>
      </header>
      {error != null &&
        !preview &&
        !removeFact &&
        !ending &&
        titleDraft === undefined && <ErrorNotice error={error} />}
      {w.title === JUDGE_EXAMPLE.title && <section className="example-workspace-guide" aria-label="合成示例体验指引">
        <strong>合成示例 · 真实模型解读</strong>
        <span>① 开始理解，核对引用　② 修改背景卡片，再追问　③ 选择继续，生成并编辑草稿</span>
        <small>文件与角色均为虚构；你可以随时回到文件空间，上传自己的资料。</small>
      </section>}
      <div className="workspace-grid">
        <aside className="workspace-materials">
          <h2>
            <FileText size={17} /> 本次材料
          </h2>
          <p className="workspace-hint">原文是判断依据；读取不等于外发。</p>
          {w.documents?.length ? (
            w.documents.map((doc) => (
              <button
                key={doc.id}
                className="workspace-file"
                onClick={() => setSource(doc)}
                aria-label={"阅读 " + doc.name}
              >
                <FileText size={20} />
                <span>
                  {doc.name}
                  <small>
                    {doc.parse_status === "ready"
                      ? "原文已就绪"
                      : "解析状态：" + doc.parse_status}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p>尚未选择材料。</p>
          )}
          <div className="workspace-privacy">
            <ShieldCheck size={20} />
            <strong>本次内容，默认临时</strong>
            <p>
              确认事实仅用于本次，不代表同意长期保存。发送模型前会展示具体范围。
            </p>
          </div>
        </aside>
        <section className="workspace-conversation">
          <header>
            <h2>
              <MessageCircle size={18} /> 事务对话
            </h2>
            <span>先理解，再决定是否行动</span>
          </header>
          <div className="workspace-thread">
            {(generation.run ||
              generation.submitting ||
              generation.error != null) && (
              <section className="workspace-run" aria-label="本次生成状态">
                <strong role="status">
                  {generation.submitting
                    ? "正在提交已确认请求…"
                    : generation.run
                      ? (terminalLabels[generation.run.status] ??
                        phaseLabels[generation.run.phase] ??
                        generation.run.phase)
                      : "本次请求未完成"}
                </strong>
                {generation.run?.error_code && (
                  <p>错误代码：{generation.run.error_code}</p>
                )}
                {generation.error != null && (
                  <ErrorNotice
                    error={generation.error}
                    retry={generation.canRetryRead ? generation.retryRead : undefined}
                  />
                )}
                {generation.run && generation.active && (
                  <button
                    disabled={generation.cancelling}
                    onClick={() => void generation.cancel()}
                  >
                    取消本次生成
                  </button>
                )}
                {generation.run?.status === "queued" && (
                  <p className="run-hint">
                    请求已进入等待队列。若长时间停留在此状态，通常表示本机尚未启动生成处理进程，或模型服务不可用；可以先取消，待服务就绪后重新预览。
                  </p>
                )}
                {!generation.active && !generation.result && (
                  <p>你的问题已保留。再次生成请重新预览并确认外发范围。</p>
                )}
              </section>
            )}
            {generation.result && generation.snapshot && (
              <><AnswerResult
                answer={generation.result.envelope}
                snapshot={generation.snapshot}
              />
              <NextStepPanel continuing={continueAction} complete={readingComplete} disabled={busy || generation.active}
                choose={() => setContinueAction(true)} finish={() => { setReadingComplete(true); setContinueAction(false); setRequestKind("interpret"); setPreview(undefined); }}
                resume={() => { setReadingComplete(false); setRequestKind("interpret"); }} notes={() => setShowSession(true)} draft={chooseDraft} />
              {continueAction && !readingComplete && generation.result.envelope.action_candidates.length > 0 && <details className="suggested-actions"><summary>将建议整理为行动记录</summary><ConfirmActionSuggestions key={generation.result.run_id} workspaceId={id} runId={generation.result.run_id}/></details>}
              </>
            )}
            {clarifications && clarifications.items.length > 0 && <details className="optional-clarifications" open={clarifications.items.length <= 3} hidden={readingComplete}>
              <summary>查看待核实与可补充内容（{clarifications.items.length}）</summary><ClarificationPanel
              key={clarifications.runId}
              items={clarifications.items}
              disabled={busy || generation.active || w.status !== "active"}
              operations={{
                confirmAnswer: (question, answer, factId) => supplementOperation(async () => {
                  const combined = `问题：${question}\n用户确认回答：${answer}`;
                  await mutate("/facts" + (factId ? "/" + encodeURIComponent(factId) : ""), factId ? "PATCH" : "POST", { text: combined, confirmed: true }, true);
                  const current = cache.getQueryData<Workspace>(key);
                  const fact = current?.facts?.find(value => value.text === combined);
                  if (!fact) throw new ApiError(502, "FACT_NOT_CONFIRMED", "未能确认回答已加入，请重新读取本次背景。");
                  return fact.id;
                }),
                upload: file => supplementOperation(async () => {
                  if (!file.size || file.size > 10 * 1024 * 1024) throw new ApiError(413, "FILE_TOO_LARGE", "请选择非空且不超过10 MiB的补充材料。");
                  if (!/\.(txt|md|pdf|docx)$/i.test(file.name)) throw new ApiError(422, "FILE_UNSUPPORTED", "请使用 TXT、Markdown、PDF 或 DOCX 文件。");
                  if ((w.documents?.length ?? 0) >= 20) throw new ApiError(422, "DOCUMENT_LIMIT", "本次材料最多20份，请先移除不需要的补充材料。");
                  const form = new FormData(); form.set("file", file); form.set("retention", "temporary"); form.set("consent_to_store", "false");
                  const doc = await api.request<DocumentItem>("/documents", { method: "POST", body: form });
                  if (doc.parse_status !== "ready" || !doc.current_version_id) throw new ApiError(422, "MATERIAL_NOT_READY", "补充材料未完成解析，未加入本次判断。");
                  return doc;
                }),
                attach: doc => supplementOperation(async () => {
                  const current = cache.getQueryData<Workspace>(key) ?? w;
                  const versions = (current.documents ?? []).map(value => value.current_version_id);
                  if (versions.some(version => !version) || !doc.current_version_id) throw new ApiError(409, "DOCUMENT_VERSION_MISSING", "材料版本不可用，请重新读取工作区。");
                  await mutate("/documents", "PUT", { document_version_ids: [...new Set([...versions, doc.current_version_id])] }, true);
                }),
                remove: doc => supplementOperation(async () => {
                  const current = cache.getQueryData<Workspace>(key) ?? w;
                  const remaining = (current.documents ?? []).filter(value => value.id !== doc.id);
                  if (remaining.some(value => !value.current_version_id)) throw new ApiError(409, "DOCUMENT_VERSION_MISSING", "材料版本不可用，请重新读取工作区。");
                  await mutate("/documents", "PUT", { document_version_ids: remaining.map(value => value.current_version_id) }, true);
                }),
                preview: clarificationPreview,
              }}
            /></details>}
            <WorkspaceArtifacts workspaceId={id} runId={generation.result?.run_id} />
            {messagesChanging ? (
              <p role="status">正在更新上下文并重新核对消息…</p>
            ) : messages.error ? (
              <ErrorNotice
                error={messages.error}
                retry={() => void messages.refetch()}
              />
            ) : messages.isPending ? (
              <p role="status">正在读取本次消息…</p>
            ) : items(messages.data).length ? (
              <details className="reading-history"><summary>本次交流记录（{items(messages.data).length}）</summary>{items(messages.data).map((m) => (
                <article
                  key={m.id}
                  className={
                    "workspace-message " +
                    (m.role === "user" ? "from-user" : "")
                  }
                >
                  <small>{m.role === "user" ? "你" : "文启 · 模型回复"}</small>
                  <p>{m.text}</p>
                </article>
              ))}</details>
            ) : !generation.run && !generation.submitting ? (
              <Empty title="这份文件，对现在的你意味着什么？">
                可以先读原文，也可以直接提出问题。背景可跳过；不会自动生成答案。
              </Empty>
            ) : null}
          </div>
          {!readingComplete && <><div className="conversation-start">
            <p className="eyebrow">先理解，再决定下一步</p>
            <h3>这份文件，对现在的你意味着什么？</h3>
            <p>你可以直接告诉文启最想弄清的事，也可以先留空，让它从文件和本次背景开始理解。</p>
          </div>
          <form
            className="workspace-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                setEmbedQueryConsent(false);
                const historyIds = await historyForPreview();
                setPreview(
                  await api.request<ContextPreview>(base + "/context-preview", {
                    method: "POST",
                    body: {
                      expected_revision: w.revision,
                      kind: requestKind,
                      message: text.trim(),
                      retrieval_mode: "full_text",
                      fact_ids: (w.facts ?? []).map((f) => f.id),
                      history_message_ids: historyIds,
                    },
                  }),
                );
              });
            }}
          >
            <label htmlFor="workspace-question">告诉文启你的想法</label>
            <textarea
              id="workspace-question"
              aria-label="本次问题"
              ref={composer}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setPreview(undefined);
              }}
              placeholder="例如：这份文件和我有关系吗？我需要注意什么？"
              rows={3}
              maxLength={4000}
            />
            <div>
              <small>
                {goalDraft !== undefined
                  ? "目标尚未更新，请先更新目标后再预览。"
                  : requestKind === "generate_artifact"
                    ? "你已选择继续行动；先查看成果草稿的外发范围，再确认生成。"
                    : "先看看文启将依据哪些内容理解这份文件，再决定是否发送。"}
              </small>
              <button
                className="primary"
                aria-label="预览外发内容"
                disabled={
                  busy ||
                  generation.active ||
                  goalDraft !== undefined ||
                  w.status !== "active"
                }
              >
                开始理解
              </button>
            </div>
          </form></>}
        </section>
        <aside className="workspace-context">
          <section>
            <span className="eyebrow">THIS SESSION</span>
            <h2>本次目标</h2>
            <label className="sr-only" htmlFor="workspace-goal">
              本次目标
            </label>
            <textarea
              id="workspace-goal"
              value={goalDraft ?? w.goal ?? ""}
              onChange={(e) => {
                setGoalDraft(e.target.value);
                generation.invalidate();
                setPreview(undefined);
              }}
              rows={3}
              maxLength={2000}
              placeholder="可选：你希望理解或完成什么"
            />
            <button
              disabled={
                busy || w.status === "ending" || goalDraft === undefined
              }
              onClick={() =>
                void perform(async () => {
                  await mutate("", "PATCH", { goal: goalDraft });
                  setGoalDraft(undefined);
                })
              }
            >
              更新目标
            </button>
          </section>
          <section>
            <h2>文件背景卡片</h2>
            <button disabled={busy || generation.active || w.status !== "active"} onClick={() => setShowMemories(true)}>选择已保留背景</button>
            <p className="workspace-hint">
              本次会话使用的背景。可直接修改；下次理解会读取最新保存版本。
            </p>
            {(w.facts ?? []).map((f) => (
              <article className="workspace-fact" key={f.id}>
                <p>{f.text}</p>
                <small>已确认 · 仅本次</small>
                <div>
                  <button
                    disabled={busy || w.status === "ending"}
                    aria-label="修改背景"
                    onClick={() => {
                      setEditingFact(f);
                      setFactText(f.text);
                    }}
                  >
                    修改
                  </button>
                  <button
                    disabled={busy || w.status === "ending"}
                    aria-label="移除背景"
                    onClick={() => setRemoveFact(f)}
                  >
                    移除
                  </button>
                </div>
              </article>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void perform(async () => {
                  await mutate(
                    "/facts" +
                      (editingFact
                        ? "/" + encodeURIComponent(editingFact.id)
                        : ""),
                    editingFact ? "PATCH" : "POST",
                    { text: factText.trim(), confirmed: true },
                  );
                  setFactText("");
                  setEditingFact(undefined);
                });
              }}
            >
              <label htmlFor="workspace-fact">补充本次背景</label>
              <textarea
                id="workspace-fact"
                value={factText}
                onChange={(e) => setFactText(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder="只在需要时补充，也可以跳过"
              />
              <button
                disabled={busy || w.status === "ending" || !factText.trim()}
              >
                确认属实，仅用于本次
              </button>
              {editingFact && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingFact(undefined);
                    setFactText("");
                  }}
                >
                  取消修改
                </button>
              )}
            </form>
            <button
              className="workspace-skip"
              onClick={() => composer.current?.focus()}
            >
              跳过背景，直接提问
            </button>
          </section>
        </aside>
      </div>
      {showSession && <SessionNotes workspace={w} candidates={notesCandidates} disabled={busy || generation.active || w.status !== "active"}
        close={() => setShowSession(false)} confirm={async (value, factId) => { await supplementOperation(() => mutate("/facts" + (factId ? "/" + encodeURIComponent(factId) : ""), factId ? "PATCH" : "POST", { text: value, confirmed: true }, true)); }} />}
      {showMemories && <MemoryLibrary workspace={w} close={() => setShowMemories(false)} use={memory => supplementOperation(async () => {
        const updated = await api.request<Workspace>(`/memories/${encodeURIComponent(memory.id)}/use`, { method: "POST", body: { workspace_id: w.id, expected_revision: w.revision, expected_memory_revision: memory.revision } });
        generation.invalidate(); setReadingComplete(false); setClarifications(undefined); setPreview(undefined);
        cache.setQueryData(key, updated); void cache.invalidateQueries({ queryKey: [...key, "messages"] });
      })} />}

      {source && (
        <SourceReader doc={source} close={() => setSource(undefined)} />
      )}
      {titleDraft !== undefined && (
        <Modal
          title="修改工作区标题"
          close={() => {
            if (!busy) setTitleDraft(undefined);
          }}
        >
          {error != null && <ErrorNotice error={error} />}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                await mutate("", "PATCH", { title: titleDraft.trim() });
                setTitleDraft(undefined);
              });
            }}
          >
            <label htmlFor="workspace-title">工作区标题</label>
            <input
              id="workspace-title"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              maxLength={300}
            />
            <button disabled={busy || !titleDraft.trim()}>保存标题</button>
          </form>
        </Modal>
      )}
      {preview && (
        <Modal
          title={preview.manifest.kind === "generate_artifact" ? "开始起草前确认范围" : "开始理解前确认范围"}
          close={() => {
            if (!busy) setPreview(undefined);
          }}
        >
          <div className="context-preview">
            {error != null && <ErrorNotice error={error} />}
            {generationReady &&
            preview.manifest.model.domain &&
            preview.manifest.model.name ? (
              <p>
                文启会依据下列内容理解这份文件；这些内容将发送至{" "}
                <strong>{preview.manifest.model.domain}</strong> 的{" "}
                {preview.manifest.model.name}。本地临时保存不等于云端模型不可见。
              </p>
            ) : (
              <p className="preview-blocked" role="status">
                <strong>当前没有可用的模型服务。</strong>
                这里只会展示将要使用的范围，并没有可发送的对象；提交后请求会停留在等待队列，不会产生解读结果。
                请先在
                <Link to="/settings">账号设置</Link>
                中确认模型配置，或由部署方提供模型服务。
              </p>
            )}
            {preview.manifest.retrieval_mode === "hybrid" && preview.manifest.embedding && <section>
              <h3>独立查询向量外发</h3>
              <p>本次查询及授权范围内的派生检索词会发至 <strong>{preview.manifest.embedding.domain}</strong> 的 {preview.manifest.embedding.model}（{preview.manifest.embedding.dimensions}维）。</p>
              <p>查询：{preview.manifest.query_embedding_authorization?.query}；最多 {preview.manifest.query_embedding_authorization?.max_requests} 次批量、{preview.manifest.query_embedding_authorization?.max_queries} 条查询、{preview.manifest.query_embedding_authorization?.max_characters} 字符、{preview.manifest.query_embedding_authorization?.request_seconds} 秒。结果只覆盖命中片段。</p>
              <label><input type="checkbox" checked={embedQueryConsent} onChange={e=>setEmbedQueryConsent(e.target.checked)} />同意将本次查询及授权上下文内的派生检索词发送给 Embedding 服务</label>
            </section>}
            <h3>本次目标</h3>
            <p>{preview.manifest.goal || "未设定"}</p>
            <h3>本次问题</h3>
            <p>{preview.manifest.message}</p>
            <h3>文件原文</h3>
            {preview.manifest.documents.map((d) => (
              <section key={d.document_version_id}>
                <h4>{d.name}</h4>
                {d.segments.map((s, i) => (
                  <blockquote key={s.segment_id ?? i}>
                    <small>{s.location ?? "原文片段"}</small>
                    <p>{s.text}</p>
                  </blockquote>
                ))}
              </section>
            ))}
            <h3>已确认背景</h3>
            {preview.manifest.facts.length ? (
              preview.manifest.facts.map((f) => <p key={f.id}>{f.text}</p>)
            ) : (
              <p>本次不发送背景。</p>
            )}
            <h3>历史消息</h3>
            {preview.manifest.history.length ? (
              preview.manifest.history.map((m) => <p key={m.id}>{m.text}</p>)
            ) : (
              <p>本次不发送历史消息。</p>
            )}
            <p>
              预计 {preview.manifest.estimated_tokens} tokens · 范围：
              {typeof preview.manifest.coverage === "string"
                ? preview.manifest.coverage
                : JSON.stringify(preview.manifest.coverage)}
            </p>
            <p>
              预览有效至 {new Date(preview.expires_at).toLocaleTimeString()}
              ；内容变化后需重新预览。
            </p>
            <div className="modal-actions">
              <button disabled={busy} onClick={() => setPreview(undefined)}>
                取消
              </button>
              <button
                className="primary"
                disabled={
                  busy ||
                  !generationReady ||
                  (preview.manifest.retrieval_mode === "hybrid" &&
                    !embedQueryConsent)
                }
                onClick={() =>
                  void perform(async () => {
                    if (Date.parse(preview.expires_at) <= Date.now()) {
                      setPreview(undefined);
                      throw new ApiError(
                        409,
                        "PREVIEW_EXPIRED",
                        "外发预览已过期，请重新预览。",
                      );
                    }
                    const confirmed = preview;
                    setPreview(undefined);
                    await generation.start(confirmed, w.revision, embedQueryConsent);
                  })
                }
              >
                {!generationReady
                  ? "模型未配置，暂不能开始"
                  : preview.manifest.kind === "generate_artifact"
                    ? "同意发送并起草成果"
                    : "开始本次理解"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {removeFact && (
        <Modal
          title="移除本次背景"
          close={() => {
            if (!busy) setRemoveFact(undefined);
          }}
        >
          {error != null && <ErrorNotice error={error} />}
          <p>确认移除这条背景？后续解读将不再使用它。</p>
          <blockquote>{removeFact.text}</blockquote>
          <button
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await mutate(
                  "/facts/" + encodeURIComponent(removeFact.id),
                  "DELETE",
                  {},
                );
                setRemoveFact(undefined);
              })
            }
          >
            确认移除
          </button>
        </Modal>
      )}
      {ending && (
        <Modal
          title="结束本次工作区"
          close={() => {
            if (!busy) setEnding(false);
          }}
        >
          {error != null && <ErrorNotice error={error} />}
          <p>将清除本次临时内容。先前独立保存的文件不会因此删除。</p>
          <button
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                generation.invalidate();
                try {
                  await api.request(base + "/end", {
                    method: "POST",
                    body: { expected_revision: w.revision },
                  });
                } catch (failure) {
                  await workspace.refetch();
                  throw failure;
                }
                await cache.cancelQueries({ queryKey: [user.id] });
                cache.removeQueries({ queryKey: [user.id] });
                navigate("/files", { replace: true });
              })
            }
          >
            确认结束并清除临时内容
          </button>
        </Modal>
      )}
    </main>
  );
}
function SourceReader({
  doc,
  close,
}: {
  doc: DocumentItem;
  close: () => void;
}) {
  const { user, api } = useSession();
  const [cursor, setCursor] = useState("");
  const segments = useQuery({
    queryKey: [user.id, "workspace-source", doc.id, cursor],
    queryFn: ({ signal }) =>
      api.request<
        SourceSegment[] | { items: SourceSegment[]; next_cursor: string | null }
      >(
        "/documents/" +
          encodeURIComponent(doc.id) +
          "/segments" +
          (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
        { signal },
      ),
  });
  return (
    <Modal title={"文件原文 · " + doc.name} close={close}>
      {segments.error ? (
        <ErrorNotice
          error={segments.error}
          retry={() => void segments.refetch()}
        />
      ) : segments.isPending ? (
        <p role="status">正在读取原文…</p>
      ) : (
        <div className="workspace-source">
          {items(segments.data).map((s, i) => (
            <section key={s.id ?? i}>
              <small>{s.location || "原文片段"}</small>
              <p>{s.text}</p>
            </section>
          ))}
          {!items(segments.data).length && (
            <p>暂时没有可读取的原文，请稍后重试。</p>
          )}
          {!Array.isArray(segments.data) && segments.data.next_cursor && (
            <button
              onClick={() =>
                setCursor(
                  !Array.isArray(segments.data)
                    ? (segments.data.next_cursor ?? "")
                    : "",
                )
              }
            >
              下一页原文
            </button>
          )}
          {cursor && <button onClick={() => setCursor("")}>回到第一页</button>}
        </div>
      )}
    </Modal>
  );
}
