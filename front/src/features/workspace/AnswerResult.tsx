import { DocumentHighlights } from "./DocumentHighlights";
import { useState } from "react";
import type { ContextPreview } from "../../shared/types";
import { Modal } from "../../shared/ui";
import type { AnswerEnvelope, Evidence, Candidate } from "./useWorkspaceRun";
const kinds = {
  document_fact: "文件事实",
  user_fact: "已确认背景",
  inference: "系统推断",
  unknown: "未知信息",
};
export function AnswerResult({
  answer,
  snapshot,
}: {
  answer: AnswerEnvelope;
  snapshot: Pick<ContextPreview, "manifest">;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<Evidence>();
  const [selectedClaim, setSelectedClaim] = useState<Candidate>();
  function evidenceLinks(item: Candidate) {
    return (
      <div className="answer-evidence">
        {item.evidence.map((ref, i) => (
          <button
            key={i}
            aria-label={"查看来源 " + item.id + "-" + (i + 1)}
            onClick={() => { setSelected(ref); setSelectedClaim(item); }}
          >
            {ref.type === "document" ? "文件来源" : "已确认背景"} {i + 1}
          </button>
        ))}
      </div>
    );
  }
  const doc =
    selected?.type === "document"
      ? snapshot.manifest.documents.find(
          (d) =>
            d.document_id === selected.document_id &&
            d.document_version_id === selected.version,
        )
      : undefined;
  const segment =
    selected?.type === "document"
      ? doc?.segments.find(
          (s) =>
            s.segment_id === selected.segment_id &&
            s.text.includes(selected.quote),
        )
      : undefined;
  const fact =
    selected?.type === "fact"
      ? snapshot.manifest.facts.find(
          (f) => f.id === selected.fact_id && f.version === selected.version,
        )
      : undefined;
  return (
    <section className="workspace-answer" aria-label="本次模型解读">
      <div className="result-section-heading"><span className="result-step">01</span><div><p className="eyebrow">YOUR DOCUMENT, YOUR CONTEXT</p><h3>这份文件，与你的关系</h3></div></div>
      <DocumentHighlights snapshot={snapshot} />
      <p className={"answer-summary" + (answer.summary.length > 300 && !expanded ? " summary-collapsed" : "")}>{answer.summary}</p>
      {answer.summary.length > 300 && <button className="summary-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "收起完整解读" : "展开完整解读"}</button>}
      <small className="answer-model-note">
        模型初稿 · 覆盖
        {answer.coverage === "full_selected_text" ? "所选全文" : "所选片段"}
        ，不代表所有文件或未提供的信息。
      </small>
      <div className="answer-details-grid">{answer.claims.map((claim) => (
        <article className={"answer-claim kind-" + claim.kind} key={claim.id}>
          <strong>{kinds[claim.kind]}</strong>
          <p>{claim.text}</p>
          {evidenceLinks(claim)}
        </article>
      ))}</div>
      {answer.artifact && (
        <section>
          <h4>{answer.artifact.title} · 模型初稿</h4>
          <pre>{answer.artifact.body}</pre>
        </section>
      )}
      {selected && (
        <Modal title="核对本次引用来源" close={() => setSelected(undefined)}>
          <p className="evidence-conclusion">{selectedClaim?.text}</p>
          <div className="evidence-pair"><section>
          {selected.type === "document" ? (
            <>
              <h3>{doc?.name ?? selected.document_id}</h3>
              <small>
                版本 {selected.version} ·{" "}
                {selected.location ?? segment?.location ?? "原文片段"} · 片段{" "}
                {selected.segment_id}
              </small>
              <h4>已校验原文引句</h4>
              <blockquote>{selected.quote}</blockquote>
              {segment ? (
                <>
                  <h4>本次授权原文范围</h4>
                  <p>{segment.text}</p>
                </>
              ) : (
                <p>
                  本次预览快照中未找到对应片段，无法展开更多原文。请勿据此推断其他内容。
                </p>
              )}
            </>
          ) : (
            <>
              <h3>本次已确认背景</h3>
              <small>背景版本 {selected.version}</small>
              <p>{fact?.text ?? "本次快照中没有这条背景，无法展示原文。"}</p>
            </>
          )}
          </section><section><h3>这条判断使用的背景</h3>
            {selectedClaim?.evidence.filter(ref => ref.type === "fact").length ? selectedClaim.evidence.filter(ref => ref.type === "fact").map((ref, index) => {
              const background = ref.type === "fact" ? snapshot.manifest.facts.find(value => value.id === ref.fact_id && value.version === ref.version) : undefined;
              return <p key={index}>{background?.text ?? "本次授权范围中无法核对这条背景。"}</p>;
            }) : <p>这条判断没有引用个人背景。不要据此推断个人条件已经满足。</p>}
            <h3>还需要核实</h3><p>{answer.unknowns.join("\n") || "请结合原文和实际情况核对；未列出未知不代表已全部核实。"}</p>
          </section></div>
        </Modal>
      )}
    </section>
  );
}
