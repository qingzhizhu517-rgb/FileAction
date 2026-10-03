import { useState } from "react";
import { Check, FilePlus2, MessageSquare, RotateCcw, ArrowRight } from "lucide-react";
import type { DocumentItem } from "../../shared/types";
import { ErrorNotice } from "../../shared/ui";

export type Clarification = { id: string; text: string; kind: "question" | "unknown" };
export type ClarificationOperations = {
  confirmAnswer: (question: string, answer: string, factId?: string) => Promise<string>;
  upload: (file: File) => Promise<DocumentItem>;
  attach: (doc: DocumentItem) => Promise<void>;
  remove: (doc: DocumentItem) => Promise<void>;
  preview: (message: string) => Promise<void>;
};
type Progress = { answered?: boolean; material?: boolean; skipped?: boolean; draft?: boolean };

export function ClarificationPanel({ items, disabled, operations }: {
  items: Clarification[]; disabled: boolean; operations: ClarificationOperations;
}) {
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [previewError, setPreviewError] = useState<unknown>();
  const [previewing, setPreviewing] = useState(false);
  const completed = Object.values(progress).filter(item => item.answered || item.material || item.skipped).length;
  const hasDrafts = Object.values(progress).some(item => item.draft);
  const blocked = disabled || previewing;
  return (
    <section className="clarification-panel" aria-label="补充后再判断">
      <div className="result-section-heading">
        <span className="result-step">02</span>
        <div><p className="eyebrow">FILL THE GAPS</p><h3>补充后，再判断</h3></div>
        <span className="clarification-count">{completed} / {items.length} 项已处理</span>
      </div>
      <p className="clarification-intro">仍待核实的内容，可以直接回答、上传材料，也可以暂时跳过。不必填完所有问题。</p>
      <div className="clarification-list">
        {items.map(item => <ClarificationCard key={item.id} item={item} disabled={blocked} operations={operations}
          onProgress={value => setProgress(current => ({ ...current, [item.id]: value }))} />)}
      </div>
      <div className="clarification-review">
        <div><strong>补充内容，默认仅本次使用</strong><p>已补充不代表已核实。重新理解前，你可以查看并确认将发送给模型的具体范围。</p>
          {hasDrafts && <p className="clarification-draft-note">还有未确认回答或未加入的材料，请先提交或取消这些草稿。</p>}</div>
        <button className="primary" disabled={blocked || completed === 0 || hasDrafts} onClick={async () => {
          setPreviewing(true); setPreviewError(undefined);
          try {
            const context = items.map(item => `${item.text}（${progress[item.id]?.skipped ? "用户暂时跳过，保持未知" : progress[item.id]?.answered || progress[item.id]?.material ? "已补充，需根据本次背景或材料复核" : "尚未补充，保持待核实"}）`).join("\n");
            await operations.preview("请结合本次已确认回答和补充材料重新理解，不能将已补充等同于已核实。\n待核实项：\n" + context);
          } catch (failure) { setPreviewError(failure); } finally { setPreviewing(false); }
        }}>用补充内容重新理解 <ArrowRight size={15} /></button>
      </div>
      {previewError != null && <ErrorNotice error={previewError} />}
    </section>
  );
}

