const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('../2026-10-01-wenqi-morandi-refinement/test-runtime/node_modules/jsdom');
const demoPath = path.resolve(__dirname, '../../05-交互Demo/可行动事务Agent-文启高保真Demo.html');
const html = fs.readFileSync(demoPath, 'utf8');

// 这是离线 DOM 逻辑测试，不声称覆盖浏览器布局、原生焦点限制或真实鼠标选择。
function mount(t, hash = '') {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(html, {
    url: 'https://demo.test/' + hash,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.HTMLElement.prototype.scrollTo = () => {};
      window.HTMLElement.prototype.scrollIntoView = function () { this.dataset.scrolledIntoView = 'true'; };
      window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      window.HTMLDialogElement.prototype.close = function () {
        this.open = false;
        this.dispatchEvent(new window.Event('close'));
      };
    }
  });
  const { document } = dom.window;
  const q = selector => {
    const result = document.querySelector(selector);
    assert.ok(result, '未找到元素：' + selector);
    return result;
  };
  const click = selector => {
    // 旧行为回归通过新的可见入口完成事务选择。
    const oldSelector = selector.match(/^#(package|action)-transactions \[data-transaction="([^"\]]+)"\]$/);
    if(oldSelector){
      dom.window.history.replaceState(null, '', oldSelector[1]==='package'?'#deliverables':'#actions');
      dom.window.route();
      q('#'+oldSelector[1]+'-transactions [data-transaction-picker]').click();
      q('[data-picker-choice="'+oldSelector[2]+'"]').click();
    }else q(selector).click();
  };
  const menu = element => {
    const event = new dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 160 });
    element.dispatchEvent(event);
    return event;
  };
  const activeMarks = () => [...document.querySelectorAll('#document-preview mark.active')];
  t.after(() => { dom.window.close(); assert.deepEqual(errors.map(error => error.message), []); });
  return { window: dom.window, document, q, click, menu, activeMarks };
}

test('脚本可解析，HTML 无重复 ID，导航没有工作台', t => {
  new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  const { document, q } = mount(t);
  const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
  assert.equal(ids.length, new Set(ids).size);
  assert.equal(document.querySelectorAll('.nav-item').length, 3);
  assert.ok(!document.querySelector('[data-nav="workspace"]'));
  assert.ok(!html.includes('Agent 工作台'));
  assert.ok(!html.includes('全部事务'));
  assert.equal(q('#reference-dialog').open, false);
  assert.equal(q('#reference-menu').hidden, true);
  assert.ok(!q('#workspace-shell').querySelector('.preview-pane'));
  assert.equal(q('#page-files').classList.contains('active'), true);
});

test('六个文件均直接进入对应事务对话，引用预览保持关闭', t => {
  const { window, document, click, q } = mount(t);
  for (const id of ['notice', 'grades', 'certificate', 'resume', 'innovation', 'project']) {
    click('[data-file="' + id + '"]');
    const innovation = ['innovation', 'project'].includes(id);
    assert.equal(window.location.hash, '#conversation');
    assert.equal(q('#page-workspace').classList.contains('active'), true);
    assert.equal(q('#conversation').hidden, innovation);
    assert.equal(q('#innovation-conversation').hidden, !innovation);
    assert.match(q('#breadcrumb').textContent, innovation ? /校园创新周交流/ : /国家奖学金申请/);
    assert.equal(q('#reference-count').textContent, innovation ? '3 份参考文件' : '4 份参考文件');
    assert.equal(q('#reference-dialog').open, false);
    assert.equal(q('#modal-backdrop').classList.contains('open'), false);
    assert.equal(document.querySelector('.nav-item.active').dataset.nav, 'files');
  }
});

test('旧 workspace 书签仍可进入对话，默认没有原文栏', t => {
  const { q } = mount(t, '#workspace');
  assert.ok(q('#page-workspace').classList.contains('active'));
  assert.equal(q('#reference-dialog').open, false);
});

test('右键条款后选择查看引用，先高亮成绩，再切换通知依据', t => {
  const { q, click, menu, activeMarks, document } = mount(t);
  click('[data-file="notice"]');
  const clause = q('[data-citations="grades rank"]');
  const event = menu(clause);
  assert.equal(event.defaultPrevented, true);
  assert.equal(q('#reference-menu').hidden, false);
  assert.equal(q('#reference-dialog').open, false);
  assert.match(q('#reference-menu-count').textContent, /2 处/);
  click('#view-reference');
  assert.equal(q('#reference-menu').hidden, true);
  assert.equal(q('#reference-dialog').open, true);
  assert.equal(activeMarks().length, 1);
  assert.equal(activeMarks()[0].id, 'highlight-grades');
  assert.match(q('#preview-name').textContent, /成绩单/);
  click('[data-reference-choice="rank"]');
  assert.equal(activeMarks().length, 1);
  assert.equal(activeMarks()[0].id, 'highlight-rank');
  assert.match(activeMarks()[0].textContent, /前 10%/);
  assert.equal(q('#highlight-deadline').classList.contains('active'), false);
  click('#reference-close');
  assert.equal(q('#reference-dialog').open, false);
  assert.equal(document.activeElement, clause);
});

