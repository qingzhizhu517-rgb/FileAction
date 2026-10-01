from pathlib import Path
from collections import Counter
import hashlib
import json
import re
from urllib.parse import unquote

ROOT = Path('/Users/a1/Desktop/newidea/doagent')
RECORD = ROOT / '.planning/2026-09-30-document-organization'
mapping = json.loads((RECORD / 'path-mapping.json').read_text())
manifest = json.loads((RECORD / 'before-manifest.json').read_text())
visible = sorted(p for p in ROOT.rglob('*.md') if not any(x.startswith('.') for x in p.relative_to(ROOT).parts))
errors = []
warnings = []
counts = Counter()
expected_changed = {'AGENTS.md', '可行动事务Agent-00-总览.md', '.obsidian/workspace.json', '.DS_Store'}
expected_changed.update(old for old in mapping if not old.startswith('_归档草稿/'))

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

# 所有原有文件可定位，除列明的编辑外逐字节保全。
for entry in manifest:
    old = entry['path']
    current = ROOT / mapping.get(old, old)
    if not current.is_file():
        errors.append(f'原文件缺失：{old} -> {current}')
        continue
    counts['original_files_preserved'] += 1
    if old == '.DS_Store':
        counts['finder_metadata_files_excluded_from_content_comparison'] += 1
    if old not in expected_changed:
        if sha(current) != entry['sha256']:
            errors.append(f'不应变更的文件发生变化：{old}')
        else:
            counts['original_files_byte_identical'] += 1
    if old.startswith('.planning/'):
        counts['historical_planning_files_unchanged'] += 1
    else:
        backup = RECORD / 'before' / old
        if not backup.is_file() or sha(backup) != entry['sha256']:
            errors.append(f'备份不完整：{old}')
        else:
            counts['backup_files_verified'] += 1

# 移动文档除新增导航、编辑日期与链接定位外，正文须与原稿完全相同。
def restore_wiki_display(match):
    content = match.group(1).replace('\\|', '|')
    if '|' in content:
        return '[[' + content.split('|', 1)[1] + ']]'
    return match.group(0)

def normalize(body):
    body = re.sub(r'^updated: .*$', 'updated: <编辑日期>', body, flags=re.M)
    body = re.sub(r'\n导航：\[\[可行动事务Agent-00-总览\|文档总览\]\] · 分类：[^\n]+\n', '', body)
    body = re.sub(r'\[\[([^\]]+)\]\]', restore_wiki_display, body)
    return body.replace('](../.planning/', '](.planning/')

for old, new in mapping.items():
    before = RECORD / 'before' / old
    after = ROOT / new
    if old.startswith('_归档草稿/'):
        if before.read_bytes() != after.read_bytes():
            errors.append(f'原始草稿被改写：{old}')
        else:
            counts['drafts_byte_identical'] += 1
    elif normalize(before.read_text()) != normalize(after.read_text()):
        errors.append(f'项目正文存在导航以外的变化：{old}')
    else:
        counts['project_bodies_preserved'] += 1

expected_missing = {'file-20260923083638730.jpg', 'file-20260923225113539.png'}
actual_missing = set()
overview_targets = set()

def table_cells(line):
    return re.split(r'(?<!\\)\|', line.strip())[1:-1]

