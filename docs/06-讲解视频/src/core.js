// 公共工具：缓动、DOM 构建、纸页、朱批、连线与图标。所有动画只由时间 t 决定，保证逐帧渲染可复现。
(function () {
  const C = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const E = {
    lin: t => t,
    out: t => 1 - Math.pow(1 - t, 3),
    inout: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  };
  const P = (t, a, b, e = E.out) => e(C((t - a) / (b - a)));
  const L = (a, b, p) => a + (b - a) * p;
  const rng = seed => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

  function h(tag, cls, html, parent, style) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    if (style) Object.assign(el.style, style);
    if (parent) parent.appendChild(el);
    return el;
  }
  // 以左上角 (x, y) 定位
  function at(el, x, y) { el.style.left = x + 'px'; el.style.top = y + 'px'; return el; }
  function tf(el, { x = 0, y = 0, s = 1, r = 0, o = 1 } = {}) {
    el.style.transform = `translate(${x}px,${y}px) scale(${s}) rotate(${r}deg)`;
    el.style.opacity = C(o);
  }
  // 入场：短距离上移淡入，不弹跳
  function rise(el, t, a, dur = 0.7, dy = 18) {
    const p = P(t, a, a + dur);
    tf(el, { y: L(dy, 0, p), o: p });
    return p;
  }
  function typed(el, text, p) {
    const n = Math.round(text.length * C(p));
    if (el._n !== n) { el.textContent = text.slice(0, n); el._n = n; }
    el.classList.toggle('caret', p > 0 && p < 1);
  }
  // 手写揭示：从左到右展开
  function write(el, p) {
    el.style.clipPath = `inset(-20% ${100 - C(p) * 100}% -20% -2%)`;
    el.style.opacity = p > 0 ? 1 : 0;
  }
  function stroke(el, p) { el.style.transform = `scaleX(${C(p)})`; el.style.opacity = p > 0 ? 1 : 0; }

  // 纸页：title、meta、lines（字符串为文字行，数字为占位灰条宽度百分比）
  function sheet(parent, { title, meta, lines = [], width = 640 }) {
    const el = h('div', 'sheet', '', parent, { width: width + 'px' });
    h('div', 'st', title, el);
    if (meta) h('div', 'sm', meta, el);
    h('div', 'sr', '', el);
    el.lines = lines.map(x => typeof x === 'number'
      ? h('div', 'bar', '', el, { width: x + '%' })
      : h('div', 'ln', x, el));
    return el;
  }

  const NS = 'http://www.w3.org/2000/svg';
  function svgLayer(parent) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('class', 'layer'); s.setAttribute('viewBox', '0 0 1920 1080');
    parent.appendChild(s); return s;
  }
  function line(svg, d, { color = '#1E1C19', w = 1.6, dash = '' } = {}) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', w); p.setAttribute('stroke-linecap', 'round');
    svg.appendChild(p);
    const len = p.getTotalLength();
    p.style.strokeDasharray = dash || len;
    return {
      p,
      draw(pr, o = 1) {
        if (dash) { p.style.opacity = C(pr) * o; return; }
        p.style.strokeDashoffset = len * (1 - C(pr)); p.style.opacity = pr > 0 ? o : 0;
      },
    };
  }
  const hcurve = (x1, y1, x2, y2) => `M${x1} ${y1} C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`;

  // 图标：一页纸，右侧页边一道朱批
  function logo(p = 1) {
    const q = C(p);
    return `<svg viewBox="0 0 64 64" aria-hidden="true">
      <rect x="9" y="7" width="33" height="50" rx="2.5" fill="#FFFDF8" stroke="#1E1C19" stroke-width="3"/>
      <path d="M16 19H35M16 27H35M16 35H29M16 43H33" stroke="#1E1C19" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M50 13C53 22 47.5 33 51.5 51" fill="none" stroke="#C2412B" stroke-width="4.6" stroke-linecap="round"
        pathLength="1" stroke-dasharray="1" stroke-dashoffset="${1 - q}"/>
    </svg>`;
  }
  const CURSOR = '<svg viewBox="0 0 24 24"><path d="M4 2l16 9-7 1.8L9.4 20z" fill="#1E1C19" stroke="#FFFDF8" stroke-width="1.4" stroke-linejoin="round"/></svg>';

  window.K = { C, E, P, L, rng, h, at, tf, rise, typed, write, stroke, sheet, svgLayer, line, hcurve, logo, CURSOR, S: {} };
})();
