// 总调度：背景、场景切换、章节标、字幕与进度条。window.render(t) 渲染任意时刻。
(function () {
  const { C, E, P, L, rng, h, logo } = K;
  const TL = window.TIMELINE, stage = document.getElementById('stage');

  // 背景
  const bg = h('div', 'bg', '', stage);
  const orbs = [['#1D4ED8', 900, 0.30], ['#7C3AED', 800, 0.28], ['#DB2777', 620, 0.16], ['#0891B2', 700, 0.22]].map(([c, s, o]) =>
    h('div', 'orb', '', bg, { width: s + 'px', height: s + 'px', background: `radial-gradient(circle, ${c} 0%, transparent 65%)`, opacity: o }));
  const grid = h('div', 'grid', '', bg);
  const r = rng(42);
  const dots = Array.from({ length: 70 }, () => ({ el: h('div', 'dot', '', bg), x: r() * 1920, y: r() * 1080, v: 8 + r() * 26, a: r() * 6.28, s: 0.5 + r() * 1.6 }));
  h('div', 'vignette', '', stage);

  // 场景
  const scenes = TL.scenes.map(sc => {
    const root = h('div', 'scene', '', stage);
    const def = K.S[sc.id]; def.build(root);
    return { ...sc, root, def };
  });

  // 常驻界面
  const chapter = h('div', '', '', stage); chapter.id = 'chapter';
  const brand = h('div', '', logo() + '<span>DoAgent</span>', stage); brand.id = 'brand';
  const subs = h('div', '', '<span></span>', stage); subs.id = 'subs';
  const subSpan = subs.firstChild;
  const bar = h('div', '', '', stage); bar.id = 'bar';

  const FADE = 0.55;
  window.render = function (t) {
    // 背景缓慢漂移
    orbs.forEach((o, i) => {
      const x = 960 + Math.cos(t * 0.11 + i * 1.7) * 620 - o.offsetWidth / 2;
      const y = 540 + Math.sin(t * 0.09 + i * 2.3) * 360 - o.offsetHeight / 2;
      o.style.transform = `translate(${x}px,${y}px)`;
    });
    grid.style.backgroundPosition = `0 ${(t * 40) % 90}px`;
    dots.forEach(d => {
      const y = ((d.y - t * d.v) % 1080 + 1080) % 1080, x = d.x + Math.sin(t * 0.5 + d.a) * 18;
      d.el.style.transform = `translate(${x}px,${y}px) scale(${d.s})`;
      d.el.style.opacity = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 1.3 + d.a));
    });

    // 场景：前后交叠淡入淡出，带轻微缩放与模糊
    let cur = scenes[0];
    scenes.forEach(sc => {
      const lt = t - sc.start, end = sc.dur;
      const vis = lt > -FADE && lt < end + FADE * 0.2;
      sc.root.style.display = vis ? 'block' : 'none';
      if (!vis) return;
      if (lt >= 0 && lt < end) cur = sc;
      const fin = P(lt, -0.05, FADE, E.out), fout = sc.id === 'scenes-end' ? 0 : P(lt, end - FADE, end, E.inout);
      const last = sc === scenes[scenes.length - 1];
      const o = fin * (1 - (last ? P(lt, end - 1.2, end, E.inout) : fout));
      sc.root.style.opacity = o;
      sc.root.style.transform = `scale(${L(1.04, 1, fin) * L(1, 0.97, last ? 0 : fout)})`;
      sc.root.style.filter = (1 - fin) + fout > 0.02 && !last ? `blur(${((1 - fin) + fout) * 8}px)` : 'none';
      sc.def.frame(C(lt, 0, end + FADE));
    });

    // 章节标
    const [num, name] = cur.def.chapter;
    const key = num + name;
    if (chapter._k !== key) { chapter._k = key; chapter.innerHTML = num ? `<b>${num}</b>${name}` : ''; }
    const lt = t - cur.start;
    chapter.style.opacity = P(lt, 0.2, 0.7) * (1 - P(lt, cur.dur - 0.5, cur.dur));
    chapter.style.transform = `translateX(${L(-20, 0, P(lt, 0.2, 0.7))}px)`;
    const tail = TL.total - t;
    brand.style.opacity = P(t, 0.5, 1.5) * (cur.id === 's3' || cur.id === 's12' ? 0 : 1) * C(tail / 1.2);

    // 字幕
    let sub = null;
    for (const sc of scenes) for (const s of sc.subs) if (t >= s.start && t < s.end + 0.25) sub = s;
    const txt = sub ? sub.text : '';
    if (subSpan._t !== txt) { subSpan._t = txt; subSpan.textContent = txt; }
    subs.style.opacity = sub ? P(t, sub.start, sub.start + 0.2) * (1 - P(t, sub.end + 0.05, sub.end + 0.25)) : 0;
    subSpan.style.display = txt ? 'inline-block' : 'none';

    bar.style.width = (C(t / TL.total) * 1920) + 'px';
    bar.style.opacity = C(tail / 1.2);
  };
  window.READY = true;
})();
