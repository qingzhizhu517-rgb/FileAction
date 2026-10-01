from pathlib import Path
import hashlib
import json
import re

ROOT = Path('/Users/a1/Desktop/newidea/doagent')
RECORD = ROOT / '.planning/2026-09-30-document-organization'
PREFIX = '可行动事务Agent-'
CATEGORIES = {
    '01-产品方案': ['Idea完善方案', '问题处理与方案审定', '产品定义', '定位决策', '内部筛选速览'],
    '02-调研与可行性': ['市场调研与验证', '可行性分析'],
    '03-参赛与路演': ['西客松参赛对齐', '路演答辩应答卡'],
    '04-学时备选': ['学分认定Demo规格', 'Demo状态表', 'UI原型规格表'],
    '90-历史归档': ['核查修订报告'],
}
mapping = {f'{PREFIX}{name}.md': f'{folder}/{PREFIX}{name}.md'
           for folder, names in CATEGORIES.items() for name in names}
mapping.update({
    '_归档草稿/未命名.md': f'90-历史归档/原始草稿/{PREFIX}原始愿景与信息复用草稿.md',
    '_归档草稿/未命名 1.md': f'90-历史归档/原始草稿/{PREFIX}行动事务与协作扩展草稿.md',
})
manifest = json.loads((RECORD / 'before-manifest.json').read_text())
for entry in manifest:
    file = ROOT / entry['path']
    assert file.is_file(), f'原文件不存在：{file}'
    assert hashlib.sha256(file.read_bytes()).hexdigest() == entry['sha256'], f'原文件已被修改：{file}'
for old, new in mapping.items():
    assert not (ROOT / new).exists(), f'目标路径已存在：{new}'

(RECORD / 'path-mapping.json').write_text(json.dumps(mapping, ensure_ascii=False, indent=2) + '\n')
for old, new in mapping.items():
    target = ROOT / new
    target.parent.mkdir(parents=True, exist_ok=True)
    (ROOT / old).rename(target)
(ROOT / '_归档草稿').rmdir()  # 仅移除已迁空的原目录。

wiki_mapping = {old.removesuffix('.md'): new.removesuffix('.md') for old, new in mapping.items()}
def rewrite_wiki(match):
    content = match.group(1)
    target, pipe, label = content.partition('|')
    name, hashmark, anchor = target.partition('#')
    if name not in wiki_mapping:
        return match.group(0)
    rewritten = wiki_mapping[name] + (hashmark + anchor if hashmark else '')
    display = label if pipe else Path(name).name
    return '[[' + rewritten + '|' + display + ']]'

for folder, names in CATEGORIES.items():
    for name in names:
        file = ROOT / folder / f'{PREFIX}{name}.md'
        body = file.read_text()
        body = re.sub(r'\[\[([^\]]+)\]\]', rewrite_wiki, body)
        body = '\n'.join(
            re.sub(r'\[\[([^\]]+)\]\]', lambda m: m.group(0).replace('|', '\\|'), line)
            if line.lstrip().startswith('|') else line for line in body.split('\n'))
        if name == '问题处理与方案审定':
            body = body.replace('](.planning/', '](../.planning/')
        body = re.sub(r'^updated: .*$', 'updated: 2026-09-30', body, count=1, flags=re.M)
        category = folder.split('-', 1)[1]
        body = re.sub(r'^(# [^\n]+)\n',
                      r'\1\n\n导航：[[可行动事务Agent-00-总览|文档总览]] · 分类：' + category + '\n',
                      body, count=1, flags=re.M)
        file.write_text(body)

# 只迁移编辑器保存的文档路径及相应页签标题，不改变布局和设置。
workspace = ROOT / '.obsidian/workspace.json'
state = json.loads(workspace.read_text())
title_mapping = {
    '未命名': f'{PREFIX}原始愿景与信息复用草稿',
    '未命名 1': f'{PREFIX}行动事务与协作扩展草稿',
}
def update_state(value):
    if isinstance(value, dict):
        return {key: (title_mapping.get(item, item) if key == 'title' and isinstance(item, str)
                      else update_state(item)) for key, item in value.items()}
    if isinstance(value, list):
        return [update_state(item) for item in value]
    if isinstance(value, str):
        return mapping.get(value, value)
    return value
workspace.write_text(json.dumps(update_state(state), ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'moved_documents': len(mapping), 'categories': list(CATEGORIES)}, ensure_ascii=False))
