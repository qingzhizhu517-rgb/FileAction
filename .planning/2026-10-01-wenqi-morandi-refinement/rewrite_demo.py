from pathlib import Path
import colorsys
import re

ROOT = Path(__file__).resolve().parents[2]
TASK = Path(__file__).resolve().parent
TARGET = ROOT / '05-交互Demo/可行动事务Agent-文启高保真Demo.html'
s = (TASK / 'before/05-交互Demo/可行动事务Agent-文启高保真Demo.html').read_text(encoding='utf-8')

def replace(old, new, count=1):
    global s
    if s.count(old) < count:
        raise ValueError('未找到预期目标：' + old[:100])
    s = s.replace(old, new, count)

def recolor(match):
    raw = match.group(0)[1:]
    rgb = raw[:6] if len(raw) >= 6 else ''.join(char * 2 for char in raw[:3])
    red, green, blue = (int(rgb[index:index+2],16)/255 for index in (0,2,4))
    hue, light, saturation = colorsys.rgb_to_hls(red,green,blue)
    if saturation < .025:
        return match.group(0)
    # 既有色彩按用途保留明暗关系，统一降低饱和度。
    if .16 <= hue <= .48:
        hue, saturation = .39, min(saturation*.26,.09)
    elif .48 < hue < .72:
        hue, saturation = .61, min(saturation*.3,.09)
    elif .72 <= hue <= .92:
        hue, saturation = .76, min(saturation*.3,.08)
    else:
        hue, saturation = .10, min(saturation*.28,.13)
    color = ''.join(f'{round(channel*255):02x}' for channel in colorsys.hls_to_rgb(hue,light,saturation))
    return '#' + color + (raw[6:] if len(raw)==8 else '')

s = re.sub(r'#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b',recolor,s)
# 小字号正文保留足够可读性，不沿用旧版过浅的文字颜色。
def readable(match):
    channels=[int(match.group(1)[i:i+2],16)/255 for i in (0,2,4)]
    hue,light,sat=colorsys.rgb_to_hls(*channels)
    if .46 < light < .80:
        channels=colorsys.hls_to_rgb(hue,.44,sat)
    return 'color:#'+''.join(f'{round(v*255):02x}' for v in channels)
s=re.sub(r'(?<![-\w])color:#([0-9a-f]{6})\b',readable,s)
replace('</style>',(TASK/'refinement.css').read_text(encoding='utf-8')+'\n</style>')
s=re.sub(r'<meta name="theme-color" content="[^"]+">','<meta name="theme-color" content="#61736d">',s)
replace('<a href="#workspace" class="nav-item" data-nav="workspace" title="Agent 工作台"><i data-icon="spark"></i><span>Agent 工作台</span></a>','')
replace('<span>我的行动</span><span class="count">3</span>','<span>我的行动</span><span class="count">6</span>')
replace('<button data-pane="preview">文件预览</button>','')

# 原文预览移出对话网格，成为默认关闭的原生弹层。
preview_start=s.index('<div class="preview-pane">')
preview_end=s.index('\n<div class="agent-pane">',preview_start)
s=s[:preview_start]+s[preview_end:]
dialog='''<div class="reference-menu" id="reference-menu" role="menu" aria-label="条款引用菜单" hidden><p>核对这段话的来源</p><button id="view-reference" role="menuitem"><i data-icon="file"></i>查看引用<small id="reference-menu-count"></small></button></div>
<dialog class="reference-dialog" id="reference-dialog" aria-labelledby="reference-title" aria-describedby="reference-description"><header class="reference-dialog-header"><div><h2 id="reference-title">来源文件</h2><p id="reference-description">引用已定位并高亮。</p></div><button class="icon-button" id="reference-close" aria-label="关闭来源预览"><i data-icon="x"></i></button></header><div class="reference-choice-list" id="reference-choices" aria-label="引用来源"></div><div class="preview-pane"><div class="preview-toolbar"><div><i data-icon="file"></i><span id="preview-name"></span></div><span class="tag">合成示例</span></div><div class="preview-scroll"><article class="document-page" id="document-preview"></article></div><div class="preview-bottom"><span id="reference-location" role="status">查看文件全文</span><span>按 Esc 或点击关闭，返回原处</span></div></div></dialog>
'''
replace('<div class="settlement-backdrop"',dialog+'<div class="settlement-backdrop"')

