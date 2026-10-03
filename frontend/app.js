/* 合成场景演示：无模型调用，不读取、上传或存储用户资料。 */
'use strict';

const scenarios = {
  competition: {
    name: '竞赛通知',
    kicker: 'CAMPUS / OPPORTUNITY',
    type: '通知',
    documentTitle: ['大学生创新创业大赛', '参赛通知'],
    summary: '寻找关注真实问题、具有创新价值的学生项目。鼓励跨学科组队，提交项目介绍及相关材料。',
    highlight: ['社会服务赛道', '让一个好想法，从校园开始。'],
    context: ['校园无障碍地图 · 项目构想', '项目介绍 v2 · 已确认'],
    title: ['你的那个想法，', '可以向前一步了。'],
    description: '你之前保存的「校园无障碍地图」构想，与这次的社会服务赛道相关。已有的项目介绍可以继续用，不过有两份材料需要留意。',
    materials: [
      { name: '项目介绍 v2', detail: '已确认内容，可用于起草本次简介', state: 'ready', label: '可用' },
      { name: '团队成员名单', detail: '需按本届成员重新签字', state: 'warning', label: '要处理' },
      { name: '往届获奖成果', detail: '通知 § 5：已获奖成果不得重复申报', state: 'blocked', label: '本次不能用' },
    ],
    next: '先用已确认的项目介绍起草参赛简介，再补齐本届成员名单。',
    tasks: ['核对本次参赛资格及赛道要求', '用项目介绍 v2 起草本次项目简介，标明待确认', '按本届队员信息更新成员名单并完成签字', '不将已获奖成果作为本届新成果重复申报', '核实截止时间及其他要求，再由本人提交'],
    sources: [
      ['通知 § 2 · 赛道范围', '社会服务赛道面向回应真实社会需求的学生项目。校园无障碍地图与该方向存在关联，但关联不等于资格通过。'],
      ['已确认材料 · 项目介绍 v2', '合成用户曾记录校园无障碍地图构想，并确认过项目介绍 v2，可作为起草新简介的背景。'],
      ['通知 § 4 · 团队材料', '成员名单须使用本届信息，并由本届成员签字；已有旧名单需要更新。'],
      ['通知 § 5 × 往届记录', '合成通知规定“已获奖成果不得重复申报”，示例资料中该往届成果确有获奖记录，两者共同触发禁用判断。'],
    ],
  },
  scholarship: {
    name: '奖学金申请',
    kicker: 'CAMPUS / SCHOLARSHIP',
    type: '申请',
    documentTitle: ['本年度奖学金', '申报通知'],
    summary: '面向符合条件的在校学生开展评审，申请人需提供成绩单、综合测评排名证明及相关支撑材料。',
    highlight: ['成绩与综合测评排名', '原则上均应位于专业前 10%。'],
    context: ['学年成绩单 · 排名 6 / 120', '创新创业大赛 · 获奖证书'],
    title: ['这个机会值得争取，', '先确认一个条件。'],
    description: '你的成绩排名在专业前 5%，符合这项成绩要求。竞赛证书已关联，不过综测排名还没确认，现在还不能判断你满足全部申请条件。',
    materials: [
      { name: '学年成绩单', detail: '6 / 120，成绩排名要求已核对', state: 'ready', label: '可用' },
      { name: '竞赛获奖证书', detail: '已关联；认定范围需向学院确认', state: 'warning', label: '要处理' },
      { name: '综合测评排名证明', detail: '尚未提供，不能从成绩排名推断', state: 'warning', label: '待补充' },
    ],
    next: '先向学院确认综测排名及证书认定范围，再决定是否准备完整申请。',
    tasks: ['向学院查询综合测评排名', '确认竞赛获奖证书是否属于本次认定范围', '取得有效的综测排名证明', '核实全部申请条件，不仅是成绩排名', '符合条件后，再按学院要求准备正式申请表'],
    sources: [
      ['通知 § 2 · 排名条件', '合成通知要求学习成绩排名和综合测评排名原则上均在专业前 10%；两项条件需分别核实。'],
      ['成绩单 · 已知事实', '示例学年成绩单显示专业排名为 6 / 120，即前 5%。该材料只证明成绩排名，不证明综合测评排名。'],
      ['竞赛证书 · 待确认用途', '示例证书记录一项竞赛获奖事实，但本次奖学金是否认可该奖项，仍须向学院确认。'],
      ['尚未确认', '综测排名、年级及其他申请条件尚不完整。材料关联或单项条件符合，不代表申请资格已通过。'],
    ],
  },
  internship: {
    name: '实习简章',
    kicker: 'CAREER / POSSIBILITY',
    type: '招聘',
    documentTitle: ['一家教育科技公司', '实习岗位简章'],
    summary: '招募对教育与产品感兴趣的实习伙伴，参与需求调研、产品设计和用户反馈整理。具体要求以岗位说明为准。',
    highlight: ['产品实习生 · 教研实习生', '找到一个与你经历相连的方向。'],
    context: ['已确认意向 · 想找教育方向实习', '项目经历 · 校园产品调研'],
    title: ['你想探索的方向，', '这里有一条线索。'],
    description: '你说过想找教育方向的实习。这份简章中的产品岗位，与已有的校园产品调研经历有一些关联。可以先对照职责，再决定要不要投递。',
    materials: [
      { name: '校园产品调研经历', detail: '与岗位中的需求访谈职责相关', state: 'ready', label: '可参考' },
      { name: '个人简历', detail: '需要针对岗位补充已确认的项目细节', state: 'warning', label: '要处理' },
      { name: '到岗时间与实习时长', detail: '尚未确认，不推断你能按时到岗', state: 'warning', label: '待确认' },
    ],
    next: '先对照岗位职责整理匹配点；如果只是想了解，也可以暂不推进投递。',
    tasks: ['阅读产品岗位的具体职责与条件', '从已确认经历中整理与岗位相关的例子', '核实每周到岗天数和可持续实习时长', '有投递意向时再更新简历，不编造经历', '确认公司和岗位信息后，由本人决定是否投递'],
    sources: [
      ['用户意向 · 经本人确认', '合成用户曾表达“想找教育方向的实习”。该意向只用于解释关联，不代表已决定投递。'],
      ['简章 · 岗位职责', '合成产品岗位包含需求调研和用户反馈整理，因此已有校园产品调研经历可作为匹配线索。'],
      ['项目经历 · 可复用背景', '示例只确认参与过校园产品调研，没有提供项目成效数据；简历初稿不能擅自补上成绩或指标。'],
      ['仍需了解', '到岗安排、时长、岗位具体要求和公司实际情况均需进一步核实。你可以选择只了解，不生成投递任务。'],
    ],
  },
};

