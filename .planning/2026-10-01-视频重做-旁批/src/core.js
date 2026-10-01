// 公共工具：缓动、DOM 构建、SVG 连线、背景。所有动画只由时间 t 决定，保证逐帧渲染可复现。
(function () {
  const C = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const E = {
    lin: t => t,
    out: t => 1 - Math.pow(1 - t, 3),
    inout: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    back: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
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
  // 以 (x, y) 为元素定位点；center 为真时以元素中心定位
  function place(el, x, y, center = true) { el.style.position = 'absolute'; el.style.left = x + 'px'; el.style.top = y + 'px'; el._c = center; return el; }
  function tf(el, { x = 0, y = 0, s = 1, r = 0, o = 1, blur = 0 } = {}) {
    el.style.transform = (el._c ? 'translate(-50%,-50%) ' : '') + `translate(${x}px,${y}px) scale(${s}) rotate(${r}deg)`;
    el.style.opacity = C(o);
    el.style.filter = blur > 0.05 ? `blur(${blur}px)` : 'none';
  }
  // 常用入场：从下方淡入，可选弹性缩放
  function pop(el, t, a, dur = 0.6, { dy = 30, s0 = 0.85, back = true, x = 0 } = {}) {
    const p = P(t, a, a + dur, back ? E.back : E.out), q = P(t, a, a + dur * 0.6);
    tf(el, { x, y: L(dy, 0, q), s: L(s0, 1, p), o: q });
    return p;
  }
  function typed(el, text, p) {
    const n = Math.round(text.length * C(p));
    if (el._n !== n) { el.textContent = text.slice(0, n); el._n = n; }
    el.classList.toggle('caret', p > 0 && p < 1);
  }

  let logoN = 0;
  function logo() {
    const id = 'lg' + logoN++;
    return `<svg viewBox="0 0 64 64"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#38E1FF"/><stop offset=".55" stop-color="#8B5CF6"/><stop offset="1" stop-color="#F472B6"/></linearGradient></defs><rect x="4" y="4" width="56" height="56" rx="16" fill="url(#${id})"/><path d="M22 15h13l9 9v24a3 3 0 0 1-3 3H22a3 3 0 0 1-3-3V18a3 3 0 0 1 3-3z" fill="#fff"/><path d="M35 15v9h9" fill="#E3DAFF"/><circle cx="31.5" cy="37" r="6.5" fill="none" stroke="#7C4DFF" stroke-width="3"/><circle cx="31.5" cy="37" r="2.4" fill="#7C4DFF"/></svg>`;
  }
  const ICON = {
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>',
    cursor: '<svg viewBox="0 0 24 24"><path d="M4 2l16 9-7 1.8L9.4 20z" fill="#fff" stroke="#0B1020" stroke-width="1.3" stroke-linejoin="round"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.2 6.3L20.5 10l-6.3 2.2L12 18.5l-2.2-6.3L3.5 10l6.3-1.7z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  };
  const TYPE = { pdf: 't-pdf', doc: 't-doc', img: 't-img', xls: 't-xls', msg: 't-msg' };
  function fileCard(parent, [type, label, name, meta], extra = '') {
    return h('div', 'card fcard ' + extra, `<div class="fic ${TYPE[type]}">${label}</div><div><div class="fname">${name}</div>${meta ? `<div class="fmeta">${meta}</div>` : ''}</div>`, parent);
  }
  function avatar(parent, grad, size = 120) {
    return h('div', 'avatar', ICON.user, parent, { width: size + 'px', height: size + 'px', background: grad, position: 'absolute' });
  }

  const NS = 'http://www.w3.org/2000/svg';
  function svgLayer(parent) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('class', 'layer'); s.setAttribute('viewBox', '0 0 1920 1080');
    parent.appendChild(s); return s;
  }
  // 可逐步绘制的连线；dashed 线以透明度出现
  function line(svg, d, { color = '#38E1FF', w = 3, glow = true, dashed = false } = {}) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', w); p.setAttribute('stroke-linecap', 'round');
    if (glow) p.style.filter = `drop-shadow(0 0 6px ${color})`;
    svg.appendChild(p);
    const len = p.getTotalLength();
    p.style.strokeDasharray = dashed ? '12 12' : len;
    return {
      p, len,
      draw(pr, o = 1) {
        if (dashed) { p.style.opacity = C(pr) * o; return; }
        p.style.strokeDashoffset = len * (1 - C(pr)); p.style.opacity = pr > 0 ? o : 0;
      },
      at(pr) { return p.getPointAtLength(len * C(pr)); },
    };
  }
  function dot(svg, color = '#fff', r = 6) {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('r', r); c.setAttribute('fill', color);
    c.style.filter = `drop-shadow(0 0 8px ${color})`; svg.appendChild(c); return c;
  }
  function along(ln, el, pr, o = 1) { const q = ln.at(pr); el.setAttribute('cx', q.x); el.setAttribute('cy', q.y); el.style.opacity = o; }
  const vcurve = (x1, y1, x2, y2) => `M${x1} ${y1} C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`;
  const hcurve = (x1, y1, x2, y2) => `M${x1} ${y1} C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`;

  window.K = { C, E, P, L, rng, h, place, tf, pop, typed, logo, ICON, fileCard, avatar, svgLayer, line, dot, along, vcurve, hcurve, S: {} };
})();