# 保留既有奖学金对话节点与沉淀状态，为另一事务补充独立示例。
replace('<aside class="file-tree">','<aside class="file-tree"><div class="thread-tree" data-thread="scholarship">')
tree_end=s.index('</section></aside>',s.index('<aside class="file-tree">'))
innovation_tree='''</section></div><div class="thread-tree" data-thread="innovation" hidden><div class="panel-heading">本次事务<i data-icon="panel"></i></div><div class="tree-root"><i data-icon="folder-open"></i>校园创新周交流</div><button class="tree-item" data-document="innovation"><i data-icon="file"></i>校园创新周参与通知</button><div class="tree-caption">关联的材料 · 2</div><div class="tree-connect"><button class="tree-item" data-document="project"><i data-icon="file"></i>校园无障碍地图 · 项目构想</button><button class="tree-item" data-document="resume"><i data-icon="file"></i>个人简历 · 2026 秋</button></div><div class="tree-caption">待你确认</div><button class="tree-item missing" data-reference="eventTime"><i data-icon="clock"></i>当天时间与预约安排</button><div class="tree-caption">本次生成</div><button class="tree-item" data-go="deliverables"><i data-icon="user"></i>开放交流介绍草稿</button><button class="tree-item" data-go="deliverables"><i data-icon="list"></i>反馈交流提纲</button><section class="session-summary"><div class="session-summary-head"><i data-icon="leaf"></i>只带上相关的背景</div><p>项目仍在想法阶段，尚无原型。<br>参与交流不等于需求已经验证。</p><div class="session-mini-row"><span>当前目标</span><strong>先收集具体反馈</strong></div><div class="session-mini-row"><span>尚未完成</span><strong class="pending">时间确认与活动预约</strong></div></section></div></aside>'''
s=s[:tree_end]+innovation_tree+s[tree_end+len('</section></aside>'):]
replace('<div class="conversation" id="conversation">','<div class="conversation" id="conversation" data-thread="scholarship">')
replace('<div class="user-message"><p>这份奖学金通知','<div class="reference-hint"><i data-icon="file"></i>选中有依据的条款，右键“查看引用”；也可点击原文按钮。</div><div class="user-message"><p>这份奖学金通知')
replace('你的成绩排名在专业前 <strong>5%</strong>，符合通知中的成绩排名要求；竞赛证书也可以作为支撑材料。','<span class="cited-clause" tabindex="0" data-citations="grades rank">你的成绩排名在专业前 <strong>5%</strong>，符合通知中的成绩排名要求；</span><span class="cited-clause" tabindex="0" data-citations="certificate">竞赛证书也可以作为支撑材料。</span>')
replace('<div>成绩排名：6 / 120，前 5%<small>','<div><span class="cited-clause" tabindex="0" data-citations="grades">成绩排名：6 / 120，前 5%</span><small>')
replace('要求：原则上位于专业前 10%<button','<span class="cited-clause" tabindex="0" data-citations="rank">要求：原则上位于专业前 10%</span><button')
replace('<div>创新创业大赛 · 省级二等奖<small>','<div><span class="cited-clause" tabindex="0" data-citations="certificate">创新创业大赛 · 省级二等奖</span><small>')
replace('申请截止于 10 月 12 日 18:00。','<span class="cited-clause" tabindex="0" data-citations="deadline">申请截止于 10 月 12 日 18:00。</span>')
replace('<mark class="doc-highlight active">专业排名','<mark class="doc-highlight" id="highlight-grades">专业排名')
replace('<mark class="doc-highlight">省级二等奖','<mark class="doc-highlight" id="highlight-certificate">省级二等奖')
replace('<mark class="doc-highlight">校园无障碍地图','<mark class="doc-highlight" id="highlight-resume">校园无障碍地图')
innovation_chat='''<div class="conversation" id="innovation-conversation" data-thread="innovation" hidden><div class="conversation-intro"><i data-icon="link"></i>已关联 3 份文件<span class="tag blue">当前目标：收集具体反馈</span></div><div class="reference-hint"><i data-icon="file"></i>选中有依据的条款，右键“查看引用”；也可点击原文按钮。</div><div class="user-message"><p>我只有一个校园无障碍地图的想法，还没有原型。<br>这次创新周适合参加吗？帮我准备一下。</p><div class="avatar">林</div></div><div class="agent-answer"><div class="assistant-label"><i data-icon="spark"></i>与你有关的发现</div><h3>带着问题去，<br>想法也可以是一个开始。</h3><p><span class="cited-clause" tabindex="0" data-citations="innovation">开放交流允许个人参加，不要求已有可演示原型。</span><button class="evidence-link" data-reference="innovation">通知 § 2</button><span class="cited-clause" tabindex="0" data-citations="project resume">你的项目仍在想法阶段，尚无原型。</span>建议先把这次目标放在了解具体经历与寻找交流对象。</p><div class="eligibility"><div class="eligibility-head"><strong>你的阶段 × 活动方式</strong><span>先连接，再推进</span></div><div class="eligibility-row"><i data-icon="check-circle"></i><div><span class="cited-clause" tabindex="0" data-citations="innovation">开放交流 · 可个人参加</span><small>不必把想法包装成成熟项目</small></div><span class="state">通知依据</span></div><div class="eligibility-row"><i data-icon="link"></i><div><span class="cited-clause" tabindex="0" data-citations="project">校园无障碍地图 · 想法阶段</span><small>可以先听具体场景与现有解决办法</small></div><span class="state">已有材料</span></div><div class="eligibility-row warning"><i data-icon="alert-circle"></i><div><span class="cited-clause" tabindex="0" data-citations="eventTime">10 月 15 日 19:00–21:00</span><small>个人时间与预约安排仍需确认</small></div><span class="state">待确认</span></div></div><div class="recommendation"><strong>先准备一个简短介绍，再带上几个问题。</strong><p>我结合通知、项目构想和简历整理了介绍草稿、交流提纲与准备清单。没有编造原型、用户访谈或报名结果。</p></div><button class="draft-preview" style="width:100%;text-align:left" data-go="deliverables"><div class="draft-icon"><i data-icon="user"></i></div><div><strong>开放交流介绍与提问草稿</strong><p>3 项产物 · 待你检查 · 尚未发布</p></div><i data-icon="arrow-up-right"></i></button><div class="next-buttons"><button class="btn primary" data-go="deliverables"><i data-icon="pen"></i>查看交流成果包</button><button class="btn secondary" data-go="actions">查看参与准备<i data-icon="arrow-right"></i></button></div></div></div>'''
replace('<div class="composer-wrap">',innovation_chat+'<div class="composer-wrap">')
replace('<div class="composer-hints"><button id="change-goal">','<div class="composer-hints" data-thread="scholarship"><button id="change-goal">')
replace('<form class="composer" id="chat-form">','<div class="composer-hints" data-thread="innovation" hidden><button data-go="deliverables">先看看交流介绍</button><button data-go="actions">确认参与安排</button><button data-toast="演示：仅保留本次想法，没有预约或发布。">先存着，不行动</button></div><form class="composer" id="chat-form">')
replace('4 份参考文件<span>','<b id="reference-count" style="font-weight:400">4 份参考文件</b><span>')