test('选择跨条款文字再右键时，包含所选内容的所有来源', t => {
  const { window, q, click, menu, document } = mount(t);
  click('[data-file="notice"]');
  const first = q('[data-citations="grades rank"]');
  const last = q('#conversation .agent-answer > p [data-citations="certificate"]');
  const range = document.createRange();
  range.setStart(first.firstChild, 0);
  range.setEnd(last.firstChild, last.firstChild.length);
  const selection = window.getSelection();
  selection.removeAllRanges(); selection.addRange(range);
  menu(last);
  assert.equal(q('#reference-menu-count').textContent, '3 处依据');
  click('#view-reference');
  assert.deepEqual([...document.querySelectorAll('[data-reference-choice]')].map(button => button.dataset.referenceChoice), ['grades', 'rank', 'certificate']);
  click('[data-reference-choice="certificate"]');
  assert.match(q('#document-preview mark.active').textContent, /省级二等奖/);
});

test('没有来源的普通文字保留原生右键行为', t => {
  const { q, click, menu } = mount(t);
  click('[data-file="notice"]');
  const event = menu(q('#conversation .user-message p'));
  assert.equal(event.defaultPrevented, false);
  assert.equal(q('#reference-menu').hidden, true);
});

test('键盘能打开引用菜单、Escape 关闭菜单；点击原文可直接查看', t => {
  const { window, q, click, document } = mount(t);
  click('[data-file="notice"]');
  const clause = q('[data-citations="deadline"]');
  clause.focus();
  clause.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'F10', shiftKey: true }));
  assert.equal(q('#reference-menu').hidden, false);
  document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }));
  assert.equal(q('#reference-menu').hidden, true);
  assert.equal(document.activeElement, clause);
  click('[data-evidence="deadline"]');
  assert.equal(q('#reference-dialog').open, true);
  assert.equal(q('#document-preview mark.active').id, 'highlight-deadline');
});

test('创新周引用显示对应的通知与项目，不误显示奖学金原文', t => {
  const { q, click, menu, activeMarks } = mount(t);
  click('[data-file="innovation"]');
  menu(q('[data-citations="project resume"]'));
  click('#view-reference');
  assert.equal(activeMarks()[0].id, 'highlight-project');
  assert.match(q('#preview-name').textContent, /项目构想/);
  click('[data-reference-choice="resume"]');
  assert.equal(activeMarks()[0].id, 'highlight-resume');
  click('#reference-close');
  click('[data-reference="eventTime"]');
  assert.equal(activeMarks()[0].id, 'highlight-event-time');
  assert.match(q('#preview-name').textContent, /创新周/);
});

test('成果包按事务更换产物、来源、检查项与返回对话上下文', t => {
  const { window, q, click, document } = mount(t);
  assert.equal(q('#package-context').querySelectorAll('[data-preview-document]').length, 4);
  assert.match(q('#output-content').textContent, /国家奖学金/);
  click('#package-transactions [data-transaction="innovation"]');
  assert.equal(q('#package-context').querySelectorAll('[data-preview-document]').length, 3);
  assert.match(q('#package-summary').textContent, /3 份关联文件 → 3 项产物/);
  assert.match(q('#output-content').textContent, /让想法遇见同路人/);
  assert.ok(!q('#output-content').textContent.includes('奖学金'));
  assert.match(q('#package-warning').textContent, /预约/);
  click('#output-tabs [data-output="questions"]');
  assert.match(q('#output-content').textContent, /实际发生的行为/);
  click('#output-tabs [data-output="preparation"]');
  assert.match(q('#output-content').textContent, /尚未预约/);
  click('#package-context [data-preview-document="project"]');
  assert.match(q('#document-preview').textContent, /校园无障碍地图/);
  assert.equal(document.querySelectorAll('#document-preview mark.active').length, 0);
  click('#reference-close');
  click('#page-deliverables [data-go="conversation"]');
  window.route();
  assert.equal(q('#innovation-conversation').hidden, false);
  assert.match(q('#breadcrumb').textContent, /创新周/);
});

