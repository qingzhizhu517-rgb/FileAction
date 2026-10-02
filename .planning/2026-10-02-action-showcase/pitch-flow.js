/* 路演主线的可操作示意：回溯、按需询问、自主保留、选择后准备产物。
 * 所有输入仅在本页会话内存中使用，无上传、模型调用、持久存储或对外发送。 */
'use strict';
(() => {
  const examples = window.fileactionPitchExamples;
  const radar = document.querySelector('.opportunity-scene');
  const scene = document.querySelector('.action-scene');
  if (!examples || !radar || !scene) return;
  const sourceButton = radar.querySelector('.pitch-source-button');
  const picker = scene.querySelector('#action-case');
  const workspace = scene.querySelector('.action-workspace');
  const editor = scene.querySelector('#action-editor');
  const tabs = [...scene.querySelectorAll('[data-artifact]')];
  const stop = scene.querySelector('#action-stop');
  const go = scene.querySelector('#action-go');
  const states = Object.fromEntries(Object.keys(examples).map(key => [key, {
    answer: '', input: '', note: examples[key].note, retained: null, drafts: {}, choice: null, type: 'draft',
  }]));
  let key = radar.dataset.radarCase || 'scholarship';
  let modalKey = key;
  let returnFocus;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = document.documentElement.classList.contains('motion-paused');

  const modal = document.createElement('dialog');
  modal.id = 'pitch-evidence-dialog';
  modal.className = 'trust-modal pitch-modal';
  modal.setAttribute('aria-labelledby', 'pitch-evidence-title');
  modal.innerHTML = `
    <div class="trust-modal-top"><span>原文 × 相关背景 / 合成示例</span><button class="trust-close" type="button" aria-label="关闭解读依据">×</button></div>
    <h2 id="pitch-evidence-title">为什么这几条与你有关？</h2>
    <div class="trust-source-pair">
      <section class="trust-source-paper"><h3 id="pitch-source-title"></h3><p id="pitch-source-text"></p><small>文件明确写的 · 合成原文片段</small></section>
      <section class="trust-source-paper"><h3>已确认的相关背景</h3><p id="pitch-background"></p><small>示例用户已确认 · 不从文件自行推断个人经历</small></section>
    </div>
    <section class="pitch-interpretation"><h3>结合两者的关联判断</h3><p id="pitch-interpretation"></p></section>
    <section class="pitch-uncertain"><h3>还不能确定的</h3><p id="pitch-uncertain"></p></section>
    <section class="pitch-question"><span class="action-eyebrow">只在影响判断时，问一个相关问题</span><h3 id="pitch-question-title"></h3><p id="pitch-question-why"></p>
      <label for="pitch-answer">可选补充 · 请使用合成示例，不填写真实个人资料</label><textarea id="pitch-answer" rows="2" maxlength="300"></textarea>
      <div class="pitch-modal-actions"><button id="pitch-confirm" type="button">确认这条补充</button><button id="pitch-skip" type="button">暂不提供，继续了解</button></div><p id="pitch-answer-status" role="status"></p>
    </section>
    <section class="pitch-memory"><span class="action-eyebrow">随着这次阅读与交流，形成一条积累</span><h3>内容可改，留不留下由你决定。</h3>
      <label for="pitch-note">本次笔记（示例，不是必填档案）</label><textarea id="pitch-note" rows="3" maxlength="1000"></textarea>
      <div class="pitch-modal-actions"><button id="pitch-keep" type="button">保留当前版本</button><button id="pitch-discard" type="button">不保留 / 移除</button></div><p id="pitch-note-status" role="status">尚未保留。</p>
    </section>
    <p class="trust-modal-note">本页为合成体验。补充与笔记只在当前页面内存中使用，刷新即清除；不会自动推断条件已满足。</p>`;
  document.body.append(modal);
  const q = selector => modal.querySelector(selector);
  sourceButton.disabled = false;
  sourceButton.setAttribute('aria-haspopup', 'dialog');
  sourceButton.setAttribute('aria-controls', modal.id);
  function markedText(target, text, highlight) {
    const index = text.indexOf(highlight);
    target.replaceChildren();
    if (index < 0) { target.textContent = text; return; }
    const mark = document.createElement('mark');
    mark.textContent = highlight;
    target.append(document.createTextNode(text.slice(0, index)), mark, document.createTextNode(text.slice(index + highlight.length)));
  }
  function noteStatus() {
    const state = states[modalKey];
    q('#pitch-note-status').textContent = state.retained === null ? '尚未保留；不会自动留下这条笔记。'
      : state.retained === state.note ? '已保留当前版本，仅用于本页后续准备；刷新即清除。'
      : '内容已修改，尚未保留新版；后续仍使用上次保留版本。';
  }
  sourceButton.addEventListener('click', () => {
    modalKey = radar.dataset.radarCase || key;
    const data = examples[modalKey], state = states[modalKey];
    returnFocus = sourceButton;
    modal.dataset.case = modalKey;
    q('#pitch-source-title').textContent = data.sourceTitle;
    markedText(q('#pitch-source-text'), data.source, data.highlight);
    q('#pitch-background').textContent = data.background;
    q('#pitch-interpretation').textContent = data.reason;
    q('#pitch-uncertain').textContent = data.uncertain;
    q('#pitch-question-title').textContent = data.question;
    q('#pitch-question-why').textContent = data.whyAsk;
    q('#pitch-answer').placeholder = data.placeholder;
    q('#pitch-answer').value = state.input;
    q('#pitch-note').value = state.note;
    q('#pitch-answer-status').textContent = state.answer ? `已确认的补充：${state.answer}` : '可以跳过，不影响查看已有解读。';
    noteStatus();
    modal.showModal();
    document.dispatchEvent(new Event('pitchdialogchange'));
    document.body.classList.add('modal-open');
    modal.scrollTop = 0;
    q('.trust-close').focus({ preventScroll: true });
  });
  q('#pitch-answer').addEventListener('input', event => { states[modalKey].input = event.target.value; });
  q('#pitch-note').addEventListener('input', event => { states[modalKey].note = event.target.value; noteStatus(); });
  q('#pitch-confirm').addEventListener('click', () => {
    const state = states[modalKey], answer = state.input.trim();
    if (!answer) { q('#pitch-answer-status').textContent = '没有内容也没关系，可以选择“暂不提供”。'; return; }
    const lastAnswer = state.answer;
    state.answer = answer;
    // 用户已编辑的笔记不覆盖；只有仍为默认笔记时随实际交流更新。
    if (state.note === examples[modalKey].note || state.note === `${examples[modalKey].note}\n本次确认补充：${lastAnswer}`) {
      state.note = `${examples[modalKey].note}\n本次确认补充：${answer}`;
      q('#pitch-note').value = state.note;
    }
    q('#pitch-answer-status').textContent = '已作为你确认的补充，首次准备产物时引用；已有产物保留你的编辑。未改变原文或自动判定资格。';
    noteStatus();
    refreshContext();
  });
  q('#pitch-skip').addEventListener('click', () => {
    q('#pitch-answer-status').textContent = '这次可以不补充。未知继续标明，你仍可了解或选择下一步。';
  });
  q('#pitch-keep').addEventListener('click', () => {
    const state = states[modalKey];
    if (!state.note.trim()) { q('#pitch-note-status').textContent = '空笔记无需保留，也可以直接选择“不保留”。'; return; }
    state.note = state.note.trim();
    state.retained = state.note;
    q('#pitch-note').value = state.note;
    noteStatus();
    refreshContext();
  });
  q('#pitch-discard').addEventListener('click', () => {
    states[modalKey].retained = null;
    q('#pitch-note-status').textContent = '已移除保留状态，后续准备不再自动引用这条笔记；既有产物由你编辑。';
    refreshContext();
  });
  q('.trust-close').addEventListener('click', () => modal.close());
  modal.addEventListener('click', event => {
    const r = modal.getBoundingClientRect();
    if (event.target === modal && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) modal.close();
  });
  modal.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...modal.querySelectorAll('button,textarea')].filter(e => !e.disabled && e.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  modal.addEventListener('close', () => {
    document.body.classList.toggle('modal-open', Boolean(document.querySelector('dialog[open]')));
    document.dispatchEvent(new Event('pitchdialogchange'));
    returnFocus?.focus({ preventScroll: true });
  });

  function refreshContext() {
    const data = examples[key], state = states[key];
    picker.value = key;
    scene.dataset.actionCase = key;
    scene.querySelector('#action-context-title').textContent = data.title.join('');
    scene.querySelector('#action-context-copy').textContent = data.note;
    const note = scene.querySelector('.action-note-preview');
    note.hidden = state.retained === null;
    note.querySelector('p').textContent = state.retained || '';
    tabs[0].textContent = data.artifact;
  }
  function build(type) {
    const data = examples[key], state = states[key];
    let text = type === 'draft' ? data.draft : `${type === 'questions' ? '待核实问题' : '材料准备清单'}（合成示例，可编辑）\n\n${data[type === 'questions' ? 'questions' : 'checklist'].map((item, i) => `${i + 1}. ${item}`).join('\n')}\n\n由本人核实后决定是否继续，不自动提交或对外发送。`;
    if (state.answer) text += `\n\n本次由你确认的补充（未外部核实）：\n${state.answer}`;
    if (state.retained) text += `\n\n你选择保留的本次笔记：\n${state.retained}`;
    return text;
  }
  function showArtifact(type) {
    const state = states[key];
    state.type = type;
    if (!(type in state.drafts)) state.drafts[type] = build(type);
    editor.value = state.drafts[type];
    tabs.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.artifact === type)));
    scene.querySelector('#action-output-title').textContent = type === 'draft' ? examples[key].artifact : type === 'questions' ? '待核实的问题' : '材料准备清单';
    scene.querySelector('#action-save-status').textContent = '当前内容保留在本页。切换场景或产物不会丢失编辑；刷新会清除。';
  }
  function select(keyToSelect) {
    if (!examples[keyToSelect]) return;
    key = keyToSelect;
    refreshContext();
    const state = states[key];
    workspace.hidden = state.choice !== 'go';
    scene.dataset.actionChoice = state.choice || 'pending';
    if (state.choice === 'go') showArtifact(state.type);
    scene.querySelector('#action-choice-status').textContent = state.choice === 'stop' ? '了解就好，到这里结束。没有生成新产物，也没有对外发送。'
      : state.choice === 'go' ? '已按你的选择准备可编辑示例，改动保留在本页。' : '尚未生成产物，也没有对外发送。';
  }
  picker.disabled = false;
  picker.addEventListener('change', () => {
    const button = radar.querySelector(`button[data-radar-case="${picker.value}"]`);
    button.click(); // 共用场景入口；不主动移动滚动位置。
  });
  document.addEventListener('pitchscenariochange', event => select(event.detail.key));
  go.disabled = false;
  stop.disabled = false;
  stop.addEventListener('click', () => {
    states[key].choice = 'stop';
    select(key);
  });
  go.addEventListener('click', () => {
    states[key].choice = 'go';
    workspace.classList.remove('is-open');
    select(key);
    requestAnimationFrame(() => workspace.classList.add('is-open'));
  });
  tabs.forEach(button => button.addEventListener('click', () => showArtifact(button.dataset.artifact)));
  editor.addEventListener('input', () => {
    states[key].drafts[states[key].type] = editor.value;
    scene.querySelector('#action-save-status').textContent = '已保留你的本页改动。切换产物不会丢失；刷新会清除。';
  });
  scene.querySelector('#action-download').addEventListener('click', () => {
    const blob = new Blob(['\uFEFF', editor.value], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url;
    link.download = `文启-${key}-${states[key].type}-可编辑示例.md`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    scene.querySelector('#action-save-status').textContent = '已发起当前编辑内容的下载；没有对外发送。';
  });
  select(key);

  // 第四屏自动演示停在“你的选择”：不把观看动画当作行动授权。
  const stage = scene.querySelector('.action-stage');
  const context = stage.querySelector('.action-context');
  const bridge = stage.querySelector('.action-bridge');
  const decision = stage.querySelector('.action-decision');
  const replay = scene.querySelector('#action-replay');
  let elapsed = 0, progress = 0, previous = null, frame = 0, visibilityFrame = 0, visible = false;
  const duration = 3000;
  const clamp = x => Math.max(0, Math.min(1, x));
  const phase = (start, length) => { const x = clamp((progress - start) / length); return x * x * (3 - 2 * x); };
  function draw() {
    [[context, phase(0, .35)], [bridge, phase(.2, .4)], [decision, phase(.45, .5)]].forEach(([element, p]) => {
      element.style.opacity = String(p);
      element.style.transform = `translateY(${(1 - p) * 16}px)`;
    });
    decision.inert = progress < .95;
    context.inert = progress < .35;
    scene.dataset.actionProgress = progress.toFixed(4);
    replay.hidden = reduced.matches;
    replay.disabled = progress < 1;
  }
  function halt() { cancelAnimationFrame(frame); frame = 0; previous = null; }
  function canPlay() { return visible && !paused && !reduced.matches && !document.hidden && !modal.open && progress < 1; }
  function tick(now) {
    frame = 0;
    if (!canPlay()) { sync(); return; }
    if (previous !== null) elapsed += now - previous;
    previous = now;
    progress = clamp(elapsed / duration);
    draw();
    if (progress < 1) frame = requestAnimationFrame(tick);
    else { previous = null; scene.dataset.actionPlayback = 'complete'; }
  }
  function sync() {
    if (reduced.matches) { halt(); progress = 1; elapsed = duration; draw(); scene.dataset.actionPlayback = 'static'; }
    else if (canPlay()) { scene.dataset.actionPlayback = 'playing'; if (!frame) frame = requestAnimationFrame(tick); }
    else { halt(); scene.dataset.actionPlayback = progress === 1 ? 'complete' : paused || document.hidden ? 'paused' : 'waiting'; }
  }
  function visibleNow() {
    visibilityFrame = 0;
    const r = stage.getBoundingClientRect(), header = document.querySelector('.nav-wrap').getBoundingClientRect().bottom;
    visible = Math.min(r.bottom, innerHeight) - Math.max(r.top, header) >= Math.min(80, r.height * .2);
    sync();
  }
  function queueVisible() { if (!visibilityFrame) visibilityFrame = requestAnimationFrame(visibleNow); }
  addEventListener('scroll', queueVisible, { passive: true });
  addEventListener('resize', queueVisible, { passive: true });
  addEventListener('pageshow', queueVisible);
  reduced.addEventListener('change', visibleNow);
  document.addEventListener('motionpreferencechange', event => { paused = event.detail.paused; sync(); });
  document.addEventListener('pitchdialogchange', sync);
  replay.addEventListener('click', () => { halt(); elapsed = 0; progress = 0; draw(); visibleNow(); });
  document.addEventListener('visibilitychange', () => { sync(); if (!document.hidden) visibleNow(); });
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(queueVisible);
    [stage, radar, document.querySelector('.organize-scene'), document.querySelector('.hero-scroll')].forEach(e => observer.observe(e));
  }
  draw();
  visibleNow();
})();