old_switch='<div class="section-row"><div class="tabs"><button class="tab active" data-action-filter="all">全部事务</button><button class="tab" data-action-filter="scholarship">奖学金申请</button><button class="tab" data-action-filter="innovation">创新周交流</button></div><span class="text-button"><i data-icon="list"></i>按事务整理，而不是按文件</span></div>'
replace(old_switch,'<section class="transaction-section" aria-labelledby="action-transaction-title"><div class="transaction-section-heading"><h2 id="action-transaction-title"><i data-icon="layers"></i>选择要推进的事务</h2><p>切换事务，查看它的下一步</p></div><div class="transaction-switcher" id="action-transactions" role="group" aria-labelledby="action-transaction-title"></div></section>')
replace('<h2>不是更多待办，是更近一步。</h2>','<h2 id="action-current-title">从眼前的一步开始。</h2>')
replace('>打开工作台<','>继续对话<')
replace('<button class="btn secondary" data-modal="innovation">预览内容</button>','<button class="btn secondary" data-go="deliverables">查看交流草稿</button>')
package='''<section class="page" id="page-deliverables"><div class="content"><div class="page-heading"><div><h1>成果包</h1><p>把多份文件里的线索，汇成每个事务可用的产物。</p></div><div class="heading-actions"><button class="btn secondary" data-go="conversation"><i data-icon="arrow-left"></i>继续当前事务</button><button class="btn primary" id="export-package"><i data-icon="download"></i>导出当前成果包</button></div></div><div class="package-overview"><div><strong>02</strong><span>个事务</span></div><div><strong>06</strong><span>项产物</span></div><div><strong>06</strong><span>份来源文件</span></div><p>同一份材料，可在不同事务中复用。</p></div><section class="transaction-section" aria-labelledby="package-transaction-title"><div class="transaction-section-heading"><h2 id="package-transaction-title"><i data-icon="layers"></i>选择事务，查看成果</h2><p>按目标收纳，不按单个文件分隔</p></div><div class="transaction-switcher" id="package-transactions" role="group" aria-labelledby="package-transaction-title"></div></section><section class="package-context" id="package-context" aria-label="当前事务及关联文件"></section><div class="view-summary"><i data-icon="check-circle"></i><span id="package-summary" role="status"></span><span>已生成草稿 ≠ 已完成行动</span></div><div class="deliverable-layout"><div class="output-preview"><div class="output-tabs" id="output-tabs" aria-label="产物切换"></div><div class="output-paper-wrap"><article class="output-paper" id="output-content" aria-live="polite"></article></div><div class="output-bottom"><span id="output-edit-note"></span><button data-toast="草稿仅在当前页面保留；刷新后恢复示例内容，未写入长期存储。"><i data-icon="shield"></i>仅本次页面保存</button></div></div><aside class="output-side"><div class="side-card"><h3><i data-icon="package"></i>当前事务的产物</h3><p>每一种产物服务于同一个目标。</p><div id="package-items"></div></div><div class="side-card"><h3><i data-icon="shield"></i>交给你之前，再检查一遍</h3><div id="package-audit"></div></div><div class="side-card warning-card"><h3><i data-icon="alert-circle"></i>行动前，再确认</h3><p id="package-warning"></p><div class="review-actions"><button class="btn secondary" data-go="conversation">继续和 Agent 修改</button></div></div></aside></div></div></section>'''
start=s.index('<section class="page" id="page-deliverables">')
end=s.index('\n</main>',start)
s=s[:start]+package+s[end:]

