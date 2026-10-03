import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClient, ApiError } from "../../shared/api";
import type { ContextPreview } from "../../shared/types";
export type Evidence =
  | {
      type: "document";
      document_id: string;
      version: string | number;
      segment_id: string;
      quote: string;
      location?: string;
      char_start?: number;
      char_end?: number;
    }
  | { type: "fact"; fact_id: string; version: number };
export type Candidate = { id: string; text: string; evidence: Evidence[] };
export type AnswerEnvelope = {
  summary: string;
  claims: (Candidate & {
    kind: "document_fact" | "user_fact" | "inference" | "unknown";
  })[];
  questions: string[];
  memory_candidates: Candidate[];
  action_candidates: Candidate[];
  unknowns: string[];
  coverage: string;
  artifact: { title: string; kind: string; body: string } | null;
};
export type Run = {
  id: string;
  workspace_id: string;
  status: string;
  phase: string;
  error_code?: string | null;
  result_id?: string | null;
};
export type RunResult = {
  run_id: string;
  workspace_id: string;
  answer_id: string;
  envelope: AnswerEnvelope;
  generated_at: string;
};
export const running = (run?: Run) =>
  !!run && ["queued", "running"].includes(run.status);
export const phaseLabels: Record<string, string> = {
  queued: "等待处理",
  preparing_context: "正在准备已授权上下文",
  planning: "正在分析问题",
  resolving_evidence: "正在核对来源",
  generating: "正在生成",
  validating: "正在校验结果",
  saving: "正在保存本次结果",
};
export const terminalLabels: Record<string, string> = {
  succeeded: "本次解读已完成",
  failed: "本次生成失败",
  cancelled: "本次生成已取消",
  stale: "来源或目标已变化，请重新预览",
  interrupted: "本次运行已中断",
  rejected: "本次请求被拒绝",
};
export function useWorkspaceRun(
  api: ApiClient,
  workspaceId: string,
  revision?: number,
) {
  const [run, setRun] = useState<Run>();
  const [snapshot, setSnapshot] = useState<ContextPreview>();
  const [result, setResult] = useState<RunResult>();
  const [error, setError] = useState<unknown>();
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const epoch = useRef(0);
  const controller = useRef<AbortController | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const creationLock = useRef(false);
  const cancelLock = useRef(false);
  const invalidate = useCallback(() => {
    epoch.current++;
    controller.current?.abort();
    clearTimeout(timer.current);
    setRun(undefined);
    setResult(undefined);
    setSnapshot(undefined);
    setError(undefined);
    setSubmitting(false);
    setCancelling(false);
    creationLock.current = false;
    cancelLock.current = false;
  }, []);
  useEffect(() => {
    invalidate();
    return () => {
      epoch.current++;
      controller.current?.abort();
      clearTimeout(timer.current);
    };
  }, [workspaceId, revision, invalidate]);
  function live(token: number) {
    return token === epoch.current;
  }
  function checkRun(value: Run) {
    if (
      !value?.id ||
      value.workspace_id !== workspaceId ||
      ![...Object.keys(terminalLabels), "queued", "running"].includes(
        value.status,
      )
    )
      throw new ApiError(
        502,
        "INVALID_RUN_RESPONSE",
        "运行状态格式不正确，请重新读取状态。",
      );
  }
  async function refresh(
    current: Run,
    token = epoch.current,
    signal = controller.current?.signal,
    fetchStatus = true,
  ) {
    try {
      const next = fetchStatus
        ? await api.request<Run>("/runs/" + encodeURIComponent(current.id), {
            signal,
          })
        : current;
      if (!live(token)) return;
      checkRun(next);
      setRun(next);
      setError(undefined);
      if (next.status === "succeeded") {
        const answer = await api.request<RunResult>(
          "/runs/" + encodeURIComponent(next.id) + "/result",
          { signal },
        );
        if (!live(token)) return;
        if (
          answer.run_id !== next.id ||
          answer.workspace_id !== workspaceId ||
          !answer.envelope ||
          !Array.isArray(answer.envelope.claims)
        )
          throw new ApiError(
            502,
            "INVALID_RESULT",
            "结果与本次运行不匹配，请重新读取。",
          );
        setResult(answer);
      } else if (running(next)) {
        timer.current = setTimeout(
          () => void refresh(next, token, signal),
          800,
        );
      }
    } catch (e) {
      if (
        live(token) &&
        !(e instanceof DOMException && e.name === "AbortError")
      )
        setError(e);
    }
  }
  async function start(preview: ContextPreview, expectedRevision: number, consentToEmbedQuery = false) {
    if (creationLock.current || running(run)) return;
    invalidate();
    creationLock.current = true;
    setSubmitting(true);
    const token = epoch.current;
    controller.current = new AbortController();
    const signal = controller.current.signal;
    setSnapshot(preview);
    try {
      const next = await api.request<Run>(
        "/workspaces/" + encodeURIComponent(workspaceId) + "/runs",
        {
          method: "POST",
          signal,
          idempotencyKey: crypto.randomUUID(),
          body: {
            preview_id: preview.preview_id,
            manifest_hash: preview.manifest_hash,
            expected_revision: expectedRevision,
            consent_to_send: true,
            ...(preview.manifest.retrieval_mode === "hybrid" ? {consent_to_embed_query: consentToEmbedQuery} : {}),
          },
        },
      );
      if (!live(token)) return;
      checkRun(next);
      setRun(next);
      void refresh(next, token, signal, false);
    } catch (e) {
      if (
        live(token) &&
        !(e instanceof DOMException && e.name === "AbortError")
      )
        setError(e);
    } finally {
      if (live(token)) {
        creationLock.current = false;
        setSubmitting(false);
      }
    }
  }
  async function cancel() {
    if (!run || !running(run) || cancelLock.current) return;
    cancelLock.current = true;
    setCancelling(true);
    clearTimeout(timer.current);
    const token = ++epoch.current;
    controller.current?.abort();
    controller.current = new AbortController();
    try {
      const next = await api.request<Run>(
        "/runs/" + encodeURIComponent(run.id) + "/cancel",
        { method: "POST", signal: controller.current.signal },
      );
      if (live(token)) {
        checkRun(next);
        setRun(next);
        void refresh(next, token, controller.current.signal, false);
      }
    } catch (e) {
      if (live(token)) setError(e);
    } finally {
      if (live(token)) {
        cancelLock.current = false;
        setCancelling(false);
      }
    }
  }
  function retryRead() {
    if (run) {
      clearTimeout(timer.current);
      void refresh(run);
    }
  }
  return {
    run,
    result,
    snapshot,
    error,
    submitting,
    cancelling,
    active: submitting || running(run),
    start,
    cancel,
    retryRead,
    invalidate,
  };
}