for file in visible:
    rel = str(file.relative_to(ROOT))
    raw_draft = '原始草稿' in file.parts
    text = file.read_text()
    lines = text.splitlines()
    outside_code = []
    fence = None
    language = ''
    block = []
    table_width = None
    table_counted = False
    for number, line in enumerate(lines, 1):
        fence_match = re.match(r'^\s*(`{3,}|~{3,})(.*)$', line)
        if fence_match:
            token, suffix = fence_match.groups()
            if fence is None:
                fence, language, block = token, suffix.strip(), []
                if not language and not raw_draft:
                    errors.append(f'代码围栏缺少语言：{rel}:{number}')
            elif token[0] == fence[0] and len(token) >= len(fence) and not suffix.strip():
                if language == 'json':
                    try:
                        json.loads('\n'.join(block))
                        counts['json_examples_valid'] += 1
                    except json.JSONDecodeError as exc:
                        errors.append(f'JSON示例错误：{rel}:{number}: {exc}')
                counts['code_blocks'] += 1
                fence = None
            else:
                block.append(line)
            continue
        if fence:
            block.append(line)
            continue
        outside_code.append(line)
        if line.strip().startswith('|') and line.strip().endswith('|'):
            width = len(table_cells(line))
            if table_width is None:
                table_width, table_counted = width, False
            elif width != table_width:
                errors.append(f'表格列数不一致：{rel}:{number}，期望{table_width}，实际{width}')
            if re.fullmatch(r'[\s|:\-]+', line) and not table_counted:
                counts['tables'] += 1
                table_counted = True
        else:
            table_width = None
    if fence:
        errors.append(f'代码围栏未闭合：{rel}')
    plain = '\n'.join(outside_code)
    if not raw_draft:
        if len(re.findall(r'^# ', plain, re.M)) != 1:
            errors.append(f'一级标题不是一个：{rel}')
        if file.name != 'AGENTS.md':
            front = re.match(r'^---\n(.*?)\n---', text, re.S)
            if not front or any(not re.search(rf'^{key}:', front.group(1), re.M) for key in ['tags','created','updated','status']):
                errors.append(f'元数据缺少必要字段：{rel}')
            if front and not re.search(r'^updated: 2026-09-30$', front.group(1), re.M):
                errors.append(f'本轮编辑日期未更新：{rel}')
    # 排除行内代码中展示的链接语法示例。
    plain = re.sub(r'`[^`\n]*`', '', plain)
    for match in re.finditer(r'(!?)\[\[([^\]]+)\]\]', plain):
        content = match.group(2).replace('\\|', '|')
        target = content.split('|', 1)[0].split('#', 1)[0]
        if not target:
            continue
        dest = ROOT / (target if Path(target).suffix in {'.md','.jpg','.jpeg','.png','.pdf'} else target + '.md')
        if not dest.is_file():
            if match.group(1) == '!' and target in expected_missing and raw_draft:
                actual_missing.add(target)
                warnings.append({'file': rel, 'existing_missing_attachment': target})
            else:
                errors.append(f'Wiki链接目标不存在：{rel} -> {target}')
        else:
            counts['wiki_links_valid'] += 1
            if file.name == '可行动事务Agent-00-总览.md':
                overview_targets.add(str(dest.relative_to(ROOT)))
    for match in re.finditer(r'\]\(([^)\n]+)\)', plain):
        target = unquote(match.group(1).strip('<>'))
        if re.match(r'^[a-z][a-z0-9+.-]*:', target, re.I) or target.startswith('#'):
            continue
        target = target.split('#', 1)[0]
        if not (file.parent / target).resolve().exists():
            errors.append(f'Markdown链接目标不存在：{rel} -> {target}')
        else:
            counts['relative_markdown_links_valid'] += 1

if actual_missing != expected_missing:
    errors.append('既有缺失附件记录与原始草稿引用不一致')
for file in visible:
    if file.name != '可行动事务Agent-00-总览.md' and str(file.relative_to(ROOT)) not in overview_targets:
        errors.append(f'总览未覆盖文档：{file.relative_to(ROOT)}')
if len(visible) != 17 or len(list(ROOT.glob('*.md'))) != 2:
    errors.append('总览文档计数与实际数量不符')
counts['visible_markdown_files'] = len(visible)
counts['root_markdown_files'] = len(list(ROOT.glob('*.md')))
counts['overview_documents_reachable'] = len(overview_targets)

# 验证编辑器改动只有声明的路径及草稿标题替换。
old_state = json.loads((RECORD / 'before/.obsidian/workspace.json').read_text())
new_state = json.loads((ROOT / '.obsidian/workspace.json').read_text())
titles = {'未命名': '可行动事务Agent-原始愿景与信息复用草稿', '未命名 1': '可行动事务Agent-行动事务与协作扩展草稿'}
def expected_state(value):
    if isinstance(value, dict):
        return {key: titles.get(item, item) if key == 'title' and isinstance(item, str) else expected_state(item) for key,item in value.items()}
    if isinstance(value, list):
        return [expected_state(item) for item in value]
    return mapping.get(value,value) if isinstance(value,str) else value
if expected_state(old_state) != new_state:
    errors.append('Obsidian配置出现路径/标题以外的改动')

def check_state_paths(value, key=''):
    if isinstance(value, dict):
        for child_key, item in value.items():
            check_state_paths(item, child_key)
    elif isinstance(value, list):
        for item in value:
            check_state_paths(item, key)
    elif isinstance(value, str) and key in {'file','lastOpenFiles'}:
        if not (ROOT / value).is_file():
            errors.append(f'编辑器文件路径不存在：{value}')
        else:
            counts['editor_file_paths_valid'] += 1
check_state_paths(new_state)

# 新记录中的链接也须能在文件系统解析（当前报告在检查后写入）。
report_path = RECORD / 'document-check.json'
for match in re.finditer(r'\]\(([^)\n]+)\)', (RECORD / '整理记录.md').read_text()):
    dest = (RECORD / match.group(1)).resolve()
    if dest != report_path and not dest.exists():
        errors.append(f'整理记录引用不存在：{match.group(1)}')

report = {'date':'2026-09-30', 'scope':'文档静态核验；未执行应用测试或外部事实复核',
          'status':'pass' if not errors else 'fail', 'counts':dict(counts),
          'errors':errors, 'known_existing_warnings':warnings,
          'editor_ui_verification':'保存的布局与20处文件路径已核验；Obsidian重新打开的UI操作超时，未验证重新打开后的画面',
          'metadata_note':'.DS_Store由访达自动更新，保留整理前备份，但不将其变动判为正文变化'}
report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
raise SystemExit(1 if errors else 0)
