// 总调度：纸面底纹、场景淡入淡出、章节标、字幕与进度条。window.render(t) 渲染任意时刻。
(function () {
  const { C, E, P, L, h, logo } = K;
  const TL = window.TIMELINE, stage = document.getElementById('stage');

  // 纸面颗粒：固定种子噪点，静态不动
  const grain = h('canvas', '', '', stage); grain.id = 'grain';
  grain.width = 960; grain.height = 540; grain.style.width = '1920px'; grain.style.height = '1080px';
  const g = grain.getContext('2d'), img = g.createImageData(960, 540);
  let s = 7;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const v = 228 + (s >>> 24) % 28;
    img.data[i] = v; img.data[i + 1] = v - 3; img.data[i + 2] = v - 8; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);

  const scenes = TL.scenes.map(sc => {
    const root = h('div', 'scene', '', stage);
    const def = K.S[sc.id]; def.build(root);
    return { ...sc, root, def };
  });

  const chapter = h('div', '', '', stage); chapter.id = 'chapter';
  const brand = h('div', '', logo() + '<span>旁批</span>', stage); brand.id = 'brand';
  const subs = h('div', '', '<span></span>', stage); subs.id = 'subs';
  const subSpan = subs.firstChild;
  const bar = h('div', '', '', stage); bar.id = 'bar';
  const QUIET = new Set(['s3', 's12']);

  const FADE = 0.5;
  window.render = function (t) {
    let cur = scenes[0];
    scenes.forEach((sc, i) => {
      const lt = t - sc.start, end = sc.dur, last = i === scenes.length - 1;
      const vis = lt > -0.01 && lt < end;
      sc.root.style.display = vis ? 'block' : 'none';
      if (!vis) return;
      cur = sc;
      // 先淡出上一场，再淡入下一场，中间露一下纸面
      const o = P(lt, 0, FADE, E.inout) * (1 - P(lt, end - (last ? 1.4 : FADE), end, E.inout));
      sc.root.style.opacity = o;
      sc.def.frame(C(lt, 0, end));
    });

    const [num, name] = cur.def.chapter, key = num + name, lt = t - cur.start;
    if (chapter._k !== key) { chapter._k = key; chapter.innerHTML = num ? `<b>${num}</b>${name}` : ''; }
    chapter.style.opacity = P(lt, 0.3, 0.9) * (1 - P(lt, cur.dur - FADE, cur.dur));
    // 品牌角标：片头与片尾隐藏，相邻场景随转场淡入淡出
    const idx = scenes.indexOf(cur), prev = scenes[idx - 1], next = scenes[idx + 1];
    let bo = QUIET.has(cur.id) ? 0 : 1;
    if (bo && prev && QUIET.has(prev.id)) bo *= P(lt, 0, FADE);
    if (bo && next && QUIET.has(next.id)) bo *= 1 - P(lt, cur.dur - FADE, cur.dur);
    brand.style.opacity = bo * P(t, 0.5, 1.5);

    let sub = null;
    for (const sc of scenes) for (const x of sc.subs) if (t >= x.start && t < x.end + 0.2) sub = x;
    const txt = sub ? sub.text : '';
    if (subSpan._t !== txt) { subSpan._t = txt; subSpan.textContent = txt; }
    subs.style.opacity = sub ? P(t, sub.start, sub.start + 0.2) * (1 - P(t, sub.end, sub.end + 0.2)) : 0;
    subSpan.style.display = txt ? 'inline-block' : 'none';

    bar.style.width = (C(t / TL.total) * 1920) + 'px';
    bar.style.opacity = 0.8 * (1 - P(t, TL.total - 1.4, TL.total));
  };
  window.READY = true;
})();
