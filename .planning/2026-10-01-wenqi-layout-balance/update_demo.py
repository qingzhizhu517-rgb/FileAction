from pathlib import Path
import re

TASK=Path(__file__).resolve().parent
ROOT=TASK.parents[1]
TARGET=ROOT/'05-交互Demo/可行动事务Agent-文启高保真Demo.html'
text=(TASK/'before/05-交互Demo/可行动事务Agent-文启高保真Demo.html').read_text(encoding='utf-8')

def replace(old,new):
    global text
    if text.count(old)!=1:
        raise ValueError('需要唯一目标：'+old[:100])
    text=text.replace(old,new)

# 直接替换上一轮顶部样式，而不是继续叠加另一份导航定义。
start=text.index('/* 全局顶部导航：桌面横排，手机分成品牌工具行与页面切换行。 */')
end=text.index('</style>',start)
text=text[:start]+(TASK/'balanced-layout.css').read_text(encoding='utf-8')+'\n'+text[end:]

start=text.index('<header class="app-header">')
end=text.index('<main class="main">',start)
previous_header=text[start:end]
brand=re.search(r'<a href="#files" class="brand".*?</a>',previous_header).group(0)
nav=re.search(r'<nav class="nav".*?</nav>',previous_header).group(0)
nav=re.sub(r'<span class="count">\d+</span>','',nav)
header=f'''<header class="app-header"><div class="app-header-inner">{brand}{nav}<div class="header-actions"><span class="demo-badge" title="交互概念演示：所有内容均为合成示例，未接入模型"><span class="dot"></span>合成演示</span><button class="header-context" data-modal="context" aria-label="查看本次上下文" title="本次上下文"><i data-icon="leaf"></i></button><button class="header-tool" data-modal="tour" aria-label="路演导览" title="路演导览"><i data-icon="play"></i></button><button class="header-tool notification-tool" aria-label="查看提醒" title="查看提醒" data-toast="演示提醒：请先核对当前事务的待确认事项，未创建真实提醒。"><i data-icon="bell"></i></button><div class="header-account" aria-label="林同学的个人空间" title="林同学 · 个人空间"><div class="avatar">林</div></div></div></div></header>
'''
text=text[:start]+header+text[end:]
topbar=re.search(r'<header class="topbar">.*?</header>',text).group(0)
replace(topbar,'<div class="topbar" aria-label="本次事务"><div class="breadcrumb" id="breadcrumb"></div></div>')

# 行动页：事务选择与进度并列，删除重复的大标题宣传块。
start=text.index('<div class="action-intro">')
end=text.index('<div class="kanban">',start)
old=text[start:end]
stats=re.search(r'<div class="stats">(?:<div class="stat">.*?</div>){3}</div>',old).group(0)
selector=re.search(r'<section class="transaction-section".*?</section>',old).group(0)
text=text[:start]+f'<div class="action-intro">{selector}{stats}</div><div class="action-goal"><i data-icon="spark"></i><strong id="action-current-title"></strong></div>\n'+text[end:]
replace('<p>把“我应该做什么”，变成“我已经开始了”。</p>','<p>按事务查看准备进度，下一步由你决定。</p>')
replace("document.querySelector('#action-current-title').textContent=transactions[activeTransaction].shortTitle+' · 从眼前的一步开始';", "document.querySelector('#action-current-title').textContent='当前目标：'+transactions[activeTransaction].goal;")

# 成果页：统计轻量化放进页标题，事务及关联材料整合成一个上下文区。
start=text.index('<section class="page" id="page-deliverables">')
end=text.index('\n</main>',start)
page=text[start:end]
overview=re.search(r'<div class="package-overview">.*?</p></div>',page).group(0)
overview=re.sub(r'<p>.*?</p>','',overview)
page=re.sub(r'<div class="package-overview">.*?</p></div>','',page)
old_heading='<div class="page-heading"><div><h1>成果包</h1><p>把多份文件里的线索，汇成每个事务可用的产物。</p></div>'
if page.count(old_heading)!=1:
    raise ValueError('成果页标题不唯一')
page=page.replace(old_heading,'<div class="page-heading package-page-heading"><div><h1>成果包</h1>'+overview+'</div>')
selector=re.search(r'<section class="transaction-section".*?</section>',page).group(0)
context='<section class="package-context" id="package-context" aria-label="当前事务及关联文件"></section>'
if page.count(selector+context)!=1:
    raise ValueError('成果页上下文不连续')
page=page.replace(selector+context,'<div class="package-workbar">'+selector+context+'</div>')
text=text[:start]+page+text[end:]
replace('<h2>${item.title}</h2><p>${item.goal} · ${item.description}</p>','<h2>${item.goal}</h2><p>${item.description}</p>')
replace('function changeGoal(){sessionState.shifted=true;', "function changeGoal(){sessionState.shifted=true;transactions.scholarship.goal='先了解投入成本，暂不推进申请';renderActions();renderPackage();")

TARGET.write_text(text,encoding='utf-8',newline='\n')
print('已整理导航与页面层级：'+str(TARGET))