function ClarificationCard({ item, disabled, operations, onProgress }: {
  item: Clarification; disabled: boolean; operations: ClarificationOperations; onProgress: (value: Progress) => void;
}) {
  const [mode, setMode] = useState<"answer" | "upload">();
  const [answer, setAnswer] = useState("");
  const [confirmedAnswer, setConfirmedAnswer] = useState("");
  const [factId, setFactId] = useState<string>();
  const [file, setFile] = useState<File>();
  const [parsed, setParsed] = useState<DocumentItem>();
  const [attached, setAttached] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const blocked = disabled || busy;
  function report(values: { answered?: boolean; material?: boolean; skipped?: boolean; draft?: boolean } = {}) {
    onProgress({ answered: Boolean(factId), material: attached, skipped, draft: Boolean(answer.trim() && answer !== confirmedAnswer) || Boolean(file && !attached), ...values });
  }
  async function perform(action: () => Promise<void>) {
    if (blocked) return;
    setBusy(true); setError(undefined);
    try { await action(); } catch (failure) { setError(failure); } finally { setBusy(false); }
  }
  function cancelDraft() {
    setMode(undefined); setAnswer(confirmedAnswer); setFile(undefined);
    if (!attached) setParsed(undefined);
    setError(undefined); report({ draft: false });
  }
  return <article className={"clarification-card" + (skipped ? " is-skipped" : "")} aria-label={item.text}>
    <div className="clarification-card-heading">
      <span className="clarification-icon">{factId || attached ? <Check size={17} /> : <MessageSquare size={17} />}</span>
      <div><span className="clarification-kind">{item.kind === "question" ? "需要你确认" : "仍待核实"}</span><h4>{item.text}</h4></div>
    </div>
    <p className="clarification-guidance">补充用于复核这项判断；不提供的信息会继续保持未知。</p>
    <div className="clarification-status" aria-live="polite">
      {factId && <span>回答已确认 · 待重新理解</span>}
      {attached && <span>材料已加入 · 待重新理解</span>}
      {skipped && <span>已跳过 · 仍待核实</span>}
    </div>
    {confirmedAnswer && <blockquote className="clarification-answer">{confirmedAnswer}<small>你已确认 · 仅本次背景</small></blockquote>}
    {attached && parsed && <div className="clarification-file"><FilePlus2 size={17} /><span>{parsed.name}<small>仅本次材料 · 尚未重新理解</small></span>
      {!removing ? <button disabled={blocked} onClick={() => setRemoving(true)}>移除本次材料</button> : <div><p>移除仅取消本次使用，不等于删除原件。</p><button disabled={blocked} onClick={() => setRemoving(false)}>取消移除</button><button disabled={blocked} onClick={() => void perform(async () => {
        await operations.remove(parsed); setAttached(false); setParsed(undefined); setFile(undefined); setRemoving(false); report({ material: false, draft: answer !== confirmedAnswer });
      })}>确认移除材料</button></div>}</div>}
    <div className="clarification-actions">
      <button disabled={blocked} onClick={() => { setMode("answer"); setError(undefined); }}><MessageSquare size={14} />{factId ? "修改回答" : "补充回答"}</button>
      <button disabled={blocked || attached} onClick={() => { setMode("upload"); setError(undefined); }}><FilePlus2 size={14} />上传材料</button>
      <button disabled={blocked || Boolean(factId) || attached} onClick={() => {
        const next = !skipped; setSkipped(next); setMode(undefined); setAnswer(confirmedAnswer); setFile(undefined); setParsed(undefined); setError(undefined); report({ skipped: next, draft: false });
      }}>{skipped ? <><RotateCcw size={14} />继续补充</> : "暂时跳过"}</button>
    </div>
    {mode === "answer" && <form className="clarification-form" onSubmit={event => { event.preventDefault(); void perform(async () => {
      const nextId = await operations.confirmAnswer(item.text, answer.trim(), factId);
      setFactId(nextId); setConfirmedAnswer(answer.trim()); setAnswer(answer.trim()); setSkipped(false); setMode(undefined);
      report({ answered: true, skipped: false, draft: Boolean(file && !attached) });
    }); }}><label>你的回答<textarea value={answer} disabled={blocked} maxLength={2000} rows={3} placeholder="只需补充与这个问题有关的信息" onChange={event => { setAnswer(event.target.value); report({ draft: event.target.value.trim() !== confirmedAnswer || Boolean(file && !attached) }); }} /></label>
      <p>点击确认表示回答属实并用于本次判断，不表示同意长期保存。</p>
      <div className="clarification-form-actions"><button className="primary" disabled={blocked || !answer.trim() || answer.trim() === confirmedAnswer}>确认回答并用于本次</button><button type="button" disabled={blocked} onClick={cancelDraft}>取消补充</button></div>
    </form>}
    {mode === "upload" && <form className="clarification-form" onSubmit={event => { event.preventDefault(); void perform(async () => {
      if (!file && !parsed) return;
      const doc = parsed ?? await operations.upload(file!); setParsed(doc);
      await operations.attach(doc); setAttached(true); setFile(undefined); setSkipped(false); setMode(undefined);
      report({ material: true, skipped: false, draft: answer.trim() !== confirmedAnswer });
    }); }}><label className="clarification-upload" htmlFor={`clarification-file-${item.id}`}>选择补充材料<input id={`clarification-file-${item.id}`} aria-label="选择补充材料" type="file" accept=".txt,.md,.pdf,.docx" disabled={blocked || Boolean(parsed)} onChange={event => { const next = event.target.files?.[0]; setFile(next); setError(undefined); report({ draft: Boolean(next) || answer.trim() !== confirmedAnswer }); }} /><small>TXT / Markdown / PDF / DOCX · 不超过 10 MiB</small></label>
      {file && <p>已选择：{file.name}</p>}
      {parsed && !attached && <p>文件已解析，尚未加入本次材料。可重试附加，不会重复上传。</p>}
      <p>默认仅用于本次，不自动云端长期保存或建立索引；模型外发需另行确认。</p>
      <div className="clarification-form-actions"><button className="primary" disabled={blocked || (!file && !parsed)}>{parsed ? "重试加入本次材料" : "上传并用于本次"}</button><button type="button" disabled={blocked} onClick={cancelDraft}>取消补充</button></div>
    </form>}
    {busy && <p role="status">正在更新本次补充…</p>}
    {error != null && <ErrorNotice error={error} />}
  </article>;
}
