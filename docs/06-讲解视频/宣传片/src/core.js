// 宣传片公共层：画布、配色、缓动与绘图积木。所有画面只由时间 t 决定，可逐帧复现。
const W = 1920, H = 1080, FPS = 30, TOTAL = 84;
const BEAT = 60 / 96; // 96 BPM，转场与重击都落在拍点上
const C = {
  paper: '#f4f1e8', ink: '#16201c', deep: '#163f32', green: '#285846',
  sage: '#739267', lime: '#dceac4', limeHi: '#c9e08f', orange: '#d0622b',
  amber: '#b98a2e', muted: '#7b847f', line: '#d9dccf', white: '#ffffff'
};
const F = {
  sans: '"PingFang SC", "Hiragino Sans GB", sans-serif',
  serif: '"Songti SC", "STSong", serif',
  mono: 'Menlo, "SF Mono", monospace'
};
const cv = document.getElementById('c');
const g = cv.getContext('2d');
// 回弹缓动在起点可能给出 -1e-15 这样的浮点负数，统一把半径钳到 0
const _arc = g.arc.bind(g);
g.arc = (x, y, r, a0, a1, ccw) => _arc(x, y, Math.max(0, r), a0, a1, ccw);

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, k) => a + (b - a) * k;
const prog = (t, a, d) => clamp((t - a) / d); // 从 a 开始、持续 d 秒的 0..1 进度
const eo = k => 1 - Math.pow(1 - k, 3);
const eio = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const eback = k => { const c1 = 1.7, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); };
const ebounce = k => {
  const n = 7.5625, d = 2.75;
  if (k < 1 / d) return n * k * k;
  if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75;
  if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375;
  return n * (k -= 2.625 / d) * k + 0.984375;
};

