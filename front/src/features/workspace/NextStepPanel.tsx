import { ArrowRight, Check, ClipboardList, FilePenLine, MessageSquareText, ListChecks } from "lucide-react";

const outputs = [
  { title: "材料清单", detail: "整理要准备什么，标出缺失和待确认项。", icon: ClipboardList },
  { title: "待核实的问题", detail: "把不能确定的要求，整理成可以去问的问题。", icon: ListChecks },
  { title: "申请陈述草稿", detail: "结合已确认经历准备初稿，不补写未知经历。", icon: FilePenLine },
  { title: "合作讨论提纲", detail: "围绕范围、投入和交付，准备下一次沟通。", icon: MessageSquareText },
];
export function NextStepPanel({ continuing, complete, choose, finish, resume, notes, draft, disabled }: {
  continuing: boolean; complete: boolean; choose: () => void; finish: () => void; resume: () => void;
  notes: () => void; draft: (kind: string) => void; disabled: boolean;
}) {
  if (complete) return <section className="reading-complete" aria-label="阅读完成">
    <span className="complete-mark"><Check size={22} /></span><div><h3>本次理解已完成</h3>
      <p>了解清楚，也是一种完成。解读仍可查看，本次临时内容尚未长期保存；已独立保留的背景不受影响。</p>
      <div><button onClick={resume}>继续讨论</button><button onClick={notes}>查看本次积累</button></div>
    </div>
  </section>;
  return <section className="next-step-panel" aria-label="由你决定下一步">
    <p className="eyebrow">YOUR NEXT MOVE</p><h3>读懂之后，下一步由你决定。</h3>
    <p>可以就到这里，也可以沿用刚才的理解，准备一份能继续修改的产物。</p>
    <div className="next-step-actions"><button className="primary" disabled={disabled} onClick={choose}>继续行动 <ArrowRight size={16} /></button>
      <button disabled={disabled} onClick={finish}>到这里就够了</button></div>
    {continuing && <div className="output-choices">{outputs.map(({ title, detail, icon: Icon }) => <button key={title} aria-label={title} disabled={disabled} onClick={() => draft(title)}>
      <Icon size={20} /><strong>{title}</strong><span>{detail}</span>
    </button>)}<button disabled={disabled} onClick={() => draft("自定义草稿")}><FilePenLine size={20} /><strong>其他草稿</strong><span>告诉文启，你希望得到什么。</span></button></div>}
  </section>;
}