// 装饰层按需绘制：指针停止、首屏离开视口或标签页隐藏后不持续占用帧。
function initTypefield() {
  const canvas = document.querySelector('.hero-typefield');
  const context = canvas?.getContext('2d');
  if (!context) return;
  const hero = document.querySelector('.hero');
  const words = ['文启', 'FILE', 'ACTION', '与你有关', 'NEXT MOVE', '文档 → 行动'];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = { x: 0.5, y: 0.48, targetX: 0.5, targetY: 0.48 };
  let width = 0;
  let height = 0;
  let ratio = 1;
  let frame = 0;
  let visible = true;
  let paused = false;

  function schedule() {
    if (!frame && visible && !document.hidden && !paused) frame = requestAnimationFrame(draw);
  }

  function draw() {
    frame = 0;
    context.clearRect(0, 0, width, height);
    pointer.x += (pointer.targetX - pointer.x) * 0.12;
    pointer.y += (pointer.targetY - pointer.y) * 0.12;
    const compact = width < 650;
    const lineHeight = compact ? 42 : 53;
    const columnWidth = compact ? 104 : 142;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = `550 ${compact ? 14 : 18}px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif`;
    for (let row = 0; row < Math.ceil(height / lineHeight) + 2; row += 1) {
      for (let column = 0; column < Math.ceil(width / columnWidth) + 2; column += 1) {
        const x = column * columnWidth - columnWidth * 0.35;
        const y = row * lineHeight - lineHeight * 0.4;
        const nx = x / width - pointer.x;
        const ny = y / height - pointer.y;
        const distance = Math.sqrt(nx * nx * 0.6 + ny * ny);
        const influence = Math.max(0, 1 - distance * 2.4);
        context.fillStyle = `rgba(122, 91, 17, ${0.045 + influence * 0.13})`;
        context.fillText(words[(row * 3 + column * 5) % words.length],
          x + (pointer.x - 0.5) * influence * 30,
          y + (pointer.y - 0.48) * influence * 24);
      }
    }
    if (!reducedMotion.matches && Math.abs(pointer.targetX - pointer.x) + Math.abs(pointer.targetY - pointer.y) > 0.001) schedule();
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    schedule();
  }

  function resetPointer() {
    pointer.targetX = 0.5;
    pointer.targetY = 0.48;
    if (reducedMotion.matches) {
      pointer.x = pointer.targetX;
      pointer.y = pointer.targetY;
    }
    schedule();
  }

  hero.addEventListener('pointermove', event => {
    if (paused || reducedMotion.matches || event.pointerType === 'touch') return;
    const bounds = canvas.getBoundingClientRect();
    pointer.targetX = (event.clientX - bounds.left) / width;
    pointer.targetY = (event.clientY - bounds.top) / height;
    schedule();
  }, { passive: true });
  hero.addEventListener('pointerleave', resetPointer, { passive: true });
  reducedMotion.addEventListener('change', resetPointer);
  document.addEventListener('motionpreferencechange', event => {
    paused = event.detail.paused;
    if (paused) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else schedule();
  });
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else schedule();
  });
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) schedule();
      else {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    }).observe(hero);
  }
  resize();
}

