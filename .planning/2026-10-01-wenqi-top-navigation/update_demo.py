from pathlib import Path
import re

TASK=Path(__file__).resolve().parent
ROOT=TASK.parents[1]
TARGET=ROOT/'05-交互Demo/可行动事务Agent-文启高保真Demo.html'
text=(TASK/'before/05-交互Demo/可行动事务Agent-文启高保真Demo.html').read_text(encoding='utf-8')

def replace(old,new):
    global text
    if text.count(old)!=1:
        raise ValueError('需要唯一目标：'+old[:90])
    text=text.replace(old,new)

# 删除旧侧栏与导航的专用样式，避免窄屏和对话模式继续产生左侧或底部占位。
start=text.index('<style>')+len('<style>')
end=text.index('</style>')
old_styles=text[start:end]
retired=re.compile(r'\.(?:sidebar|brand|brand-name|brand-symbol|workspace-picker|nav-caption|nav|nav-item|sidebar-bottom|side-note|user|main|topbar|top-right)(?![\w-])')
def clean_rule(match):
    selectors=match.group(1).split(',')
    kept=[selector for selector in selectors if not retired.search(selector)]
    if len(kept)==len(selectors):
        return match.group(0)
    return ','.join(kept)+'{'+match.group(2)+'}' if kept else ''
styles=re.sub(r'([^{}]+)\{([^{}]*)\}',clean_rule,old_styles)
styles+='\n'+(TASK/'top-navigation.css').read_text(encoding='utf-8')+'\n'
text=text[:start]+styles+text[end:]

start=text.index('<aside class="sidebar">')
end=text.index('</aside>',start)+len('</aside>')
old_sidebar=text[start:end]
brand=re.search(r'<a href="#files" class="brand".*?</a>',old_sidebar).group(0)
nav=re.search(r'<nav class="nav".*?</nav>',old_sidebar).group(0)
header=f'''<header class="app-header"><div class="app-header-inner">{brand}
{nav}
<div class="header-actions"><button class="header-context" data-modal="context" aria-label="查看本次上下文" title="查看本次上下文"><i data-icon="leaf"></i><span class="header-context-label">本次上下文</span></button><div class="header-account" aria-label="林同学的个人空间"><div class="avatar">林</div><div class="account-copy"><strong>林同学</strong><small>个人空间</small></div></div></div></div></header>'''
text=text[:start]+header+text[end:]
replace('<span class="demo-badge"><span class="dot"></span>交互概念演示 · 示例数据</span>','<span class="demo-badge"><span class="dot"></span><span class="demo-full">交互概念演示 · 示例数据</span><span class="demo-compact">合成示例</span></span>')
replace('<button class="text-button" data-modal="tour"><i data-icon="play"></i>路演导览</button>','<button class="text-button" data-modal="tour" aria-label="路演导览" title="路演导览"><i data-icon="play"></i><span class="tour-label">路演导览</span></button>')
replace("  document.querySelectorAll('[data-nav]').forEach(element=>element.classList.toggle('active',element.dataset.nav===(page==='conversation'?'files':page)));", """  document.querySelectorAll('[data-nav]').forEach(element=>{
    const active=element.dataset.nav===(page==='conversation'?'files':page);
    element.classList.toggle('active',active);
    if(active)element.setAttribute('aria-current','page');else element.removeAttribute('aria-current');
  });""")
TARGET.write_text(text,encoding='utf-8',newline='\n')
print('已将全局侧栏替换为顶部导航：'+str(TARGET))