test('编辑字段在切换产物、事务后保留，两个事务草稿不互相覆盖', t => {
  const { q, click, window } = mount(t);
  const recipient = q('[aria-label="收件人"]');
  recipient.textContent = '示例学院老师';
  recipient.dispatchEvent(new window.Event('input', { bubbles: true }));
  click('#output-tabs [data-output="checklist"]');
  click('#output-tabs [data-output="letter"]');
  assert.equal(q('[aria-label="收件人"]').textContent, '示例学院老师');
  click('#package-transactions [data-transaction="innovation"]');
  const name = q('[aria-label="交流介绍姓名"]');
  name.textContent = '示例同学';
  name.dispatchEvent(new window.Event('input', { bubbles: true }));
  click('#package-transactions [data-transaction="scholarship"]');
  assert.equal(q('[aria-label="收件人"]').textContent, '示例学院老师');
  click('#package-transactions [data-transaction="innovation"]');
  assert.equal(q('[aria-label="交流介绍姓名"]').textContent, '示例同学');
  assert.ok(!q('#output-content').textContent.includes('示例学院老师'));
});

test('行动页无全部选项；卡片、列数量和摘要与当前事务一致', t => {
  const { q, click, document } = mount(t);
  const counts = () => [...document.querySelectorAll('.kanban-column .column-title .count')].map(element => Number(element.textContent));
  assert.ok(!q('#page-actions').textContent.includes('全部事务'));
  assert.equal(q('#action-transactions').querySelectorAll('button').length, 1);
  assert.deepEqual(counts(), [1, 1, 1]);
  click('#action-transactions [data-transaction="innovation"]');
  assert.deepEqual(counts(), [2, 0, 1]);
  assert.deepEqual([...document.querySelectorAll('.action-intro .stat strong')].map(element => Number(element.textContent)), [2, 0, 1]);
  assert.equal(document.querySelectorAll('[data-task="scholarship"]:not([hidden])').length, 0);
  assert.match(q('#action-transactions [data-transaction-picker]').textContent, /创新周交流/);
  assert.match(q('#action-current-title').textContent, /创新周/);
  assert.equal(document.querySelectorAll('.kanban-empty:not([hidden])').length, 1);
});

test('既有对话沉淀与改目标功能继续可用，来源通过弹层打开', t => {
  const { q, click, window } = mount(t);
  click('[data-file="notice"]');
  click('.agent-header [data-session-open]');
  assert.equal(q('#settlement-backdrop').classList.contains('open'), true);
  const fact = q('[data-session-fact="grades"]');
  fact.checked = true; fact.dispatchEvent(new window.Event('change', { bubbles: true }));
  click('#session-confirm');
  assert.match(q('#session-confirmation').textContent, /已确认 1 条/);
  click('[data-session-source="grades"]');
  assert.equal(q('#settlement-backdrop').classList.contains('open'), false);
  assert.equal(q('#reference-dialog').open, true);
  assert.equal(q('#document-preview mark.active').id, 'highlight-grades');
  click('#reference-close');
  click('#change-goal');
  assert.equal(q('#session-version').textContent, 'V2');
  assert.match(q('#preparation-title').textContent, /暂停/);
  click('[data-file="innovation"]');
  click('.side-note button');
  assert.match(q('#modal-content').textContent, /本次交流的相关背景/);
  assert.ok(!q('#modal-content').textContent.includes('综测排名'));
});

test('文件筛选与列表切换仍可用，重新打开文件不遗留预览', t => {
  const { q, click, window, document } = mount(t);
  click('[data-filter="material"]');
  assert.equal(document.querySelectorAll('#file-grid .file-card').length, 4);
  const search = q('#file-search'); search.value = '项目';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(document.querySelectorAll('#file-grid .file-card').length, 1);
  click('[data-view="list"]');
  assert.ok(q('#file-grid').classList.contains('list-view'));
  click('[data-file="project"]');
  click('[data-reference="innovation"]');
  assert.equal(q('#reference-dialog').open, true);
  window.location.hash = 'files'; window.route();
  click('[data-file="project"]');
  assert.equal(q('#reference-dialog').open, false);
});

test('移动端关联材料切换不触发常驻预览，窄视口引用菜单不越过左边界', t => {
  const { q, click, menu, window } = mount(t);
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
  click('[data-file="notice"]');
  click('[data-pane="tree"]');
  assert.ok(q('#workspace-shell').classList.contains('show-tree'));
  click('[data-document="grades"]');
  assert.equal(q('#reference-dialog').open, true);
  click('#reference-close');
  click('[data-pane="agent"]');
  assert.equal(q('#workspace-shell').classList.contains('show-tree'), false);
  menu(q('[data-citations="deadline"]'));
  assert.ok(parseFloat(q('#reference-menu').style.left) >= 8);
});

