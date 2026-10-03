/* 第四屏：进入视口后自动播放本地合成材料核验叙事，不执行真实核验。 */
'use strict';

(() => {
  const scene = document.querySelector('.trust-scene');
  if (!scene) return;
  const panel = scene.querySelector('.trust-sticky');
  const bench = scene.querySelector('.trust-workbench');
  const slots = [...scene.querySelectorAll('.trust-slot')];
  const cards = [...scene.querySelectorAll('.trust-card')];
  const checkpoints = [...scene.querySelectorAll('.trust-checkpoints > span')];
  const gate = scene.querySelector('.trust-scan-gate');
  const equation = scene.querySelector('.trust-equation');
  const archive = scene.querySelector('.trust-source-archive');
  const evidenceButtons = [...scene.querySelectorAll('.trust-evidence')];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const compact = matchMedia('(max-width: 900px)');
  const clamp = value => Math.max(0, Math.min(1, value));
  const smooth = value => value * value * (3 - 2 * value);
  const phase = (value, start, length) => smooth(clamp((value - start) / length));
  const duration = 5200;
  let progress = 0, previous = -1, elapsed = 0;
  let frame = 0, measureFrame = 0, visibilityFrame = 0;
  let lastTick = null;
  let visible = false;
  let origins = [];
  let paused = document.documentElement.classList.contains('motion-paused');
  let returnFocus = null;
  const replay = document.createElement('button');
  replay.type = 'button';
  replay.className = 'trust-replay';
  replay.textContent = '重播动效 ↻';
  replay.setAttribute('aria-label', '重新播放材料核验动效');
  replay.disabled = true;
  scene.querySelector('.trust-footer > p').append(replay);
  replay.addEventListener('click', () => {
    stopPlayback();
    elapsed = 0;
    progress = 0;
    draw(true);
    updateVisibility();
  });

  // 静态原文放在 HTML 中；弹窗从同一份原文生成，避免两套判断依据漂移。
  const dialog = document.createElement('dialog');
  dialog.id = 'reuse-source-dialog';
  dialog.className = 'trust-modal';
  dialog.setAttribute('aria-labelledby', 'reuse-modal-title');
  dialog.innerHTML = `
    <div class="trust-modal-top"><span>SOURCE × RECORD / 合成原文回溯</span><button type="button" class="trust-close" aria-label="关闭材料判断依据"><svg class="icon" aria-hidden="true"><use href="#i-close"/></svg></button></div>
    <h2 id="reuse-modal-title"></h2><div class="trust-modal-content"></div>
    <section class="trust-proof-lab" aria-labelledby="trust-proof-title" hidden>
      <h3 id="trust-proof-title">少一项依据，判断会怎样？</h3>
      <p>点击切换依据是否已核实，试试看。这里只改变演示条件。</p>
      <div class="trust-proof-switches"><button type="button" data-proof-toggle="rule" aria-pressed="true">✓ 禁用条款已核实</button><button type="button" data-proof-toggle="fact" aria-pressed="true">✓ 对应获奖事实已核实</button></div>
      <output class="trust-proof-result" aria-live="polite" data-state="blocked">✗ 本次不能用：明确禁用条款与对应事实同时成立。</output>
    </section>
    <p class="trust-modal-note">通知、材料与记录均为预设合成示例；结果只针对说明的本次用途。</p>`;
  document.body.append(dialog);
  const proofButtons = [...dialog.querySelectorAll('[data-proof-toggle]')];
  const proofResult = dialog.querySelector('.trust-proof-result');
  function updateProof() {
    const verified = proofButtons.map(button => button.getAttribute('aria-pressed') === 'true');
    proofButtons.forEach((button, index) => {
      const title = index === 0 ? '禁用条款' : '对应获奖事实';
      button.textContent = `${verified[index] ? '✓' : '△'} ${title}${verified[index] ? '已核实' : '待核实'}`;
      dialog.querySelector(`[data-proof-source="${button.dataset.proofToggle}"]`)?.classList.toggle('is-unverified', !verified[index]);
    });
    const blocked = verified.every(Boolean);
    proofResult.dataset.state = blocked ? 'blocked' : 'warning';
    proofResult.textContent = blocked
      ? '✗ 本次不能用：明确禁用条款与对应事实同时成立。'
      : '△ 要处理：依据尚不完整，需继续核实；不能直接判定禁用，也不能直接判定可用。';
  }
  proofButtons.forEach(button => button.addEventListener('click', () => {
    button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
    updateProof();
  }));
  function openEvidence(button) {
    const source = scene.querySelector(`#reuse-source-${button.dataset.trustEvidence}`);
    if (!source || dialog.open) return;
    returnFocus = button;
    dialog.querySelector('h2').textContent = source.querySelector('h3').textContent;
    const content = dialog.querySelector('.trust-modal-content');
    content.replaceChildren(...[...source.children].filter(child => child.tagName !== 'H3').map(child => child.cloneNode(true)));
    dialog.querySelector('.trust-proof-lab').hidden = button.dataset.trustEvidence !== 'award';
    proofButtons.forEach(control => control.setAttribute('aria-pressed', 'true'));
    updateProof();
    dialog.dataset.material = button.dataset.trustEvidence;
    dialog.showModal();
    syncPlayback();
    document.body.classList.add('modal-open');
    dialog.scrollTop = 0;
    dialog.querySelector('.trust-close').focus({ preventScroll: true });
  }
  evidenceButtons.forEach(button => {
    button.disabled = false;
    button.addEventListener('click', () => openEvidence(button));
  });
  dialog.querySelector('.trust-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')].filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  dialog.addEventListener('click', event => {
    const r = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) dialog.close();
  });
  dialog.addEventListener('close', () => {
    document.body.classList.toggle('modal-open', Boolean(document.querySelector('dialog[open]')));
    returnFocus?.focus({ preventScroll: true });
    queueMeasure();
  });
  archive.hidden = true;

  function reveal(element, amount, shift = 0) {
    element.style.opacity = amount.toFixed(4);
    element.style.visibility = amount === 0 ? 'hidden' : 'visible';
    element.style.transform = `translateY(${((1 - amount) * shift).toFixed(2)}px)`;
  }
  function draw(force = false) {
    if (!force && Math.abs(progress - previous) < .00001) return;
    previous = progress;
    const opening = phase(progress, 0, .27);
    const scanning = phase(progress, .25, .37);
    checkpoints.forEach((checkpoint, index) => {
      const checked = phase(progress, .26 + index * .075, .12);
      checkpoint.classList.toggle('is-checked', checked > .95);
      checkpoint.style.opacity = (.4 + .6 * checked).toFixed(4);
    });
    cards.forEach((card, index) => {
      const spread = phase(progress, index * .025, .26);
      const origin = origins[index] || { x: 0, y: 0 };
      const rotation = [-9, 3, 11][index] * (1 - spread);
      card.style.transform = `translate(${(origin.x * (1 - spread)).toFixed(2)}px, ${(origin.y * (1 - spread)).toFixed(2)}px) rotate(${rotation.toFixed(2)}deg) scale(${(.86 + spread * .14).toFixed(4)})`;
      card.style.zIndex = String(index + 1);
      [...card.querySelectorAll('.trust-facts > div')].forEach((row, rowIndex) => {
        reveal(row, phase(progress, .21 + index * .045 + rowIndex * .07, .16), 6);
      });
      const verdict = phase(progress, .60 + index * .065, .17);
      card.style.setProperty('--trust-verdict', verdict.toFixed(4));
      reveal(card.querySelector('.trust-verdict'), verdict, 9);
      card.querySelector('.trust-stamp').style.transform = `rotate(${(-13 * (1 - verdict)).toFixed(2)}deg) scale(${(1.3 - .3 * verdict).toFixed(4)})`;
      card.dataset.verified = String(verdict === 1);
      evidenceButtons[index].inert = verdict < .98;
    });
    const distance = compact.matches ? bench.clientHeight + 58 : bench.clientWidth + 75;
    gate.style.transform = compact.matches ? `translateY(${scanning * distance - 58}px)` : `translateX(${scanning * distance - 75}px)`;
    gate.style.opacity = (reduced.matches ? 0 : Math.sin(Math.PI * scanning)).toFixed(4);
    reveal(equation, phase(progress, .84, .13), 10);
    scene.style.setProperty('--trust-progress', progress.toFixed(4));
    scene.dataset.trustProgress = progress.toFixed(4);
    scene.dataset.trustPhase = opening < 1 ? 'materials' : progress < .6 ? 'checking' : 'verdicts';
    replay.disabled = progress < 1 || reduced.matches;
    scene.querySelector('.trust-scroll-hint').textContent = progress < .28
      ? '自动演示中，展开你的旧材料'
      : progress < .9 ? '来源、版本与记录，逐项对照本次规则' : '点击“看原文”，回溯判断；试试少一项依据会怎样';
  }
  function measure() {
    measureFrame = 0;
    const header = document.querySelector('.nav-wrap').offsetHeight + 1;
    scene.style.setProperty('--trust-header', `${header}px`);
    const middle = slots[1].getBoundingClientRect();
    origins = slots.map((slot, index) => {
      const r = slot.getBoundingClientRect();
      return { x: middle.left - r.left + (index - 1) * (compact.matches ? 7 : 21), y: middle.top - r.top + (index - 1) * 9 };
    });
    draw(true);
    updateVisibility();
  }
  function stopPlayback() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTick = null;
  }
  function canPlay() {
    return visible && !paused && !reduced.matches && !document.hidden && !dialog.open && progress < 1;
  }
  function tick(now) {
    frame = 0;
    if (!canPlay()) { syncPlayback(); return; }
    if (lastTick !== null) elapsed += now - lastTick;
    lastTick = now;
    progress = clamp(elapsed / duration);
    draw();
    if (progress < 1) frame = requestAnimationFrame(tick);
    else { lastTick = null; scene.dataset.trustPlayback = 'complete'; }
  }
  function syncPlayback() {
    if (reduced.matches) {
      stopPlayback();
      elapsed = duration;
      progress = 1;
      draw(true);
      scene.dataset.trustPlayback = 'static';
    } else if (canPlay()) {
      scene.dataset.trustPlayback = 'playing';
      if (!frame) frame = requestAnimationFrame(tick);
    } else {
      stopPlayback();
      scene.dataset.trustPlayback = progress === 1 ? 'complete' : paused || document.hidden || dialog.open ? 'paused' : 'waiting';
    }
  }
  function updateVisibility() {
    visibilityFrame = 0;
    const rect = bench.getBoundingClientRect();
    const header = document.querySelector('.nav-wrap').getBoundingClientRect().bottom;
    // 与第三屏一致：画板露出一小段便开播，滚动只影响是否可见。
    visible = Math.min(rect.bottom, innerHeight) - Math.max(rect.top, header) >= Math.min(96, rect.height * .2);
    syncPlayback();
  }
  function queueVisibility() {
    if (!visibilityFrame) visibilityFrame = requestAnimationFrame(updateVisibility);
  }
  function queueMeasure() {
    if (!measureFrame) measureFrame = requestAnimationFrame(measure);
  }
  addEventListener('scroll', queueVisibility, { passive: true });
  addEventListener('resize', queueMeasure, { passive: true });
  addEventListener('pageshow', queueMeasure);
  reduced.addEventListener('change', queueMeasure);
  document.addEventListener('motionpreferencechange', event => {
    paused = event.detail.paused;
    syncPlayback();
  });
  document.addEventListener('visibilitychange', () => {
    syncPlayback();
    if (!document.hidden) queueMeasure();
  });
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(queueMeasure);
    [panel, bench, document.querySelector('.opportunity-scene'), document.querySelector('.organize-scene'), document.querySelector('.hero-scroll'), document.querySelector('.nav-wrap')].forEach(element => { if (element) observer.observe(element); });
  }
  measure();
  document.fonts?.ready.then(queueMeasure);
})();
