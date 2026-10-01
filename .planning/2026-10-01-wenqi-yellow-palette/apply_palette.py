"""将本轮已备份的 Demo 配色转换为用户指定的暖黄色板。"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / '05-交互Demo/可行动事务Agent-文启高保真Demo.html'
BACKUP = Path(__file__).parent / 'before/05-交互Demo/可行动事务Agent-文启高保真Demo.html'
source = TARGET.read_text(encoding='utf-8')
assert TARGET.read_bytes() == BACKUP.read_bytes(), '当前文件与本轮备份不同，停止以避免覆盖后续修改。'

palette = '''
:root{--bg:#FFFDF8;--white:#FFFFFF;--ink:#2B2B2B;--muted:#6B6B6B;--line:#F1E7C8;--accent:#F6C945;--accent-deep:#E6AD19;--accent-soft:#FFF7D6;--shadow:0 8px 30px #2B2B2B08}
'''
hex_pattern = re.compile(r'#[0-9a-fA-F]{3,8}\b')
old_variables = {'bg', 'white', 'ink', 'muted', 'line', 'green', 'deep', 'sage', 'lime', 'orange', 'shadow', 'lavender'}
rename_variables = {'green': 'accent', 'deep': 'accent-deep', 'sage': 'accent-soft', 'lime': 'accent-soft', 'orange': 'ink', 'lavender': 'accent-soft'}


def rgb(value):
    digits = value[1:]
    if len(digits) in (3, 4):
        digits = ''.join(c * 2 for c in digits)
    return tuple(int(digits[i:i+2], 16) for i in (0, 2, 4)), digits[6:]


def recolor_value(prop, value):
    for old, new in rename_variables.items():
        value = value.replace(f'var(--{old})', f'var(--{new})')
    if prop == 'color':
        value = re.sub(r'var\(--accent(?:-deep|-soft)?\)', 'var(--ink)', value)
    if prop.startswith('outline'):
        value = value.replace('var(--accent)', 'var(--ink)')

    def color(match):
        channels, alpha = rgb(match[0])
        lightness = sum(channels) / 3
        if prop in ('color', 'fill', '-webkit-text-fill-color'):
            return 'var(--ink)' if lightness < 101 else 'var(--muted)'
        if prop == 'accent-color':
            return 'var(--accent)'
        if 'shadow' in prop:
            return '#2B2B2B' + alpha.upper() if alpha else 'var(--line)'
        if prop.startswith('outline'):
            return 'var(--ink)'
        if prop.startswith('border') or prop == 'stroke':
            return 'var(--line)'
        if prop.startswith('background'):
            if alpha and lightness < 150:
                return '#2B2B2B' + alpha.upper()
            if min(channels) >= 250:
                return 'var(--white)'
            if lightness >= 243:
                return 'var(--bg)'
            if lightness >= 180:
                return 'var(--accent-soft)'
            return 'var(--accent)'
        raise ValueError(f'未分类的颜色属性：{prop}: {match[0]}')

    value = hex_pattern.sub(color, value)
    value = re.sub(r'(?<![\w-])white\b', 'var(--white)' if prop.startswith('background') else 'var(--ink)', value)
    return value


def recolor_declarations(text):
    def declaration(match):
        prop, value = match.group(1), match.group(2)
        return prop + ':' + recolor_value(prop, value)
    return re.sub(r'(?<=[{;])\s*([\w-]+)\s*:\s*([^;{}]+)', declaration, text)


style_match = re.search(r'<style>([\s\S]*?)</style>', source)
css = style_match[1]

def clean_root(match):
    properties = [p for p in match[1].split(';') if p and p.split(':', 1)[0].strip().removeprefix('--') not in old_variables]
    return ':root{' + ';'.join(properties) + '}' if properties else ''

css = re.sub(r':root\{([^}]+)\}', clean_root, css)
css = recolor_declarations(css)
css = css.replace('/* 莫兰迪主题：低饱和表面，深色正文，状态同时以文字说明。 */', '/* 页面表面与组件层次；具体色值由统一暖黄色板提供。 */')

# 所有页面共用一套语义色；黄色背景始终搭配深色文字。
details = '''
/* 用户指定暖黄色板：重点操作为亮黄，内容区域以暖白和白色为主。 */
body{color:var(--muted)}
h1,h2,h3,h4,strong,.brand-name,.file-title,.work-title>span,.panel-heading,.column-title,.output-paper .mail-content h3{color:var(--ink)}
button,.breadcrumb .current,.preview-toolbar,.tree-root,.eligibility-head,.eligibility-row,.session-goal-card strong{color:var(--ink)}
.btn.primary,.agent-avatar,.send-btn,.spark-node{background:var(--accent);border-color:var(--accent);color:var(--ink)}
.btn.primary:hover,.send-btn:hover{background:var(--accent-deep);border-color:var(--accent-deep);color:var(--ink)}
.btn.secondary{background:var(--white);border-color:var(--line);color:var(--ink)}
.btn.secondary:hover,.btn.soft:hover{background:var(--accent-soft);border-color:var(--accent-deep)}
.btn.soft{background:var(--accent-soft);border-color:var(--line);color:var(--ink)}
.app-header{background:var(--bg);border-color:var(--line)}
.nav-item:hover{background:var(--accent-soft);color:var(--ink)}
.nav-item.active{color:var(--ink)}
.nav-item.active:after,.tab.active:after{background:var(--accent-deep)}
.nav-item:focus-visible,button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible,.current-transaction:focus-visible,.cited-clause:focus-visible{outline-color:var(--ink)}
.brand-symbol path:nth-child(1){fill:var(--accent-deep)}
.brand-symbol path:nth-child(2){fill:var(--accent)}
.brand-symbol path:nth-child(3){fill:var(--ink)}
.hero{background:linear-gradient(110deg,var(--accent-soft),var(--bg));border-color:var(--line)}
.hero h2 em{color:var(--ink)}
.hero .art-path path{stroke:var(--accent-deep)}
.hero-art .orbit{border-color:var(--line)}
.spark-node{border-color:var(--accent-soft)}
.avatar,.header-account .avatar,.check-disc{background:var(--accent-soft);color:var(--ink)}
.thumb,.thumb.grade,.thumb.resume,.thumb.plan{background:var(--bg)}
.thumb.certificate,.thumb.poster,.poster-sheet,.certificate-sheet{background:var(--accent-soft)}
.certificate-sheet{border-color:var(--accent-deep);outline-color:var(--accent-soft)}
.certificate-sheet .medal{color:var(--accent-deep)}
.certificate-sheet h4,.poster-sheet h4{color:var(--ink)}
.poster-sheet .poster-circle,.poster-sheet .poster-circle:after{border-color:var(--accent-deep)}
.mini-line,.mini-table{background:var(--line)}
.mini-highlight,.preview-paper .mini-highlight{background:var(--accent)}
.file-card.featured,.task-card.featured{border-color:var(--accent)}
.file-card:hover,.file-grid .file-card:hover{border-color:var(--accent-deep)}
.tag,.tag.green,.tag.orange,.tag.blue,.provenance-tag,.provenance-tag.user-said,.provenance-tag.unknown{border-color:var(--line);color:var(--ink);background:var(--accent-soft)}
.tag.blue,.provenance-tag.user-said{background:var(--bg)}
.file-tree,.session-drawer,.preview-pane,.reference-dialog,.output-preview{background:var(--bg)}
.user-message p,.tree-item.selected,.mobile-work-tabs button.active,.view-toggle button.selected{background:var(--accent-soft);color:var(--ink)}
.current-transaction{background:var(--accent-soft);border-color:var(--accent)}
.current-transaction:hover,.current-transaction[aria-expanded="true"]{background:var(--accent-soft);border-color:var(--accent-deep)}
.current-transaction-icon,.current-transaction-icon.lavender{background:var(--accent);color:var(--ink)}
.current-transaction-copy>strong,.transaction-change,.transaction-option-copy strong,.transaction-selected,.action-intro .stat strong{color:var(--ink)}
.transaction-search:focus-within{border-color:var(--accent-deep);box-shadow:0 0 0 2px var(--accent-soft)}
.transaction-option:hover,.transaction-option.keyboard-active,.transaction-option[aria-selected="true"]{background:var(--accent-soft)}
.transaction-option.keyboard-active,.transaction-option[aria-selected="true"].keyboard-active{border-color:var(--accent-deep)}
.transaction-option[aria-selected="true"]>.transaction-option-icon{background:var(--accent);color:var(--ink)}
.progress-track{background:var(--accent-soft)}
.progress-track span,.dot,.agent-header .status .dot,.header-actions .demo-badge .dot,.column-title .dot.green{background:var(--accent-deep)}
.column-title .dot.gray{background:var(--muted)}
.column-title .dot{background:var(--accent)}
.recommendation{border-left-color:var(--accent-deep)}
.evidence-link,.source-chip,.fact-source-link{color:var(--ink)}
.evidence-link,.source-chip{background:var(--accent-soft);border-color:var(--line)}
.source-chip:hover,.reference-choice:hover{border-color:var(--accent-deep);background:var(--accent-soft)}
.reference-choice.active{color:var(--ink);background:var(--accent);border-color:var(--accent-deep)}
.doc-highlight,.doc-highlight.orange{background:var(--accent-soft);box-shadow:2px 0 var(--accent-soft),-2px 0 var(--accent-soft)}
.reference-dialog .doc-highlight{background:transparent;box-shadow:none;color:inherit}
.doc-highlight.active,.reference-dialog .doc-highlight.active{background:var(--accent-soft);color:var(--ink);box-shadow:0 0 0 3px var(--accent-soft);border-bottom:2px solid var(--accent-deep)}
.cited-clause::selection,.cited-clause ::selection,::selection{background:var(--accent);color:var(--ink)}
.output-tab.active{border-bottom-color:var(--accent-deep);color:var(--ink)}
.package-item.active strong{color:var(--ink)}
.package-item.active .item-icon{background:var(--accent-soft);color:var(--ink);border-color:var(--accent)}
.output-paper .editable{background:var(--accent-soft);color:var(--ink);border-color:var(--accent-deep)}
.side-card.warning-card,.eligibility-row.warning,.session-unknown,.modal .notice{background:var(--accent-soft);border-color:var(--line)}
.side-card.warning-card h3,.side-card.warning-card h3 svg,.eligibility-row.warning .state,.eligibility-row.warning svg{color:var(--ink)}
.toast{background:var(--ink);color:var(--white);border-color:var(--ink)}
'''
css = palette + css + details
result = source[:style_match.start(1)] + css + source[style_match.end(1):]
result = re.sub(r'(<meta name="theme-color" content=")[^"]+', r'\g<1>#F6C945', result)

# HTML 与动态模板中的行内颜色，以及 SVG 的演示图形，同步使用语义色。
result = re.sub(r'(style=")([^"]*)(")', lambda m: m[1] + recolor_declarations('{' + m[2])[1:] + m[3], result)
result = re.sub(r'fill="#[0-9a-fA-F]+"', 'fill="var(--accent)"', result)
result = re.sub(r'stroke="#[0-9a-fA-F]+"', 'stroke="var(--accent-deep)"', result)
assert result.count('<style>') == result.count('</style>') == 1
assert result.count('<script>') == result.count('</script>') == 1
assert not re.search(r'var\(--(?:green|deep|sage|lime|orange|lavender)\)', result)
TARGET.write_text(result, encoding='utf-8', newline='\r\n')
print('已统一 CSS、SVG、动态模板配色；保留原有布局和交互。')
