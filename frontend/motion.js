/* 原生动效，无第三方依赖；与场景数据和实际业务交互分离。 */
'use strict';

(() => {
  const root = document.documentElement;
  const hero = document.querySelector('.hero');
  const canvas = document.querySelector('.hero-particles');
  const context = canvas.getContext('2d');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const runningAnimations = new Map();
  let paused = false;
  let heroVisible = true;
  let width = 0;
  let height = 0;
  let frame = 0;
  let time = 0;
  let previousTime = 0;
  const pointer = { x: 0, y: 0 };
  const canMove = () => !paused && !reduced.matches && !document.hidden;
  root.classList.add('motion-enhanced');

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'motion-toggle';
  toggle.setAttribute('aria-label', '暂停装饰动画');
  toggle.setAttribute('aria-pressed', 'false');
  toggle.textContent = '暂停动效';
  document.body.append(toggle);

  function animate(element, keyframes, options, remove = false) {
    if (!canMove() || !element.animate) {
      if (remove) element.remove();
      return;
    }
    const animation = element.animate(keyframes, options);
    const cleanup = () => {
      runningAnimations.delete(animation);
      if (remove) element.remove();
    };
    runningAnimations.set(animation, cleanup);
    animation.onfinish = cleanup;
    animation.oncancel = cleanup;
  }

  function stopAnimations() {
    [...runningAnimations].forEach(([animation, cleanup]) => {
      animation.cancel();
      cleanup();
    });
  }

  function renderParticles(now) {
    frame = 0;
    if (!context || !canMove() || !heroVisible) return;
    // 约 30fps 绘制，固定数量粒子，不随运行时间增长。
    if (previousTime && now - previousTime < 30) {
      frame = requestAnimationFrame(renderParticles);
      return;
    }
    time += previousTime ? Math.min(now - previousTime, 60) / 1000 : 0;
    previousTime = now;
    context.clearRect(0, 0, width, height);
    const compact = width < 650;
    const count = compact ? 18 : 40;
    for (let i = 0; i < count; i += 1) {
      const x = (i * 137.508 + Math.sin(time * .34 + i) * 22 + width) % width;
      const y = height - ((time * (7 + i % 5) + i * 67) % height);
      const edgeWeight = Math.min(1, Math.abs(x / width - .5) * 3 + (y / height > .6 ? .35 : 0));
      const opacity = (.18 + (Math.sin(time * 1.2 + i) + 1) * .15) * edgeWeight;
      context.fillStyle = `rgba(230, 173, 25, ${opacity})`;
      context.beginPath();
      context.arc(x, y, i % 4 === 0 ? 2.2 : 1.2, 0, Math.PI * 2);
      context.fill();
    }
    frame = requestAnimationFrame(renderParticles);
  }

  function syncPlayback() {
    root.classList.toggle('motion-paused', paused);
    root.classList.toggle('motion-suspended', document.hidden);
    cancelAnimationFrame(frame);
    frame = 0;
    previousTime = 0;
    if (canMove() && heroVisible && context) frame = requestAnimationFrame(renderParticles);
    if (!canMove()) stopAnimations();
    if (reduced.matches && context) context.clearRect(0, 0, width, height);
    toggle.hidden = reduced.matches;
    // 让基础文字层也遵守统一暂停开关。
    document.dispatchEvent(new CustomEvent('motionpreferencechange', { detail: { paused } }));
  }

  function resize() {
    const bounds = hero.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    syncPlayback();
  }

  toggle.addEventListener('click', () => {
    paused = !paused;
    toggle.textContent = paused ? '开启动效' : '暂停动效';
    toggle.setAttribute('aria-pressed', String(paused));
    toggle.setAttribute('aria-label', paused ? '开启装饰动画' : '暂停装饰动画');
    syncPlayback();
  });
  document.addEventListener('visibilitychange', syncPlayback);
  reduced.addEventListener('change', syncPlayback);
  window.addEventListener('resize', resize, { passive: true });
  if ('IntersectionObserver' in window) {
    const visibility = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        entry.target.classList.toggle('motion-offscreen', !entry.isIntersecting);
        if (entry.target === hero) {
          heroVisible = entry.isIntersecting;
          syncPlayback();
        }
      });
    });
    document.querySelectorAll('main section.hero, .page-surface > section').forEach(section => visibility.observe(section));
  }

  function updateHeroPointer(x, y) {
    hero.style.setProperty('--array-tilt-y', `${x * 8}deg`);
    hero.style.setProperty('--array-tilt-x', `${y * -5}deg`);
  }
  hero.addEventListener('pointermove', event => {
    if (!canMove() || !finePointer.matches || event.pointerType === 'touch') return;
    const bounds = hero.getBoundingClientRect();
    pointer.x = (event.clientX - bounds.left) / width - .5;
    pointer.y = (event.clientY - bounds.top) / height - .5;
    updateHeroPointer(pointer.x, pointer.y);
  }, { passive: true });
  hero.addEventListener('pointerleave', () => updateHeroPointer(0, 0));

  document.querySelectorAll('.feature-card').forEach(card => {
    card.addEventListener('pointermove', event => {
      if (!canMove() || !finePointer.matches) return;
      const rect = card.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      card.style.setProperty('--spot-x', `${x}px`);
      card.style.setProperty('--spot-y', `${y}px`);
      card.style.setProperty('--tilt-x', `${(y / rect.height - .5) * -8}deg`);
      card.style.setProperty('--tilt-y', `${(x / rect.width - .5) * 8}deg`);
    }, { passive: true });
    card.addEventListener('pointerleave', () => {
      card.style.setProperty('--tilt-x', '0deg');
      card.style.setProperty('--tilt-y', '0deg');
    });
  });

  document.querySelectorAll('.button').forEach(button => {
    button.addEventListener('pointermove', event => {
      if (!canMove() || !finePointer.matches) return;
      const rect = button.getBoundingClientRect();
      button.style.setProperty('--magnet-x', `${(event.clientX - rect.left - rect.width / 2) * .08}px`);
      button.style.setProperty('--magnet-y', `${(event.clientY - rect.top - rect.height / 2) * .15}px`);
    }, { passive: true });
    button.addEventListener('pointerleave', () => {
      button.style.setProperty('--magnet-x', '0px');
      button.style.setProperty('--magnet-y', '0px');
    });
    button.addEventListener('click', event => {
      if (!canMove() || !event.detail) return;
      for (let i = 0; i < 8; i += 1) {
        const spark = document.createElement('span');
        spark.className = 'click-spark';
        spark.setAttribute('aria-hidden', 'true');
        document.body.append(spark);
        const angle = i / 8 * Math.PI * 2;
        animate(spark, [
          { transform: `translate(${event.clientX}px, ${event.clientY}px) scale(1)`, opacity: 1 },
          { transform: `translate(${event.clientX + Math.cos(angle) * 55}px, ${event.clientY + Math.sin(angle) * 55}px) rotate(140deg) scale(0)`, opacity: 0 },
        ], { duration: 650, easing: 'cubic-bezier(.16,1,.3,1)' }, true);
      }
    });
  });

  document.addEventListener('scenariochange', () => {
    stopAnimations();
    if (!canMove()) return;
    const paper = document.querySelector('.sample-document');
    if (!paper) return;
    animate(paper, [{ opacity: .3, transform: 'translateY(18px) rotate(-2deg)' }, { opacity: 1, transform: 'translateY(0) rotate(0)' }], { duration: 650, easing: 'cubic-bezier(.16,1,.3,1)' });
    const beam = document.createElement('span');
    beam.className = 'scan-beam';
    beam.setAttribute('aria-hidden', 'true');
    paper.append(beam);
    animate(beam, [{ transform: 'translateY(-75px)', opacity: 0 }, { opacity: 1, offset: .15 }, { transform: `translateY(${paper.clientHeight}px)`, opacity: 0 }], { duration: 1100, easing: 'ease-in-out' }, true);
    document.querySelectorAll('.answer-content > *, .material-row').forEach((element, index) => {
      // 材料容器自身不延迟，与子行重复变换会导致视觉跳动。
      if (element.classList.contains('material-list')) return;
      animate(element, [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 420, delay: Math.min(index * 55, 330), fill: 'backwards', easing: 'cubic-bezier(.16,1,.3,1)' });
    });
  });

  resize();
})();