function font(size, fam = 'sans', weight = 500) { g.font = `${weight} ${size}px ${F[fam]}`; }
function txt(s, x, y, o = {}) {
  font(o.size || 28, o.font || 'sans', o.weight || 500);
  g.fillStyle = o.color || C.ink;
  g.textAlign = o.align || 'left';
  g.textBaseline = o.base || 'alphabetic';
  g.letterSpacing = (o.ls || 0) + 'px';
  g.globalAlpha = o.alpha ?? 1;
  g.fillText(s, x, y);
  g.globalAlpha = 1; g.letterSpacing = '0px';
}
function tw(s, size, fam = 'sans', weight = 500) { font(size, fam, weight); return g.measureText(s).width; }
// 打字效果：按进度截取字符
const typed = (s, k) => s.slice(0, Math.round([...s].length * clamp(k))) ;
// 遮罩上升：文字从基线下方升起
function rise(s, x, y, k, o = {}) {
  const size = o.size || 28;
  g.save();
  g.beginPath(); g.rect(x - (o.align === 'right' ? 3000 : o.align === 'center' ? 1500 : 0) - 10, y - size * 1.1, 3000, size * 1.45); g.clip();
  txt(s, x, y + (1 - eo(k)) * size * 1.3, o);
  g.restore();
}
function rr(x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
function box(x, y, w, h, o = {}) {
  if (o.shadow) { g.save(); g.shadowColor = 'rgba(20,40,30,.16)'; g.shadowBlur = o.shadow; g.shadowOffsetY = o.shadow / 3; }
  rr(x, y, w, h, o.r ?? 18); g.fillStyle = o.fill || C.white; g.globalAlpha = o.alpha ?? 1; g.fill();
  if (o.shadow) g.restore();
  if (o.stroke) { g.lineWidth = o.lw || 2; g.strokeStyle = o.stroke; g.setLineDash(o.dash || []); rr(x, y, w, h, o.r ?? 18); g.stroke(); g.setLineDash([]); }
  g.globalAlpha = 1;
}
function line(x1, y1, x2, y2, o = {}) {
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2);
  g.strokeStyle = o.color || C.ink; g.lineWidth = o.lw || 2; g.lineCap = 'round';
  g.setLineDash(o.dash || []); g.globalAlpha = o.alpha ?? 1; g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
}
// 按进度 k 画出三次贝塞尔曲线的一部分
function curve(x1, y1, x2, y2, k, o = {}) {
  if (k <= 0) return;
  const mx = o.vertical ? 0 : (x2 - x1) * 0.5, my = o.vertical ? (y2 - y1) * 0.5 : 0;
  const pts = [];
  for (let i = 0; i <= 40 * k; i++) {
    const u = i / 40, v = 1 - u;
    const cx1 = x1 + mx, cy1 = y1 + my, cx2 = x2 - mx, cy2 = y2 - my;
    pts.push([v * v * v * x1 + 3 * v * v * u * cx1 + 3 * v * u * u * cx2 + u * u * u * x2,
      v * v * v * y1 + 3 * v * v * u * cy1 + 3 * v * u * u * cy2 + u * u * u * y2]);
  }
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.strokeStyle = o.color || C.green; g.lineWidth = o.lw || 2.5; g.lineCap = 'round';
  g.setLineDash(o.dash || []); g.globalAlpha = o.alpha ?? 1; g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
}
// 文件图标：折角纸张 + 标签
function doc(x, y, w, h, o = {}) {
  const f = Math.min(w, h) * 0.22;
  g.save(); g.translate(x, y); g.rotate(o.rot || 0); g.globalAlpha = o.alpha ?? 1;
  if (o.shadow !== false) { g.shadowColor = 'rgba(20,40,30,.18)'; g.shadowBlur = 18; g.shadowOffsetY = 8; }
  g.beginPath(); g.moveTo(-w / 2, -h / 2); g.lineTo(w / 2 - f, -h / 2); g.lineTo(w / 2, -h / 2 + f); g.lineTo(w / 2, h / 2); g.lineTo(-w / 2, h / 2); g.closePath();
  g.fillStyle = o.fill || C.white; g.fill(); g.shadowColor = 'transparent';
  g.beginPath(); g.moveTo(w / 2 - f, -h / 2); g.lineTo(w / 2 - f, -h / 2 + f); g.lineTo(w / 2, -h / 2 + f); g.fillStyle = 'rgba(0,0,0,.08)'; g.fill();
  g.fillStyle = o.accent || C.green; g.fillRect(-w / 2 + w * 0.12, -h / 2 + h * 0.14, w * 0.42, h * 0.06);
  g.fillStyle = 'rgba(22,32,28,.14)';
  for (let i = 0; i < 4; i++) g.fillRect(-w / 2 + w * 0.12, -h / 2 + h * (0.32 + i * 0.13), w * (i === 3 ? 0.45 : 0.74), h * 0.035);
  if (o.label) { font(o.ls || 20, 'sans', 600); g.fillStyle = o.labelColor || C.ink; g.textAlign = 'center'; g.fillText(o.label, 0, h / 2 - h * 0.1); }
  g.restore();
}
// 人物剪影
function person(x, y, s, o = {}) {
  g.save(); g.globalAlpha = o.alpha ?? 1; g.fillStyle = o.color || C.ink;
  g.beginPath(); g.arc(x, y - s * 0.55, s * 0.32, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(x, y + s * 0.45, s * 0.62, s * 0.5, 0, Math.PI, 0); g.fill();
  g.restore();
}
// 状态符号：ok ✓ / warn △ / no ✗ / gap □
const MARK = { ok: C.green, warn: C.amber, no: C.orange, gap: C.muted };
function mark(kind, x, y, s, k = 1) {
  if (k <= 0) return;
  const sc = eback(clamp(k)); g.save(); g.translate(x, y); g.scale(sc, sc);
  g.strokeStyle = MARK[kind]; g.fillStyle = MARK[kind]; g.lineWidth = s * 0.16; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath();
  if (kind === 'ok') { g.moveTo(-s * .38, 0); g.lineTo(-s * .1, s * .3); g.lineTo(s * .42, -s * .34); }
  if (kind === 'warn') { g.moveTo(0, -s * .42); g.lineTo(s * .44, s * .36); g.lineTo(-s * .44, s * .36); g.closePath(); }
  if (kind === 'no') { g.moveTo(-s * .34, -s * .34); g.lineTo(s * .34, s * .34); g.moveTo(s * .34, -s * .34); g.lineTo(-s * .34, s * .34); }
  if (kind === 'gap') { g.lineWidth = s * .1; g.rect(-s * .34, -s * .34, s * .68, s * .68); }
  g.stroke(); g.restore();
}
// 印章：从大到小砸下
function stamp(s, x, y, k, o = {}) {
  if (k <= 0) return;
  const sc = lerp(2.4, 1, eo(clamp(k / 0.45))), a = clamp(k / 0.2);
  const size = o.size || 44, pad = size * 0.5, w = tw(s, size, 'sans', 800) + pad * 2, h = size * 1.6;
  g.save(); g.translate(x, y); g.rotate(o.rot ?? -0.12); g.scale(sc, sc); g.globalAlpha = a;
  g.lineWidth = 5; g.strokeStyle = o.color || C.orange; rr(-w / 2, -h / 2, w, h, 10); g.stroke();
  g.lineWidth = 2; rr(-w / 2 + 7, -h / 2 + 7, w - 14, h - 14, 6); g.stroke();
  txt(s, 0, 2, { size, weight: 800, color: o.color || C.orange, align: 'center', base: 'middle', ls: 4, alpha: a });
  g.restore();
}
// 胶囊标签
function chip(s, x, y, o = {}) {
  const size = o.size || 22, w = tw(s, size, o.font || 'sans', o.weight || 600) + size * 1.4, h = size * 1.9;
  const x0 = o.align === 'center' ? x - w / 2 : x;
  box(x0, y - h / 2, w, h, { r: h / 2, fill: o.fill || C.lime, stroke: o.stroke, dash: o.dash, alpha: o.alpha, lw: o.lw });
  txt(s, x0 + w / 2, y + 1, { size, weight: o.weight || 600, font: o.font || 'sans', color: o.color || C.deep, align: 'center', base: 'middle', alpha: o.alpha });
  return w;
}
// 品牌标：三块积木（取自文启 Demo 图标）
function logo(x, y, s, k = 1) {
  const parts = [['M5 7h15v7H12v16H5z', C.green, -260, -80], ['M15 2h15v7H22v16h-7z', C.sage, 260, -60], ['M15 25h7v8h-7z', C.limeHi, 0, 240]];
  parts.forEach(([d, col, dx, dy], i) => {
    const kk = eback(clamp((k - i * 0.12) / 0.6));
    if (kk <= 0) return;
    g.save(); g.translate(x + dx * (1 - kk), y + dy * (1 - kk)); g.scale(s / 36, s / 36); g.translate(-18, -19);
    g.globalAlpha = clamp(kk * 2); g.fillStyle = col; g.fill(new Path2D(d)); g.restore();
  });
}
// 胶片颗粒：一次生成，逐帧叠加
const grain = document.createElement('canvas'); grain.width = 480; grain.height = 270;
(() => {
  const gx = grain.getContext('2d'), img = gx.createImageData(480, 270); let s = 7;
  for (let i = 0; i < img.data.length; i += 4) { s = (s * 16807) % 2147483647; const v = s % 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 22; }
  gx.putImageData(img, 0, 0);
})();
function bg(col) { g.fillStyle = col; g.fillRect(0, 0, W, H); }
function dots(x0, y0, cols, rows, gap, col, alpha = .18) {
  g.fillStyle = col; g.globalAlpha = alpha;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { g.beginPath(); g.arc(x0 + i * gap, y0 + j * gap, 2.2, 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 1;
}
const SCENES = [];
function scene(tag, a, b, draw, theme = 'light') { SCENES.push({ tag, a, b, draw, theme }); }
