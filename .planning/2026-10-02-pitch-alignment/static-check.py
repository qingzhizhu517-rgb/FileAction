"""从仓库根目录检查宣传页资源、语法与说明结构。"""
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import subprocess

root = Path('07-宣传页')
for path in root.glob('*.js'):
    subprocess.run(['node', '--check', str(path)], check=True)
print('通过：全部宣传页 JavaScript 语法。')


class Audit(HTMLParser):
    void = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
            'link', 'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self):
        super().__init__()
        self.ids = []
        self.refs = []
        self.scripts = []
        self.stack = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if 'id' in a:
            self.ids.append(a['id'])
        if tag in {'script', 'link', 'a', 'img', 'use'}:
            value = a.get('href') or a.get('src')
            if value:
                self.refs.append(value)
        if tag == 'script':
            self.scripts.append(a.get('src'))
        if tag not in self.void:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        assert self.stack and self.stack[-1] == tag, (tag, self.stack)
        self.stack.pop()


audit = Audit()
audit.feed((root / 'index.html').read_text())
assert not audit.stack, audit.stack
assert all(n == 1 for n in Counter(audit.ids).values()), '重复 ID'
for ref in audit.refs:
    value = urlsplit(ref)
    if value.scheme or value.netloc:
        continue
    if value.path:
        assert (root / unquote(value.path)).exists(), ref
    elif value.fragment:
        assert value.fragment in audit.ids, ref
assert 'trusted-reuse.js' not in audit.scripts
assert audit.scripts.index('pitch-examples.js') < audit.scripts.index('opportunity-radar.js') < audit.scripts.index('pitch-flow.js')
print('通过：HTML 标签闭合、唯一 ID、资源与锚点、共享数据加载顺序。')

text = (root / '可行动事务Agent-宣传页说明.md').read_text()
inside_code = False
headings = 0
table_width = None
for line in text.splitlines():
    if line.startswith('```'):
        inside_code = not inside_code
        if inside_code:
            assert line[3:], '代码围栏缺少语言'
        continue
    if inside_code:
        continue
    headings += line.startswith('# ')
    if line.startswith('|'):
        width = line.count('|')
        if table_width is None:
            table_width = width
        assert width == table_width, line
    else:
        table_width = None
assert headings == 1
assert not inside_code
assert 'updated: 2026-10-02' in text.splitlines()
for segment in text.split('[[')[1:]:
    target = segment.split(']]')[0].split('|')[0]
    assert Path(target + '.md').exists(), target
assert Path('路演.md').read_bytes() == Path('.planning/2026-10-02-pitch-alignment/路演.md').read_bytes()
print('通过：说明标题、表格、围栏、链接、更新日期；路演原文与备份一致。')
