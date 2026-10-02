/* 可操作的宣传动效；数据为预设合成示意，不保存拖动位置或个人信息。 */
'use strict';

(() => {
  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Map();
  let paused = root.classList.contains('motion-paused');
  const moving = () => !paused && !reduced.matches && !document.hidden;

  function animate(element, frames, options, complete = () => {}) {
    if (!moving() || !element.animate) { complete(); return; }
    const animation = element.animate(frames, options);
    const cleanup = () => {
      if (!animations.has(animation)) return;
      animations.delete(animation);
      complete();
    };
    animations.set(animation, cleanup);
    animation.onfinish = cleanup;
    animation.oncancel = cleanup;
    return animation;
  }
  function finishAnimations() {
    [...animations].forEach(([animation, cleanup]) => {
      animation.cancel();
      cleanup();
    });
  }
  document.addEventListener('motionpreferencechange', event => {
    paused = event.detail.paused;
    if (paused) finishAnimations();
    queueUnfold();
  });
  reduced.addEventListener('change', () => { finishAnimations(); queueUnfold(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) finishAnimations(); });

  // 文件抽屉：原地聚拢，点开时从卡片位置展开为可读预览。
  const hero = document.querySelector('.hero');
  const array = document.querySelector('.file-array');
  const track = document.querySelector('.file-array-track');
  const slots = [...track.querySelectorAll('.file-slot')];
  const facts = [
    ['competition', '这份竞赛通知，可能与你的旧想法有关。', '示例中，社会服务赛道与「校园无障碍地图」有关联。文启将通知里的机会与你确认过的构想放在一起看。', '先对照赛道和条件，再决定是否准备参赛。'],
    ['competition', '已经写过的介绍，不必从头再写。', '示例项目介绍 v2 记录了项目方向和已有进展，是你确认过的背景。新事务需要材料时，可以先核对版本，再复用相关内容。', '用已确认内容起草新简介，修改后再由你确认。'],
    ['scholarship', '一张证书，也是下一件事的线索。', '示例获奖记录可关联到奖学金准备，但奖项是否在本次认定范围内，仍需要对照通知确认。', '保留出处和使用记录，材料关联不等于资格通过。'],
    ['competition', '想法先存着，机会来了再连接。', '「校园无障碍地图」是一个合成项目构想。之后遇到相关通知时，文启可以解释两者为什么有关，供你决定要不要继续。', '主动发现关联，把要不要行动的决定留给你。'],
    ['internship', '同一份简章，从你的方向读。', '示例用户表达过想找教育方向的实习。产品岗位中的需求调研，与已有校园项目经历存在关联。', '先看看职责是否合适，也可以只是了解、暂不投递。'],
    ['internship', '用确认过的经历，讲清楚你是谁。', '示例简历可以引用已有项目经历，再根据岗位补充相关细节。没有提供的成绩、数据和经历，不应被自动编造。', '按岗位整理匹配点，初稿由你检查和修改。'],
    ['competition', '文件读完，下一步也清楚了。', '把需要更新的材料、待确认的条件和准备事项整理成清单。示例清单可以在下方交互演示中实际导出。', '准备清单不等于已报名，最后提交依然由你完成。'],
  ];
  let gathered = false;
  let previewIndex = 0;
  let origin = null;
  let closing = false;
  let focusRestored = true;
  let focusAfterClose = null;
  array.removeAttribute('aria-hidden');
  array.setAttribute('role', 'group');
  array.setAttribute('aria-label', '可打开的示例文件');
  array.classList.add('files-interactive');
  const toolbar = document.createElement('div');
  toolbar.className = 'file-toolbar';
  toolbar.innerHTML = '<span>点开一份文件，看看它与你的关系</span><button class="deck-toggle" type="button" aria-pressed="false">聚拢文件 ↘</button>';
  array.append(toolbar);
  const deckToggle = toolbar.querySelector('button');
  const dialog = document.createElement('dialog');
  dialog.className = 'file-preview';
  dialog.setAttribute('aria-labelledby', 'file-preview-title');
  dialog.setAttribute('aria-describedby', 'file-preview-copy');
  dialog.innerHTML = `
    <div class="preview-head"><span>FILEACTION / FILE PREVIEW</span><button class="icon-button preview-close" type="button" aria-label="关闭文件预览" autofocus><svg class="icon" aria-hidden="true"><use href="#i-close"/></svg></button></div>
    <div class="preview-content"><span class="preview-type"></span><h2 id="file-preview-title"></h2><p class="preview-copy" id="file-preview-copy"></p><div class="preview-insight"><span>与你有关的下一步</span><p></p></div><p class="preview-disclosure">合成示例 · 交互设计展示 · 未接入真实模型</p></div>
    <div class="preview-foot"><div class="preview-pager"><button type="button" data-page="-1" aria-label="上一份文件">←</button><span></span><button type="button" data-page="1" aria-label="下一份文件">→</button></div><button class="button preview-explore" type="button">探索这个场景 ↗</button></div>`;
  document.body.append(dialog);

  function setGathered(value) {
    gathered = value;
    array.classList.toggle('files-gathered', value);
    deckToggle.textContent = value ? '展开文件 ↗' : '聚拢文件 ↘';
    deckToggle.setAttribute('aria-pressed', String(value));
    const visible = slots.filter(slot => slot.offsetWidth);
    slots.forEach(slot => {
      const index = visible.indexOf(slot);
      const middle = (visible.length - 1) / 2;
      const angle = parseFloat(getComputedStyle(slot).getPropertyValue('--file-angle')) || 0;
      const y = parseFloat(getComputedStyle(slot).getPropertyValue('--file-y')) || 0;
      const x = track.clientWidth / 2 - slot.offsetLeft - slot.offsetWidth / 2;
      slot.style.setProperty('--gather-x', `${value ? x : 0}px`);
      slot.style.setProperty('--gather-y', `${value ? -y + Math.abs(index - middle) * 3 : 0}px`);
      slot.style.setProperty('--gather-angle', `${value ? -angle + (index - middle) * 3 : 0}deg`);
      slot.style.setProperty('--gather-delay', value ? `${Math.abs(index - middle) * 35}ms` : '0ms');
      slot.style.setProperty('--deck-level', String(10 - Math.abs(index - middle)));
    });
  }
  deckToggle.addEventListener('click', () => setGathered(!gathered));
  window.addEventListener('resize', () => { if (gathered) setGathered(true); }, { passive: true });
  new MutationObserver(() => {
    if (hero.classList.contains('is-erasing') && gathered) setGathered(false);
  }).observe(hero, { attributes: true, attributeFilter: ['class'] });

  function renderPreview(index, transition = true) {
    previewIndex = (index + slots.length) % slots.length;
    const slot = slots[previewIndex];
    const fact = facts[previewIndex];
    dialog.querySelector('.preview-type').textContent = slot.querySelector('.file-meta > span').textContent;
    dialog.querySelector('h2').textContent = slot.querySelector('.file-face > strong').textContent;
    dialog.querySelector('.preview-copy').textContent = `${fact[1]} ${fact[2]}`;
    dialog.querySelector('.preview-insight > p').textContent = fact[3];
    dialog.querySelector('.preview-pager > span').textContent = `${String(previewIndex + 1).padStart(2, '0')} / 07`;
    if (transition) animate(dialog.querySelector('.preview-content'), [{ opacity: .2, transform: 'translateX(15px)' }, { opacity: 1, transform: 'translateX(0)' }], { duration: 320, easing: 'ease-out' });
  }
  function openPreview(index, button) {
    finishAnimations();
    origin = button;
    closing = false;
    focusRestored = false;
    focusAfterClose = null;
    renderPreview(index, false);
    dialog.showModal();
    document.body.classList.add('modal-open');
    const from = button.getBoundingClientRect();
    const to = dialog.getBoundingClientRect();
    animate(dialog, [
      { opacity: .2, transform: `translate(${from.x + from.width / 2 - to.x - to.width / 2}px, ${from.y + from.height / 2 - to.y - to.height / 2}px) scale(${from.width / to.width}, ${from.height / to.height})` },
      { opacity: 1, transform: 'translate(0, 0) scale(1)' },
    ], { duration: 580, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
  function closePreview() {
    if (!dialog.open || closing) return;
    finishAnimations();
    closing = true;
    const from = dialog.getBoundingClientRect();
    const to = origin?.getBoundingClientRect();
    const transform = to && to.width ? `translate(${to.x + to.width / 2 - from.x - from.width / 2}px, ${to.y + to.height / 2 - from.y - from.height / 2}px) scale(.3)` : 'translateY(16px) scale(.95)';
    animate(dialog, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform }], { duration: 250, easing: 'ease-in' }, () => { commitClose(); closing = false; });
  }
  function restoreFocus() {
    if (focusRestored || dialog.open) return;
    focusRestored = true;
    document.body.classList.toggle('modal-open', Boolean(document.querySelector('dialog[open]')));
    (focusAfterClose || origin)?.focus({ preventScroll: true });
  }
  function commitClose() {
    dialog.close();
    restoreFocus();
  }
  slots.forEach((slot, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'file-open';
    button.setAttribute('aria-label', `打开${slot.querySelector('.file-face > strong').textContent}，合成示例`);
    button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', () => openPreview(index, button));
    slot.querySelector('.file-face').append(button);
  });
  dialog.querySelector('.preview-close').addEventListener('click', closePreview);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closePreview(); });
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closePreview();
  });
  dialog.addEventListener('close', restoreFocus);
  dialog.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => {
    if (!closing) { finishAnimations(); renderPreview(previewIndex + Number(button.dataset.page)); }
  }));
  dialog.addEventListener('keydown', event => {
    if (closing || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    finishAnimations();
    renderPreview(previewIndex + (event.key === 'ArrowLeft' ? -1 : 1));
  });
  dialog.querySelector('.preview-explore').addEventListener('click', () => {
    if (closing) return;
    finishAnimations();
    const tab = document.querySelector(`[data-scenario="${facts[previewIndex][0]}"]`);
    focusAfterClose = tab;
    commitClose();
    tab.click();
    document.querySelector('#experience').scrollIntoView({ behavior: moving() ? 'smooth' : 'instant', block: 'start' });
  });

  // 记忆星图：点击选中、拖动节点、键盘微调，曲线实时重新连接。
  const graph = document.querySelector('.constellation');
  const stage = graph.querySelector('.constellation-stage');
  const svg = graph.querySelector('.constellation-lines');
  const hub = graph.querySelector('.constellation-hub');
  const reset = graph.querySelector('.graph-reset');
  const titles = {
    project: ['已有材料，成为新事务的起点。', '示例项目介绍已由用户确认，可与想法关联；复用前仍要检查本次要求。'],
    idea: ['让收藏的想法，遇见合适的机会。', '示例构想与新通知发生关联，解释为什么有关，再由你决定要不要行动。'],
    award: ['记住经历，也记住它的出处。', '示例证书与获奖记录相连，但能否用于新的申请，要分别核对适用范围。'],
    intent: ['意向是线索，不是替你做决定。', '“想找教育方向实习”可以帮助解释相关性，不代表你已经决定投递。'],
    next: ['关联的终点，是清楚的下一步。', '材料和意向汇聚为准备建议，初稿需要确认，清单不等于已完成申请。'],
  };
  const edges = [];
  const nodes = [...stage.querySelectorAll('.context-node')].map(button => {
    button.disabled = false;
    return { button, key: button.dataset.node, x: parseFloat(button.style.left) / 100, y: parseFloat(button.style.top) / 100, initialX: parseFloat(button.style.left) / 100, initialY: parseFloat(button.style.top) / 100 };
  });
  const pairs = [[0, 'hub'], [1, 'hub'], [2, 'hub'], [3, 'hub'], [4, 'hub'], [0, 1], [2, 4], [3, 4]];
  let selected = null;
  let allLit = false;
  let drag = null;
  let suppressClick = null;
  let resetFrame = 0;
  hub.disabled = false;
  reset.hidden = false;
  graph.querySelector('#graph-help').textContent = '点击节点看关联 · 拖动改变位置 · 聚焦后用方向键移动 · 合成示意';
  pairs.forEach(([a, b]) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'graph-path');
    const signal = path.cloneNode();
    signal.setAttribute('class', 'graph-signal');
    signal.setAttribute('pathLength', '100');
    svg.append(path, signal);
    edges.push({ a, b, path, signal });
  });
  function drawGraph() {
    nodes.forEach(node => {
      const paddingX = Math.min(.45, (node.button.offsetWidth / 2 + 7) / Math.max(1, stage.clientWidth));
      const paddingY = Math.min(.45, (node.button.offsetHeight / 2 + 8) / Math.max(1, stage.clientHeight));
      node.x = Math.max(paddingX, Math.min(1 - paddingX, node.x));
      node.y = Math.max(paddingY, Math.min(1 - paddingY, node.y));
      node.button.style.left = `${node.x * 100}%`;
      node.button.style.top = `${node.y * 100}%`;
    });
    edges.forEach(edge => {
      const from = nodes[edge.a];
      const to = edge.b === 'hub' ? { x: .5, y: .44 } : nodes[edge.b];
      const x1 = from.x * 500, y1 = from.y * 420, x2 = to.x * 500, y2 = to.y * 420;
      const bend = edge.b === 'hub' ? 22 : -30;
      const path = `M ${x1} ${y1} Q ${(x1 + x2) / 2 + bend} ${(y1 + y2) / 2} ${x2} ${y2}`;
      edge.path.setAttribute('d', path);
      edge.signal.setAttribute('d', path);
    });
  }
  function selectNode(index) {
    selected = index;
    allLit = index === 'all';
    hub.setAttribute('aria-pressed', String(allLit));
    nodes.forEach((node, i) => node.button.setAttribute('aria-pressed', String(index === i)));
    edges.forEach(edge => {
      const active = allLit || edge.a === index || edge.b === index;
      edge.path.classList.toggle('is-active', active);
      edge.signal.classList.toggle('is-active', active);
    });
    const content = typeof index === 'number' ? titles[nodes[index].key] : allLit
      ? ['线索连起来，下一步更清楚。', '材料、想法、获奖与意向共同构成上下文。这里只展示预设关联，没有建立或保存真实个人记忆。']
      : ['每一条线索，都能连到下一步。', '你确认的材料、想法与意向，共同构成属于你的上下文。'];
    graph.querySelector('#graph-title').textContent = content[0];
    graph.querySelector('#graph-description').textContent = content[1];
    animate(graph.querySelector('.constellation-caption'), [{ opacity: .35, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }], { duration: 250 });
    if (allLit) animate(hub, [{ boxShadow: '0 0 0 0px #f6c94570' }, { boxShadow: '0 0 0 70px #f6c94500' }], { duration: 900, easing: 'ease-out' });
  }
  nodes.forEach((node, index) => {
    node.button.addEventListener('click', () => {
      if (suppressClick === node.button) { suppressClick = null; return; }
      selectNode(selected === index ? null : index);
    });
    node.button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || drag) return;
      cancelReset(false);
      suppressClick = null;
      const rect = stage.getBoundingClientRect();
      drag = { node, index, id: event.pointerId, startX: event.clientX, startY: event.clientY, x: node.x, y: node.y, width: rect.width, height: rect.height, moved: false };
      node.button.setPointerCapture(event.pointerId);
    });
    node.button.addEventListener('pointermove', event => {
      if (!drag || drag.node !== node || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      if (!drag.moved) { drag.moved = true; node.button.classList.add('is-dragging'); selectNode(index); }
      node.x = drag.x + dx / drag.width;
      node.y = drag.y + dy / drag.height;
      drawGraph();
    });
    function release(event) {
      if (!drag || drag.node !== node || event.pointerId !== drag.id) return;
      suppressClick = drag.moved ? node.button : null;
      node.button.classList.remove('is-dragging');
      drag = null;
      if (node.button.hasPointerCapture(event.pointerId)) node.button.releasePointerCapture(event.pointerId);
    }
    node.button.addEventListener('pointerup', release);
    node.button.addEventListener('pointercancel', release);
    node.button.addEventListener('lostpointercapture', release);
    node.button.addEventListener('keydown', event => {
      suppressClick = null;
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      cancelReset(false);
      const step = event.shiftKey ? .07 : .025;
      node.x += event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      node.y += event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      drawGraph();
      if (selected !== index) selectNode(index);
    });
  });
  hub.addEventListener('click', () => selectNode(allLit ? null : 'all'));
  function cancelReset(finish) {
    if (!resetFrame) return;
    cancelAnimationFrame(resetFrame);
    resetFrame = 0;
    if (finish) {
      nodes.forEach(node => { node.x = node.initialX; node.y = node.initialY; });
      drawGraph();
    }
  }
  reset.addEventListener('click', () => {
    cancelReset(false);
    const before = nodes.map(node => ({ x: node.x, y: node.y }));
    selectNode(null);
    const start = performance.now();
    function step(now) {
      const progress = moving() ? Math.min(1, (now - start) / 650) : 1;
      const ease = 1 - (1 - progress) ** 4;
      nodes.forEach((node, index) => {
        node.x = before[index].x + (node.initialX - before[index].x) * ease;
        node.y = before[index].y + (node.initialY - before[index].y) * ease;
      });
      drawGraph();
      resetFrame = progress < 1 ? requestAnimationFrame(step) : 0;
    }
    step(start);
  });
  document.addEventListener('motionpreferencechange', () => { if (!moving()) cancelReset(true); });
  reduced.addEventListener('change', () => { if (reduced.matches) cancelReset(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelReset(true); });
  if ('ResizeObserver' in window) new ResizeObserver(drawGraph).observe(stage);
  else window.addEventListener('resize', drawGraph, { passive: true });
  drawGraph();

  // 滚动折页与场景滑块，使用现有布局，不阻断正常页面滚动。
  const featureSection = document.querySelector('.possibilities');
  const cards = [...featureSection.querySelectorAll('.feature-card')];
  featureSection.classList.add('scroll-unfold');
  let unfoldFrame = 0;
  function updateUnfold() {
    unfoldFrame = 0;
    cards.forEach((card, index) => {
      const top = card.offsetTop + card.offsetParent.getBoundingClientRect().top;
      const progress = moving() ? Math.max(0, Math.min(1, (window.innerHeight - top) / (window.innerHeight * .58))) : 1;
      card.style.setProperty('--unfold-y', `${(1 - progress) * (45 + index * 18)}px`);
      card.style.setProperty('--unfold-turn', `${(1 - progress) * (13 + index * 5)}deg`);
    });
  }
  function queueUnfold() { if (!unfoldFrame) unfoldFrame = requestAnimationFrame(updateUnfold); }
  window.addEventListener('scroll', queueUnfold, { passive: true });
  window.addEventListener('resize', queueUnfold, { passive: true });
  queueUnfold();
  const tabs = document.querySelector('.scenario-tabs');
  const glider = document.createElement('span');
  glider.className = 'tab-glider';
  glider.setAttribute('aria-hidden', 'true');
  tabs.classList.add('has-glider');
  tabs.prepend(glider);
  function positionGlider() {
    const active = tabs.querySelector('[aria-selected="true"]');
    glider.style.width = `${active.offsetWidth}px`;
    glider.style.transform = `translateX(${active.offsetLeft}px)`;
  }
  document.addEventListener('scenariochange', positionGlider);
  if ('ResizeObserver' in window) new ResizeObserver(positionGlider).observe(tabs);
  else window.addEventListener('resize', positionGlider, { passive: true });
  positionGlider();
})();