initTypefield();

// 详细体验栏目可选；精简宣传页只初始化仍在页面中的功能。
if (document.querySelector('#scenario-panel')) {
let activeScenario = 'competition';
const tabs = Array.from(document.querySelectorAll('[data-scenario]'));
const dialog = document.querySelector('#source-dialog');
let toastTimer;

function setLines(id, lines) {
  const element = document.getElementById(id);
  element.replaceChildren();
  lines.forEach((line, index) => {
    if (index) element.append(document.createElement('br'));
    element.append(document.createTextNode(line));
  });
}

function selectScenario(key) {
  const scenario = scenarios[key];
  if (!scenario) return;
  activeScenario = key;
  tabs.forEach(tab => {
    const selected = tab.dataset.scenario === key;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  document.querySelector('#scenario-panel').setAttribute('aria-labelledby', `tab-${key}`);
  document.querySelector('#document-kicker').textContent = scenario.kicker;
  document.querySelector('#paper-type').textContent = scenario.type;
  document.querySelector('#document-summary').textContent = scenario.summary;
  document.querySelector('#answer-description').textContent = scenario.description;
  document.querySelector('#next-step-text').textContent = scenario.next;
  setLines('document-title', scenario.documentTitle);
  setLines('document-highlight', scenario.highlight);
  setLines('context-description', scenario.context);
  setLines('answer-title', scenario.title);
  const list = document.querySelector('#material-list');
  list.replaceChildren();
  scenario.materials.forEach(material => {
    const row = document.createElement('div');
    row.className = 'material-row';
    row.dataset.state = material.state;
    const symbol = document.createElement('span');
    symbol.className = 'material-symbol';
    symbol.setAttribute('aria-hidden', 'true');
    symbol.textContent = { ready: '✓', warning: '△', blocked: '×' }[material.state];
    const copy = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = material.name;
    const detail = document.createElement('small');
    detail.textContent = material.detail;
    copy.append(name, detail);
    const state = document.createElement('span');
    state.className = 'material-state';
    state.textContent = material.label;
    row.append(symbol, copy, state);
    list.append(row);
  });
  document.dispatchEvent(new CustomEvent('scenariochange', { detail: { key } }));
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectScenario(tab.dataset.scenario));
  tab.addEventListener('keydown', event => {
    let target;
    if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = tabs.length - 1;
    if (target === undefined) return;
    event.preventDefault();
    selectScenario(tabs[target].dataset.scenario);
    tabs[target].focus();
  });
});

document.querySelectorAll('[data-select-scenario]').forEach(link => {
  link.addEventListener('click', () => selectScenario(link.dataset.selectScenario));
});

document.querySelector('#view-source').addEventListener('click', () => {
  const container = document.querySelector('#source-content');
  container.replaceChildren();
  scenarios[activeScenario].sources.forEach(([title, text]) => {
    const item = document.createElement('section');
    item.className = 'evidence-item';
    const heading = document.createElement('h3');
    heading.textContent = title;
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    item.append(heading, paragraph);
    container.append(item);
  });
  dialog.showModal();
  document.body.classList.add('modal-open');
});
document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => document.body.classList.remove('modal-open'));
dialog.addEventListener('click', event => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});

function showToast(message) {
  const toast = document.querySelector('#toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4000);
}

document.querySelector('#export-checklist').addEventListener('click', () => {
  const scenario = scenarios[activeScenario];
  const content = [
    `# 文启 · ${scenario.name}准备清单（合成示例）`,
    '',
    '> 这是预设的产品演示内容，不是模型实际分析结果，不代表已报名、已投递或资格通过。',
    '',
    '## 与你有关的发现', '', scenario.description, '',
    '## 材料对照', '',
    ...scenario.materials.map(item => `- ${item.label}：${item.name} — ${item.detail}`),
    '', '## 下一步', '', scenario.next, '',
    ...scenario.tasks.map(task => `- [ ] ${task}`),
    '', '## 判断依据', '',
    ...scenario.sources.flatMap(([title, text]) => [`### ${title}`, '', text, '']),
    '---', '文启 FileAction · 宣传页交互示例 · 所有人物、资料与规则均为合成。', '',
  ].join('\n');
  const blob = new Blob(['\uFEFF', content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `文启-${scenario.name}-示例准备清单.md`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  showToast('已发起示例清单下载，请查看浏览器的下载记录。');
});
selectScenario(activeScenario);
}

if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.08 });
  document.querySelectorAll('.reveal').forEach(element => observer.observe(element));
  document.documentElement.classList.add('motion-ready');
}