start=s.index('function setDocument(id)')
end=s.index('\nconst letterOutput',start)
s=s[:start]+'''function setDocument(id){if(id!=='notice'&&!relatedDocuments[id])return;document.querySelector('#document-preview').innerHTML=id==='notice'?noticeDocument:relatedDocuments[id];document.querySelectorAll('#document-preview .doc-highlight').forEach(mark=>mark.classList.remove('active'));document.querySelector('#preview-name').textContent={notice:'申报通知.pdf',grades:'学年成绩单.pdf',certificate:'获奖证书.jpg',resume:'个人简历.docx',innovation:'校园创新周参与通知.pdf',project:'校园无障碍地图-项目构想.docx'}[id];document.querySelectorAll('[data-document]').forEach(button=>button.classList.toggle('selected',button.dataset.document===id));document.querySelector('.preview-scroll').scrollTop=0}'''+s[end:]
start=s.index('function showOutput(key)')
end=s.index('\nlet toastTimer',start)
s=s[:start]+'''function showOutput(key){renderOutput(key)}
function route(){
  const requested=location.hash.slice(1)||'files';
  const page=requested==='workspace'?'conversation':['files','conversation','actions','deliverables'].includes(requested)?requested:'files';
  closeReferenceMenu();closeReference();
  document.body.classList.toggle('focus-mode',page==='conversation');
  document.querySelectorAll('.page').forEach(element=>element.classList.toggle('active',element.id==='page-'+(page==='conversation'?'workspace':page)));
  document.querySelectorAll('[data-nav]').forEach(element=>element.classList.toggle('active',element.dataset.nav===(page==='conversation'?'files':page)));
  const label={files:'文件空间',conversation:'Agent 对话',actions:'我的行动',deliverables:'成果包'}[page];
  document.querySelector('#breadcrumb').innerHTML=page==='conversation'?`<button class="icon-button" data-go="files" aria-label="返回文件空间">${icon('arrow-left')}</button><div class="work-title"><span>${transactions[activeTransaction].title}</span><small>／</small><small>Agent 对话</small><span class="tag">${transactions[activeTransaction].state}</span></div>`:`${icon('home')}<span>个人空间</span>${icon('chevron-right')}<span class="current">${label}</span>`;
  document.title=`${label} · 文启 FileAction`;window.scrollTo(0,0);
}'''+s[end:]
replace('40 秒 · 有依据的个性化判断</strong><p>成绩排名符合，但综测未知。点击原文依据，','40 秒 · 有依据的个性化判断</strong><p>成绩排名符合，但综测未知。右键条款查看引用，')
start=s.index('function focusSessionSource(source)')
end=s.index("\ndocument.addEventListener('click',event=>{",start)
s=s[:start]+'''function focusSessionSource(source){
  closeSessionDrawer();
  openReference(source);
}
'''+s[end:]
replace("location.hash='workspace';","location.hash='conversation';")
s=s.replace(".classList.remove('show-tree','show-preview')",".classList.remove('show-tree')")
replace("if(button.dataset.modal==='context')openSessionDrawer();", "if(button.dataset.modal==='context'){if(activeTransaction==='scholarship')openSessionDrawer();else openModal('innovationContext');}")
replace("if(button.dataset.file){const id=button.dataset.file;if(['innovation','project'].includes(id))openModal('innovation');else{setDocument(id);location.hash='workspace'}}", "if(button.dataset.file)enterConversation(button.dataset.file);")
replace("if(button.dataset.document)setDocument(button.dataset.document);", "if(button.dataset.document)previewDocument(button.dataset.document);")
evidence_start=s.index('if(button.dataset.evidence){setDocument')
evidence_end=s.index('if(button.dataset.pane)',evidence_start)
s=s[:evidence_start]+"if(button.dataset.evidence)openReference(button.dataset.evidence);"+s[evidence_end:]
pane_start=s.index('if(button.dataset.pane)')
pane_end=s.index("if(button.id==='change-goal')",pane_start)
s=s[:pane_start]+"if(button.dataset.pane){document.querySelector('#workspace-shell').classList.toggle('show-tree',button.dataset.pane==='tree');document.querySelectorAll('[data-pane]').forEach(tab=>tab.classList.toggle('active',tab===button))}"+s[pane_end:]
replace("if(/换|不想|时间|投入|暂停/.test(text))", "if(activeTransaction==='innovation'){toast('这是静态演示。可查看交流成果包与参与准备，尚未连接 AI。');return}if(/换|不想|时间|投入|暂停/.test(text))")
replace("renderIcons();refreshSessionSummary();renderFiles();setDocument('notice');showOutput('letter');route();", "renderIcons();refreshSessionSummary();renderFiles();setDocument('notice');selectTransaction('scholarship');route();")
s=s.replace('data-go="workspace"','data-go="conversation"')
# 上传样例应明确回到通知所属事务，不能继承另一个事务。
replace('data-go="conversation">使用示例文件，看看下一步','data-file="notice">使用示例文件，看看下一步')
# 文件卡显式提示点击后进入对话。
replace("</div></div></button>`).join('')", "</div><div class=\"file-entry-note\">进入事务对话 ${icon('arrow-up-right')}</div></div></button>`).join('')")
extra=(TASK/'refinement.js').read_text(encoding='utf-8')
replace("\nfunction changeGoal(){",'\n'+extra+'''\nmodalTemplates.innovationContext = `<div class="eyebrow">RELEVANT CONTEXT</div><h2 id="modal-title">本次交流的相关背景</h2><p>依据活动通知、项目构想和个人简历整理。</p><div class="context-list"><div class="context-row"><span>本次目标</span><strong>先收集具体反馈</strong></div><div class="context-row"><span>项目阶段</span><strong>想法阶段 · 尚无原型</strong></div><div class="context-row"><span>仍需确认</span><strong>当天时间与预约方式</strong></div></div><div class="notice">合成示例；没有真实访谈、预约或长期记忆写入。</div><button class="btn primary full" data-go="conversation">回到对话</button>`;
function changeGoal(){''')
TARGET.write_text(s,encoding='utf-8',newline='\n')
print(f'已更新 {TARGET}，{len(s):,} 个字符')
