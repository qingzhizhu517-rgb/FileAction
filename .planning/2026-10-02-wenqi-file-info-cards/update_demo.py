from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
TASK = Path(__file__).parent
TARGET = ROOT / '05-交互Demo/可行动事务Agent-文启高保真Demo.html'
BACKUP = TASK / 'before/05-交互Demo/可行动事务Agent-文启高保真Demo.html'
assert TARGET.read_bytes() == BACKUP.read_bytes(), '当前内容与本轮备份不一致，停止以免覆盖后续修改。'
source = TARGET.read_text(encoding='utf-8')

summaries = {
    'notice': '包含申请条件、材料要求与截止时间。',
    'grades': '记录学年课程成绩与专业排名。',
    'certificate': '创新创业大赛省级二等奖的获奖证明。',
    'resume': '介绍学业经历、项目想法与当前意向。',
    'innovation': '说明开放交流的参与条件、时间与准备事项。',
    'project': '记录校园无障碍地图的初步想法与待探索问题。',
}
files_match = re.search(r'const files=\[.*?\];', source)
assert files_match
files_data = files_match[0]
for key, summary in summaries.items():
    old = "{id:'" + key + "',"
    assert files_data.count(old) == 1
    files_data = files_data.replace(old, old + "summary:'" + summary + "',")
source = source[:files_match.start()] + files_data + source[files_match.end():]

# 不再渲染缩略图，保留各轮快照中的旧实现。
source, removed = re.subn(r'^function (?:paperLines|thumbnail)\([^\n]+\n', '', source, flags=re.M)
assert removed == 2
start = source.index('/* 文件空间预览采用统一画框，取消装饰性倾斜与悬停位移。 */')
end = source.index('</style>', start)
source = source[:start] + (TASK / 'file-info-cards.css').read_text(encoding='utf-8') + '\n' + source[end:]

renderer = '''function fileTransactions(file){
  return Object.values(transactions).filter(transaction=>transaction.files.includes(file.id));
}
function fileCardMarkup(file){
  const escape=escapePickerText;
  const related=fileTransactions(file);
  const summary=typeof file.summary==='string'?file.summary.trim():'';
  const id=escape(file.id);
  return `<article class="file-card ${file.id==='notice'?'featured':''}" aria-labelledby="file-title-${id}">
    <div class="file-card-heading">
      <span class="file-format-icon" aria-hidden="true">${icon(file.kind==='JPG'?'award':'file')}</span>
      <div class="file-card-name">
        <h3 class="file-card-title" id="file-title-${id}"><button type="button" class="file-card-open" data-file="${id}" aria-label="进入${escape(file.title)}的事务对话">${escape(file.title)}</button></h3>
        <div class="file-card-meta"><span>${escape(file.kind)}</span><span>${escape(file.size)}</span><span>${escape(file.date)} 上传</span></div>
      </div>
    </div>
    ${summary?`<p class="file-card-description">${escape(summary)}</p>`:''}
    <div class="file-card-relations" aria-label="关联事务">
      ${related.length?`<span class="file-card-relations-label">关联事务</span>${related.map(transaction=>`<span class="file-relation">${icon('link')}${escape(transaction.shortTitle)}</span>`).join('')}`:'<span class="file-unlinked">未关联事务</span>'}
    </div>
    <div class="file-card-footer">
      <button type="button" class="file-card-preview" data-preview-document="${id}" aria-label="预览原文：${escape(file.title)}">${icon('expand')}预览原文</button>
      <span class="file-card-entry" aria-hidden="true">进入事务对话 ${icon('arrow-up-right')}</span>
    </div>
  </article>`;
}
function renderFiles(){
  const query=document.querySelector('#file-search').value.trim().toLowerCase();
  const visible=files.filter(file=>(activeFilter==='all'||file.type===activeFilter)&&(file.title+file.tags.flat().join('')).toLowerCase().includes(query));
  document.querySelector('#file-grid').innerHTML=visible.length?visible.map(fileCardMarkup).join(''):'<div class="empty-state">没有找到匹配的文件，试试“奖学金”或“成绩”。</div>';
}'''
source, replaced = re.subn(r'^function renderFiles\(\)[^\n]+', lambda _: renderer, source, count=1, flags=re.M)
assert replaced == 1
source = source.replace('aria-label="矩阵视图"', 'aria-label="卡片视图"')
source = source.replace("textContent='关联文件预览 · 合成示例'", "textContent='文件原文预览 · 合成示例'")
assert '<div class="thumb ${file.thumb}">' not in source
TARGET.write_text(source, encoding='utf-8', newline='\r\n')
print('已替换为文件信息卡片，并接入既有原文预览与事务入口。')
