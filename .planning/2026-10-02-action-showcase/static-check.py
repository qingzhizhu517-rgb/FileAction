"""检查当前宣传页，不以历史路演快照约束用户后续编辑。"""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import subprocess

root = Path('07-宣传页')
for path in root.glob('*.js'):
    subprocess.run(['node', '--check', str(path)], check=True)


class Audit(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.refs, self.stack = [], [], []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'id' in attrs:
            self.ids.append(attrs['id'])
        if tag in {'a', 'link', 'script', 'img', 'use'}:
            self.refs.append(attrs.get('href') or attrs.get('src') or '')
        if tag not in {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        assert self.stack.pop() == tag, tag


audit = Audit()
audit.feed((root / 'index.html').read_text())
assert not audit.stack
assert len(audit.ids) == len(set(audit.ids))
for ref in audit.refs:
    part = urlsplit(ref)
    if part.scheme or part.netloc:
        continue
    if part.path:
        assert (root / unquote(part.path)).exists(), ref
    elif part.fragment:
        assert part.fragment in audit.ids, ref
print('通过：全部 JavaScript 语法、HTML 标签、唯一 ID、资源和锚点。')

text = (root / '可行动事务Agent-宣传页说明.md').read_text()
fenced, headings, table_width = False, 0, None
for line in text.splitlines():
    if line.startswith('```'):
        fenced = not fenced
        if fenced:
            assert line[3:]
        continue
    if fenced:
        continue
    headings += line.startswith('# ')
    if line.startswith('|'):
        width = line.count('|')
        table_width = width if table_width is None else table_width
        assert width == table_width
    else:
        table_width = None
assert headings == 1 and not fenced
for link in text.split('[[')[1:]:
    assert Path(link.split(']]')[0].split('|')[0] + '.md').exists()
assert 'updated: 2026-10-02' in text
print('通过：说明标题、表格、代码围栏、库内链接与更新日期。')
