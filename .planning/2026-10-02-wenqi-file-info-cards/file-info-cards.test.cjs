const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('../2026-10-01-wenqi-morandi-refinement/test-runtime/node_modules/jsdom');
const html = fs.readFileSync(path.resolve(__dirname, '../../05-交互Demo/可行动事务Agent-文启高保真Demo.html'), 'utf8');

// 仅验证 DOM 和交互状态，不模拟真实浏览器几何排版或鼠标命中测试。
function mount(t) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(html, {
    url: 'https://demo.test/#files', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = () => {};
      window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
    }
  });
  t.after(() => { dom.window.close(); assert.deepEqual(errors, []); });
  const document = dom.window.document;
  const q = selector => { const element = document.querySelector(selector); assert.ok(element, selector); return element; };
  return { window: dom.window, document, q };
}

test('六个文件展示信息卡片，关联事务覆盖共享文件且没有缩略图', t => {
  const { document, q } = mount(t);
  assert.equal(document.querySelectorAll('#file-grid article.file-card').length, 6);
  assert.equal(document.querySelectorAll('#file-grid .thumb, #file-grid img, #file-grid .preview-paper').length, 0);
  assert.equal(document.querySelectorAll('#file-grid .file-card-description').length, 6);
  assert.equal(document.querySelectorAll('#file-grid button button').length, 0);
  for (const card of document.querySelectorAll('#file-grid .file-card')) {
    assert.ok(card.querySelector('.file-card-open').getAttribute('aria-label').includes('事务对话'));
    assert.ok(card.querySelector('.file-card-meta').textContent.includes('上传'));
    assert.equal(card.querySelectorAll('[data-preview-document]').length, 1);
  }
  const resume = q('#file-grid [data-file="resume"]').closest('.file-card');
  assert.deepEqual([...resume.querySelectorAll('.file-relation')].map(n => n.textContent), ['奖学金申请', '创新周交流']);
});

test('六个预览按钮只打开对应原文，不跳转或切换事务，关闭后恢复焦点', t => {
  const { window, document, q } = mount(t);
  const originalTransaction = window.eval('activeTransaction');
  const expected = { notice: '关于开展 2026 年', grades: '学业成绩单', certificate: '荣 誉 证 书', resume: '个人简历', innovation: '开放交流参与通知', project: '校园无障碍地图' };
  for (const [id, text] of Object.entries(expected)) {
    const trigger = q('#file-grid [data-preview-document="' + id + '"]');
    trigger.focus(); trigger.click();
    assert.equal(window.location.hash, '#files');
    assert.equal(q('#page-files').classList.contains('active'), true);
    assert.equal(window.eval('activeTransaction'), originalTransaction);
    assert.equal(q('#reference-dialog').open, true);
    assert.ok(q('#document-preview').textContent.includes(text));
    assert.equal(document.querySelectorAll('#document-preview mark.active').length, 0);
    q('#reference-close').click();
    assert.equal(document.activeElement, trigger);
  }
});

test('列表筛选后预览保留搜索结果、显示模式及对应对话入口', t => {
  const { window, document, q } = mount(t);
  q('[data-view="list"]').click();
  q('[data-filter="material"]').click();
  const search = q('#file-search'); search.value = '成绩';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(document.querySelectorAll('#file-grid .file-card').length, 1);
  q('#file-grid [data-preview-document="grades"]').click();
  q('#reference-close').click();
  assert.equal(search.value, '成绩');
  assert.ok(q('#file-grid').classList.contains('list-view'));
  q('#file-grid [data-file="grades"]').click();
  assert.equal(window.location.hash, '#conversation');
  assert.equal(q('#reference-dialog').open, false);
});

test('摘要缺失时仅保留基础信息和入口，不生成替代内容', t => {
  const { window, q } = mount(t);
  window.eval("delete files.find(file=>file.id==='notice').summary;renderFiles()");
  const card = q('#file-grid [data-file="notice"]').closest('.file-card');
  assert.equal(card.querySelector('.file-card-description'), null);
  assert.ok(card.querySelector('.file-card-meta').textContent.includes('1.2 MB'));
  assert.ok(card.querySelector('[data-preview-document="notice"]'));
});

test('文件名、摘要及事务名作为文本显示，不注入 HTML', t => {
  const { window, document, q } = mount(t);
  window.eval(`files[0].title='<img src=x onerror="window.injected=true">';files[0].summary='<b>摘要文本</b>';transactions.scholarship.shortTitle='<i>事务文本</i>';renderFiles()`);
  assert.equal(document.querySelectorAll('#file-grid img, #file-grid b, #file-grid i').length, 0);
  assert.equal(q('#file-grid .file-card-description').textContent, '<b>摘要文本</b>');
  assert.equal(q('#file-grid .file-relation').textContent, '<i>事务文本</i>');
  assert.equal(window.injected, undefined);
});
