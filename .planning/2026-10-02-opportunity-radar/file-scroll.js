/* 原生滚动驱动：不接管滚轮、不自动跳页，进度可随向上滚动完整还原。 */
'use strict';

(() => {
  const root = document.documentElement;
  const scene = document.querySelector('.hero-scroll');
  const hero = scene.querySelector('.hero');
  const copy = hero.querySelector('.hero-copy');
  const fileArray = hero.querySelector('.file-array');
  const surface = document.querySelector('.page-surface');
  const slots = [...hero.querySelectorAll('.file-slot')];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = value => Math.min(1, Math.max(0, value));
  let paused = false;
  let scrollFrame = 0;
  let measureFrame = 0;
  let pinStart = 0;
  let travel = 650;
  let overlap = 440;
  let headerHeight = 83;
  let availableHeight = 917;
  let sceneStart = 0;
  let visibleSlots = slots;

  function draw() {
    scrollFrame = 0;
    const distance = window.scrollY - sceneStart + headerHeight - pinStart;
    const progress = reduced.matches || paused ? 0 : clamp(distance / travel);
    const cover = reduced.matches || paused ? 0 : clamp((distance - travel + overlap) / availableHeight);
    hero.classList.toggle('is-erasing', progress > .005);
    hero.dataset.eraseProgress = progress.toFixed(3);
    fileArray.inert = progress > .06;
    // 标题保留到下一页覆盖上来，避免文件擦除后出现整屏空白。
    const copyAlpha = 1 - clamp(progress * .35 + cover * .65);
    hero.style.setProperty('--copy-alpha', copyAlpha.toFixed(3));
    hero.style.setProperty('--copy-shift', `${-progress * 65}px`);
    hero.style.setProperty('--ambient-alpha', (1 - progress).toFixed(3));
    // 首屏文案退场后移出键盘焦点序列；回滚立即恢复。
    copy.inert = copyAlpha < .04;
    const bottom = hero.querySelector('.hero-bottom');
    bottom.inert = copyAlpha < .04;
    visibleSlots.forEach((slot, index) => {
      const delay = .025 + index / Math.max(1, visibleSlots.length - 1) * .23;
      const erase = clamp((progress - delay) / .46);
      slot.style.setProperty('--wipe', `${((1 - erase) * 100).toFixed(2)}%`);
      slot.style.setProperty('--edge-alpha', erase > .005 && erase < .995 ? '1' : '0');
      slot.style.setProperty('--erase-lift', `${(-erase * 22).toFixed(2)}px`);
      slot.style.setProperty('--erase-x', `${((index - (visibleSlots.length - 1) / 2) * erase * 4).toFixed(2)}px`);
    });
    surface.style.setProperty('--surface-radius', `${((1 - cover) * 36).toFixed(1)}px`);
  }

  function measure() {
    measureFrame = 0;
    root.classList.toggle('scroll-linked', !reduced.matches);
    headerHeight = document.querySelector('.nav-wrap').offsetHeight + 1;
    availableHeight = Math.max(280, window.innerHeight - headerHeight);
    const heroHeight = hero.offsetHeight;
    pinStart = Math.max(0, heroHeight - availableHeight);
    travel = Math.round(Math.max(420, Math.min(900, availableHeight * .95)));
    overlap = Math.round(Math.min(heroHeight, availableHeight) * .62);
    sceneStart = scene.getBoundingClientRect().top + window.scrollY;
    scene.style.setProperty('--scroll-scene-height', `${heroHeight + travel}px`);
    scene.style.setProperty('--hero-pin-top', `${headerHeight - pinStart}px`);
    surface.style.setProperty('--scroll-overlap', `${overlap}px`);
    visibleSlots = slots.filter(slot => slot.offsetWidth > 0);
    draw();
  }

  function queueMeasure() {
    if (!measureFrame) measureFrame = requestAnimationFrame(measure);
  }
  window.addEventListener('scroll', () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(draw);
  }, { passive: true });
  window.addEventListener('resize', queueMeasure, { passive: true });
  window.addEventListener('pageshow', queueMeasure);
  reduced.addEventListener('change', queueMeasure);
  document.addEventListener('motionpreferencechange', event => {
    paused = event.detail.paused;
    draw();
  });
  if ('ResizeObserver' in window) new ResizeObserver(queueMeasure).observe(hero);
  measure();
  document.fonts?.ready.then(queueMeasure);
})();
