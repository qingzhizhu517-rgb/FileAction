import { useEffect, useState } from "react";
import type { ContextPreview } from "../../shared/types";

function countdown(text: string, now: number) {
  const dates = text.split(/[。\n！？!?；;]/).flatMap(sentence => {
    // 仅接受独立句中明确紧邻日期的截止表述；其余保留原文，不猜测倒计时。
    const match = sentence.trim().match(/^(?:报名|申请|申报|提交|材料提交)?(?:截止|截至)(?:时间|日期)?(?:为)?[\s:：]*(20\d{2})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2})[:：](\d{2})\s*[（(]\s*(?:北京时间|UTC\+8|GMT\+8)\s*[）)]/);
    return match ? [match] : [];
  });
  if (dates.length !== 1) return;
  const [, year, month, day, hour, minute] = dates[0].map(Number);
  const local = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day || hour > 23 || minute > 59) return;
  const left = local.getTime() - 8 * 3600000 - now;
  if (left <= 0) return "原文截止时间已过";
  const hours = Math.floor(left / 3600000);
  return hours < 1 ? "距原文截止不足 1 小时" : `距原文截止 ${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
}

export function DocumentHighlights({ snapshot }: { snapshot: Pick<ContextPreview, "manifest"> }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const entries = snapshot.manifest.documents.flatMap(doc => doc.segments.flatMap(segment => {
    const text = segment.text.trim();
    const urls = (text.match(/https?:\/\/[^\s<>"'\u3000-\u303f\u3400-\u9fff\uff00-\uffef]+/g) ?? []).filter(raw => {
      try { const url = new URL(raw); return !url.username && !url.password && !!url.hostname; } catch { return false; }
    });
    const hasDate = /\d{1,2}月\d{1,2}日|20\d{2}[-/]\d{1,2}[-/]\d{1,2}/.test(text);
    if (!hasDate && !urls.length) return [];
    return [{ text, urls, label: urls.length ? (/演示|示意|example\.(org|com|net)/.test(text) ? "演示入口 · 无真实报名功能" : "原文链接") : /截止|截至/.test(text) ? "截止时间" : "日程与日期", source: doc.name + " · " + (segment.location || "原文片段") }];
  })).filter((entry, index, all) => all.findIndex(other => other.text === entry.text) === index).slice(0, 6);
  if (!entries.length) return null;
  return <section className="document-highlights" aria-label="原文时间与入口">
    <h4>先记住这些时间与入口 <small>摘自本次所选原文</small></h4>
    <div>{entries.map(entry => <article key={entry.source + entry.text}>
      <span>{entry.label}</span>
      {entry.urls.length ? entry.urls.map(url => <a key={url} href={url} target="_blank" rel="noopener noreferrer">{url}</a>) : <strong>{entry.text}</strong>}
      {countdown(entry.text, now) && <b>{countdown(entry.text, now)}</b>}
      <details><summary>查看原文位置</summary><p>{entry.source}</p><blockquote>{entry.text}</blockquote></details>
    </article>)}</div>
  </section>;
}