function visitPickerPage(app, page = 'actions') {
  app.window.history.replaceState(null, '', '#' + page);
  app.window.route();
  const container = page === 'actions' ? '#action-transactions' : '#package-transactions';
  app.click(container + ' [data-transaction-picker]');
  return app.q('#transaction-search');
}
function searchTransactions(app, value) {
  const search = app.q('#transaction-search');
  search.value = value;
  search.dispatchEvent(new app.window.Event('input', { bubbles: true }));
}

test('两页折叠时各只显示当前事务；展开列表显示来源场景并聚焦搜索', t => {
  const app = mount(t);
  const { document, q, click } = app;
  assert.equal(document.querySelectorAll('.transaction-card').length, 0);
  for (const id of ['action', 'package']) {
    assert.equal(q('#' + id + '-transactions').querySelectorAll('button').length, 1);
    assert.match(q('#' + id + '-transactions').textContent, /奖学金申请.*切换事务/);
  }
  const input = visitPickerPage(app);
  assert.equal(q('#transaction-picker').hidden, false);
  assert.equal(document.activeElement, input);
  assert.match(q('#transaction-picker-title').textContent, /要推进/);
  assert.equal(q('#action-transactions button').getAttribute('aria-expanded'), 'true');
  assert.equal(q('#package-transactions button').getAttribute('aria-expanded'), 'false');
  assert.equal(q('#transaction-options [role="option"]').dataset.pickerChoice, 'scholarship');
  assert.match(q('#transaction-options').textContent, /3 项行动/);
  click('#transaction-picker-close');
  assert.equal(document.activeElement, q('#action-transactions button'));
  visitPickerPage(app, 'deliverables');
  assert.match(q('#transaction-picker-title').textContent, /成果所属/);
  assert.match(q('#transaction-options').textContent, /3 项产物/);
});

test('搜索覆盖事务名、目标与关联文件，空结果不会误选上一次匹配项', t => {
  const app = mount(t);
  const { document, q, window, click } = app;
  visitPickerPage(app);
  const matches = () => [...document.querySelectorAll('[data-picker-choice]')].map(button => button.dataset.pickerChoice);
  searchTransactions(app, '  创 新 周  ');
  assert.deepEqual(matches(), ['innovation']);
  searchTransactions(app, '申请资格');
  assert.deepEqual(matches(), ['scholarship']);
  searchTransactions(app, '无障碍地图');
  assert.deepEqual(matches(), ['innovation']);
  searchTransactions(app, '个人简历');
  assert.deepEqual(matches(), ['scholarship', 'innovation']);
  searchTransactions(app, '不存在的事务名称');
  assert.deepEqual(matches(), []);
  assert.equal(q('#transaction-picker-empty').hidden, false);
  assert.equal(q('#transaction-search').hasAttribute('aria-activedescendant'), false);
  q('#transaction-search').dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));
  assert.equal(q('#transaction-picker').hidden, false);
  assert.match(q('#action-transactions').textContent, /奖学金申请/);
  click('#transaction-search-clear');
  assert.deepEqual(matches(), ['scholarship', 'innovation']);
  assert.equal(q('#transaction-picker-empty').hidden, true);
  assert.equal(document.activeElement, q('#transaction-search'));
});

test('方向键选择、Enter 确认和 Escape 取消均保持页面与焦点一致', t => {
  const app = mount(t);
  const { window, q, document, click } = app;
  const input = visitPickerPage(app);
  input.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown' }));
  assert.equal(document.getElementById(input.getAttribute('aria-activedescendant')).dataset.pickerChoice, 'innovation');
  assert.equal(q('[data-picker-choice="scholarship"]').getAttribute('aria-selected'), 'true');
  input.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));
  assert.equal(q('#transaction-picker').hidden, true);
  assert.match(q('#action-transactions').textContent, /创新周交流/);
  assert.match(q('#package-transactions').textContent, /创新周交流/);
  assert.match(q('#output-content').textContent, /让想法遇见同路人/);
  assert.equal(document.activeElement, q('#action-transactions button'));
  click('#action-transactions button');
  assert.equal(q('#transaction-options [role="option"]').dataset.pickerChoice, 'innovation');
  searchTransactions(app, '奖学金');
  q('#transaction-search').dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }));
  assert.equal(q('#transaction-picker').hidden, true);
  assert.match(q('#action-transactions').textContent, /创新周交流/);
  assert.equal(document.activeElement, q('#action-transactions button'));
});

