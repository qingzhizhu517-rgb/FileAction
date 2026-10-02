/* 第二屏散落 → 归位；进度完全来自原生滚动，反向滚动可逐帧还原。 */
'use strict';

(() => {
  const scene = document.querySelector('.organize-scene');
  if (!scene) return;
  const panel = scene.querySelector('.organize-sticky');
  const board = scene.querySelector('.organize-board');
  const grid = scene.querySelector('.organize-grid');
  const slots = [...grid.children];
  const cards = slots.map(slot => slot.querySelector('.organize-card'));
  const insights = cards.map(card => [...card.querySelectorAll('.organize-insight')]);
  const status = scene.querySelector('.organize-status');
  const count = scene.querySelector('.organize-count');
  const hint = scene.querySelector('.organize-scroll-hint');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = value => Math.max(0, Math.min(1, value));
  const smooth = value => value * value * (3 - 2 * value);
  // 固定构图让回滚、缩放及重新进入页面时保持同一条整理轨迹。
  const scattered = [
    [.12, .24, -23, 1.02], [.43, .62, 17, 1.06], [.77, .21, -16, .97],
    [.53, .37, 25, 1.08], [.29, .65, -20, .95], [.88, .67, 21, 1.01],
    [.63, .80, -10, 1.04], [.32, .28, 14, .96], [.15, .80, 11, .96],
    [.77, .55, -27, 1.02], [.58, .12, -13, .98], [.44, .89, 19, .94],
  ];
  const sequence = [5, 1, 9, 0, 7, 4, 10, 2, 11, 6, 3, 8];
  let geometry = [];
  let start = 0;
  let travel = 1000;
  let frame = 0;
  let measureFrame = 0;
  let paused = document.documentElement.classList.contains('motion-paused');
  let progress = 0;
  let lastDrawn = -1;

  function draw(force = false) {
    frame = 0;
    if (!geometry.length) return;
    if (reduced.matches) progress = 1;
    else if (!paused) progress = clamp((window.scrollY - start) / travel);
    if (!force && Math.abs(lastDrawn - progress) < .00001) return;
    lastDrawn = progress;
    let settled = 0;
    geometry.forEach((item, index) => {
      const local = clamp((progress - .035 - sequence[index] * .015) / .67);
      const ease = smooth(local);
      const lift = Math.sin(local * Math.PI);
      const x = item.x * (1 - ease) + lift * (index % 2 ? 10 : -10);
      const y = item.y * (1 - ease) - lift * 18;
      const angle = item.angle * (1 - ease);
      const scale = item.scale + (1 - item.scale) * ease + lift * .025;
      cards[index].style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${angle.toFixed(3)}deg) scale(${scale.toFixed(4)})`;
      cards[index].style.setProperty('--settled', clamp((local - .88) / .12).toFixed(3));
      const focus = cards[index].dataset.readingFocus === 'true';
      cards[index].style.opacity = focus ? '1' : (1 - ease * .46).toFixed(3);
      cards[index].style.setProperty('--reading-focus', focus ? ease.toFixed(3) : '0');
      const titleProgress = smooth(clamp((local - .12) / .35));
      cards[index].style.setProperty('--title-shift', `${((1 - titleProgress) * 28).toFixed(2)}px`);
      insights[index].forEach((row, rowIndex) => {
        // 内容随文件自己的归位进度分层显现；无计时器，回滚也逐层收起。
        const reveal = smooth(clamp((local - .22 - rowIndex * .18) / .24));
        row.style.setProperty('--insight-reveal', reveal.toFixed(4));
        row.style.setProperty('--insight-shift', `${((1 - reveal) * 9).toFixed(2)}px`);
        row.style.setProperty('--insight-clip', `${((1 - reveal) * 100).toFixed(2)}%`);
        row.style.visibility = reveal === 0 ? 'hidden' : 'visible';
      });
      if (local === 1) settled += 1;
    });
    scene.style.setProperty('--order-progress', progress.toFixed(4));
    scene.style.setProperty('--order-guides', smooth(clamp((progress - .22) / .6)).toFixed(4));
    scene.dataset.organizeProgress = progress.toFixed(4);
    const phase = progress < .1 ? 'scattered' : settled === cards.length ? 'ordered' : 'arranging';
    scene.dataset.organizeState = phase;
    status.textContent = phase === 'scattered' ? '内容很多，先不用自己逐段筛选' : phase === 'ordered' ? '先看与你有关的四处，其余仍可回查' : '联系已确认背景，阅读重点逐渐浮现';
    count.textContent = phase === 'ordered' ? '4 处重点' : '一份通知';
    hint.textContent = reduced.matches ? '先理解与你有关的内容' : phase === 'ordered' ? '为什么这几条与你有关？继续看解读 ↓' : '继续下滑，看阅读重点浮现 ↓';
  }

  function measure() {
    measureFrame = 0;
    scene.classList.toggle('organize-enabled', !reduced.matches);
    const header = document.querySelector('.nav-wrap').offsetHeight + 1;
    scene.style.setProperty('--order-header', `${header}px`);
    const available = Math.max(240, window.innerHeight - header);
    const panelHeight = panel.offsetHeight;
    // 短屏先自然滚到文件画板，再开始吸附，确保整理过程完整可见。
    const lead = Math.max(0, panelHeight - available);
    start = scene.getBoundingClientRect().top + window.scrollY + lead - header;
    travel = Math.round(Math.max(680, Math.min(1400, available * 1.45)));
    scene.style.setProperty('--order-pin-top', `${header - lead}px`);
    scene.style.setProperty('--order-scene-height', `${panelHeight + travel}px`);
    const width = grid.clientWidth;
    const height = grid.clientHeight;
    const positions = slots.map(slot => ({ x: slot.offsetLeft, y: slot.offsetTop, width: slot.offsetWidth, height: slot.offsetHeight }));
    geometry = positions.map((position, index) => {
      const [nx, ny, angle, scale] = scattered[index];
      const radians = Math.abs(angle) * Math.PI / 180;
      const halfWidth = (Math.cos(radians) * position.width + Math.sin(radians) * position.height) * scale / 2;
      const halfHeight = (Math.sin(radians) * position.width + Math.cos(radians) * position.height) * scale / 2;
      const centerX = Math.max(halfWidth, Math.min(width - halfWidth, nx * width));
      const centerY = Math.max(halfHeight, Math.min(height - halfHeight, ny * height));
      return { x: centerX - position.x - position.width / 2, y: centerY - position.y - position.height / 2, angle, scale };
    });
    slots.forEach((slot, index) => { slot.style.zIndex = String(2 + sequence[index]); });
    draw(true);
  }
  function queueDraw() {
    if (!frame && !document.hidden && !paused) frame = requestAnimationFrame(() => draw());
  }
  function queueMeasure() {
    if (!measureFrame) measureFrame = requestAnimationFrame(measure);
  }
  window.addEventListener('scroll', queueDraw, { passive: true });
  window.addEventListener('resize', queueMeasure, { passive: true });
  window.addEventListener('pageshow', queueMeasure);
  reduced.addEventListener('change', queueMeasure);
  document.addEventListener('motionpreferencechange', event => {
    paused = event.detail.paused;
    if (paused) { cancelAnimationFrame(frame); frame = 0; }
    else queueDraw();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(frame); frame = 0; }
    else queueMeasure();
  });
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(queueMeasure);
    [panel, board, document.querySelector('.hero-scroll'), document.querySelector('.nav-wrap')].forEach(element => observer.observe(element));
  }
  measure();
  document.fonts?.ready.then(queueMeasure);
})();
