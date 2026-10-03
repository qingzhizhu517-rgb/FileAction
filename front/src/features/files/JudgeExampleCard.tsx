import { useRef, useState } from "react";
import { ArrowRight, FileText } from "lucide-react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "../../app/session";
import { ErrorNotice, Modal } from "../../shared/ui";
import { JUDGE_EXAMPLE, startJudgeExample } from "./judgeExample";

export function JudgeExampleCard({ upload }: { upload: () => void }) {
  const { api, user } = useSession();
  const cache = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const lock = useRef(false);
  async function start() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(undefined);
    try {
      const workspace = await startJudgeExample(api);
      await cache.invalidateQueries({ queryKey: [user.id, "documents"] });
      await cache.invalidateQueries({ queryKey: [user.id, "temporary-workspaces"] });
      navigate("/workspaces/" + workspace.id, { state: { judgeExample: true } });
    } catch (failure) { setError(failure); }
    finally { lock.current = false; setBusy(false); }
  }
  return <>
    <section className="judge-example" aria-labelledby="judge-example-title">
      <div className="judge-example-icon" aria-hidden="true"><FileText size={24} /></div>
      <div className="judge-example-copy">
        <span className="eyebrow">管理员体验 · 合成示例</span>
        <h2 id="judge-example-title">用一份示例，快速了解文启</h2>
        <p>已准备文件与可修改背景，仅在管理员体验入口提供。AI 实时解读，实际解析可能需要等待。</p>
      </div>
      <div className="judge-example-actions">
        <button onClick={() => { setError(undefined); setOpen(true); }}>体验预设场景 <ArrowRight size={16} /></button>
        <button className="judge-own-file" onClick={upload}>也可以用自己的文件</button>
      </div>
    </section>
    {open && <Modal title="开始一段示例体验" close={() => { if (!busy) setOpen(false); }}>
      <p className="eyebrow">合成通知 + 合成角色 · 真实模型生成</p>
      <h3>校园创新实践计划</h3>
      <p>你将以一位有校园工具想法的学生视角，理解申请条件和准备事项。每次开始都会建立独立阅读会话。</p>
      <blockquote className="judge-example-background">{JUDGE_EXAMPLE.background}</blockquote>
      <p className="hint">文件会保存到你的文件空间，可在文件管理中删除；合成背景仅用于本次会话，不加入个人档案。进入后可编辑背景，模型调用前还会核对发送范围。</p>
      <a href={JUDGE_EXAMPLE.url} download={JUDGE_EXAMPLE.name}>先下载示例 PDF 看看</a>
      {error != null && <ErrorNotice error={error} />}
      <div className="modal-actions">
        <button disabled={busy} onClick={() => setOpen(false)}>取消</button>
        <button className="primary" disabled={busy} onClick={() => void start()}>{busy ? "正在准备文件和背景…" : "保存示例并进入"}</button>
      </div>
    </Modal>}
  </>;
}