test('列表内部滚动保持展开，点击外部或切页关闭，重新打开清空搜索', t => {
  const app = mount(t);
  const { window, q, click } = app;
  visitPickerPage(app);
  q('#transaction-options').dispatchEvent(new window.Event('scroll', { bubbles: false }));
  assert.equal(q('#transaction-picker').hidden, false);
  searchTransactions(app, '创新');
  q('#action-current-title').dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
  assert.equal(q('#transaction-picker').hidden, true);
  click('#action-transactions button');
  assert.equal(q('#transaction-search').value, '');
  window.history.replaceState(null, '', '#files'); window.route();
  assert.equal(q('#transaction-picker').hidden, true);
  assert.equal(q('#action-transactions button').getAttribute('aria-expanded'), 'false');
});

test('注入 100 个测试事务后入口仍只有一个，可搜索并选择末尾事务', t => {
  const app = mount(t);
  const { window, q, document, click } = app;
  // 合成数据只存在于本测试的隔离 DOM 中，不写入实际 Demo。
  window.eval(`for(let i=1;i<=100;i++){
    const id='scale-'+i;
    transactions[id]={...transactions.scholarship,title:'容量测试事务 '+i+'：一个非常长的事务名称用于验证截断与搜索',shortTitle:'容量测试事务 '+i,goal:'仅用于隔离测试 '+i};
  }
  renderPackage();renderActions();`);
  assert.equal(q('#action-transactions').querySelectorAll('button').length, 1);
  assert.equal(q('#package-transactions').querySelectorAll('button').length, 1);
  assert.match(q('#action-transactions').textContent, /102 个事务/);
  assert.equal(q('#package-transaction-count').textContent, '102');
  visitPickerPage(app, 'deliverables');
  assert.equal(document.querySelectorAll('[data-picker-choice]').length, 102);
  assert.equal(window.getComputedStyle(q('#transaction-options')).overflowY, 'auto');
  assert.equal(window.getComputedStyle(q('#transaction-options')).maxHeight, '310px');
  searchTransactions(app, '容量测试事务 100');
  assert.equal(document.querySelectorAll('[data-picker-choice]').length, 1);
  const item=q('[data-picker-choice="scale-100"]');
  assert.match(item.querySelector('strong').title, /非常长的事务名称/);
  click('[data-picker-choice="scale-100"]');
  assert.equal(q('#transaction-picker').hidden, true);
  assert.match(q('#package-transactions').textContent, /容量测试事务 100/);
  assert.equal(q('#package-transactions').querySelectorAll('button').length, 1);
  assert.match(q('#output-content').textContent, /国家奖学金/);
  assert.equal(q('#package-source-count').textContent, '06');
});

test('窄视口及靠近屏幕底部时浮层位置有界，长名称不展开更多列', t => {
  const app=mount(t);
  const {window,q}=app;
  Object.defineProperty(window,'innerWidth',{value:390,configurable:true});
  Object.defineProperty(window,'innerHeight',{value:600,configurable:true});
  window.history.replaceState(null,'','#actions');window.route();
  q('#action-transactions button').getBoundingClientRect=()=>({left:20,top:470,right:370,bottom:540,width:350,height:70});
  q('#action-transactions button').click();
  const popup=q('#transaction-picker');
  assert.ok(parseFloat(popup.style.width)<=366);
  assert.ok(parseFloat(popup.style.left)>=12);
  assert.ok(parseFloat(popup.style.left)+parseFloat(popup.style.width)<=378);
  assert.ok(parseFloat(popup.style.top)>=12);
  assert.ok(parseFloat(popup.style.top)+parseFloat(popup.style.maxHeight)<=588);
  assert.equal(window.getComputedStyle(q('.transaction-option-copy strong')).textOverflow,'ellipsis');
});

test('中文输入法候选确认不会提前切换事务，搜索文本也不会作为 HTML 执行', t => {
  const app=mount(t);
  const {window,q}=app;
  visitPickerPage(app);
  searchTransactions(app,'创新周');
  q('#transaction-search').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}));
  assert.equal(q('#transaction-picker').hidden,false);
  assert.match(q('#action-transactions').textContent,/奖学金申请/);
  window.eval(`transactions.special={...transactions.scholarship,title:'测试 <img src=x onerror="alert(1)"> & 标题',shortTitle:'测试 <名称>',goal:'转义测试'};`);
  searchTransactions(app,'转义测试');
  assert.equal(q('#transaction-options').querySelector('img'),null);
  assert.match(q('#transaction-options').textContent,/<img src=x/);
});
