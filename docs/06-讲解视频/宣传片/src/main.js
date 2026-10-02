// S9–S11：竞品坐标、团队版、海报收尾；以及渲染入口
// S9 62.5–68.75：同类产品坐标（位置为团队基于竞品分析的推断）
scene('09 · 同类产品在哪', 62.5, 68.75, t => {
  bg(C.ink);
  rise('同类产品', 120, 220, prog(t, 0, .5), { size: 80, font: 'serif', weight: 900, color: C.paper });
  rise('在哪里？', 120, 320, prog(t, .15, .5), { size: 80, font: 'serif', weight: 900, color: C.limeHi });
  txt('位置为团队依据竞品分析的推断示意，', 124, 400, { size: 22, color: C.muted, alpha: prog(t, .6, .4) });
  txt('不是评测结论。来源见竞品分析文档。', 124, 436, { size: 22, color: C.muted, alpha: prog(t, .6, .4) });
  const O = { x: 760, y: 140, w: 1040, h: 800 }, ak = eio(prog(t, .2, .8));
  line(O.x, O.y + O.h, O.x + O.w * ak, O.y + O.h, { color: C.paper, lw: 3 });
  line(O.x, O.y + O.h, O.x, O.y + O.h - O.h * ak, { color: C.paper, lw: 3 });
  line(O.x + O.w / 2, O.y, O.x + O.w / 2, O.y + O.h, { color: '#3a4641', dash: [6, 10], alpha: ak });
  line(O.x, O.y + O.h / 2, O.x + O.w, O.y + O.h / 2, { color: '#3a4641', dash: [6, 10], alpha: ak });
  txt('通用解读 → 从你的角度读', O.x + O.w, O.y + O.h + 44, { size: 22, color: '#a9b2ad', align: 'right', alpha: ak });
  g.save(); g.translate(O.x - 30, O.y); g.rotate(-Math.PI / 2); txt('停在回答 → 推进到行动', 0, 0, { size: 22, color: '#a9b2ad', align: 'right', alpha: ak }); g.restore();
  const P = [['NotebookLM', '回答附原文引用', .34, .2], ['Mem · Heads Up', '主动浮现相关笔记', .6, .3], ['WPS 灵犀', '读文档、起草', .22, .5], ['ChatGPT 定时任务', '提醒、监控', .28, .68], ['M365 Planner', '文档拆任务', .2, .84], ['飞书 / 钉钉', '分派、催交、汇总', .1, .92]];
  P.forEach(([n, d, px, py], i) => {
    const k = eback(prog(t, 1.0 + i * .22, .4)); if (k <= 0) return;
    const x = O.x + px * O.w, y = O.y + O.h - py * O.h;
    g.beginPath(); g.arc(x, y, 12 * k, 0, Math.PI * 2); g.fillStyle = '#a9b2ad'; g.fill();
    txt(n, x + 24, y - 2, { size: 25, weight: 700, color: C.paper, alpha: clamp(k) });
    txt(d, x + 24, y + 28, { size: 19, color: C.muted, alpha: clamp(k) });
  });
  const mk = eback(prog(t, 2.8, .5));
  if (mk > 0) {
    const x = O.x + .82 * O.w, y = O.y + O.h - .86 * O.h;
    for (let r = 0; r < 3; r++) { const pr = ((t * .8 + r / 3) % 1); g.beginPath(); g.arc(x, y, 20 + pr * 90, 0, Math.PI * 2); g.strokeStyle = C.limeHi; g.globalAlpha = (1 - pr) * .6 * clamp(mk); g.lineWidth = 2; g.stroke(); }
    g.globalAlpha = 1;
    g.save(); g.translate(x, y); g.scale(mk, mk); logo(0, 0, 70); g.restore();
    txt('文启', x - 50, y + 4, { size: 44, font: 'serif', weight: 900, color: C.limeHi, align: 'right', base: 'middle', alpha: clamp(mk) });
    chip('目标位置 · 待赛中验证', x - 50 - tw('目标位置 · 待赛中验证', 18, 'sans', 600) - 25, y + 70, { size: 18, fill: 'transparent', stroke: C.limeHi, dash: [5, 5], color: C.limeHi, alpha: clamp(mk) });
  }
}, 'dark');

// S10 68.75–76.25：团队版，按人推荐分工
scene('10 · 团队版', 68.75, 76.25, t => {
  bg(C.lime);
  txt('TEAM · 临时组队', 120, 120, { size: 22, font: 'mono', weight: 700, color: C.green, ls: 4, alpha: prog(t, 0, .3) });
  rise('先了解人，再推荐事。', 120, 210, prog(t, .1, .5), { size: 72, font: 'serif', weight: 900, color: C.deep });
  rise('是队友，不是监工。', 1800, 210, prog(t, 4.6, .5), { size: 44, font: 'serif', weight: 900, color: C.orange, align: 'right' });
  const xs = [260, 610, 960, 1310, 1660];
  const blocks = ['产品原型', '模型接入', '路演 PPT', '用户访谈', '录屏封包'];
  const team = [['小王', '做过2个 React 项目', 0], ['小陈', '调过模型 API', 1], ['小周', '写过商业计划书', 2], ['小李', '想做教育方向', 3], ['小赵', '会剪视频', 4]];
  blocks.forEach((s, i) => {
    const k = ebounce(prog(t, .6 + i * .14, .7)); if (k <= 0) return;
    const gap = i === 3, y = lerp(-120, 380, k);
    box(xs[i] - 140, y - 50, 280, 100, { r: 16, fill: gap ? C.paper : C.deep, stroke: gap ? C.orange : null, dash: gap ? [8, 6] : null, lw: 3 });
    txt(s, xs[i], y + 10, { size: 32, weight: 800, color: gap ? C.orange : C.paper, align: 'center' });
  });
  chip('能力缺口：队内没人做过访谈', xs[3], 300, { align: 'center', size: 20, fill: C.orange, color: C.white, alpha: eback(prog(t, 3.6, .4)) });
  team.forEach(([n, skill, to], i) => {
    const k = eo(prog(t, 1.2 + i * .12, .5));
    person(xs[i], 820, 64, { color: C.deep, alpha: k });
    txt(n, xs[i], 920, { size: 28, weight: 800, color: C.deep, align: 'center', alpha: k });
    chip(skill, xs[i], 700, { align: 'center', size: 20, fill: C.white, alpha: eback(prog(t, 1.8 + i * .12, .4)) });
    const lk = prog(t, 2.6 + i * BEAT * .5, .6);
    curve(xs[i], 670, xs[to], 432, lk, { vertical: true, color: i === 3 ? C.orange : C.deep, lw: 3, dash: i === 3 ? [8, 8] : [] });
    if (lk >= 1) txt(i === 3 ? '建议先看访谈提纲' : '推荐 · 依据可回溯', xs[i], 980, { size: 19, weight: 600, color: i === 3 ? C.orange : C.green, align: 'center', alpha: prog(t, 3.3 + i * .1, .3) });
  });
  txt('能力名片由成员授权生成，可隐藏、可拒绝推荐；不催交、不盯进度', 960, 1040, { size: 22, color: C.green, align: 'center', alpha: prog(t, 5.4, .5) });
});

// S11 76.25–84：海报收尾
scene('11 · 文启', 76.25, 84, t => {
  bg(C.deep);
  g.save(); g.globalAlpha = .07; font(1100, 'serif', 900); g.fillStyle = C.lime; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('启', 1500 - t * 12, 560); g.restore();
  logo(200, 230, 120, prog(t, 0, .8));
  rise('丢一份文件，', 140, 480, prog(t, .4, .6), { size: 92, font: 'serif', weight: 900, color: C.paper });
  rise('它站在你的角度', 140, 600, prog(t, .6, .6), { size: 92, font: 'serif', weight: 900, color: C.paper });
  rise('读给你听。', 140, 720, prog(t, .8, .6), { size: 92, font: 'serif', weight: 900, color: C.limeHi });
  line(144, 790, 144 + 700 * eio(prog(t, 1.4, .8)), 790, { color: C.lime, lw: 3 });
  txt('Document  →  可行动事务  →  Workflow', 144, 850, { size: 28, font: 'mono', weight: 700, color: C.lime, alpha: prog(t, 1.8, .5) });
  ['文', '启'].forEach((s, i) => rise(s, 1560, 400 + i * 300, prog(t, .5 + i * .2, .7), { size: 280, font: 'serif', weight: 900, color: C.paper, align: 'center' }));
  txt('F I L E A C T I O N', 1560, 800, { size: 28, font: 'mono', weight: 600, color: C.lime, align: 'center', ls: 4, alpha: prog(t, 1.4, .5) });
  txt('XiHack 2026 · 可行动事务 Agent', 144, 990, { size: 22, color: '#a9c2b6', alpha: prog(t, 2.2, .5) });
  txt('概念宣传片 · 画面、人物与通知均为合成示意，非产品实录', 1800, 990, { size: 20, color: '#7f9b8e', align: 'right', alpha: prog(t, 2.2, .5) });
  g.fillStyle = '#000'; g.globalAlpha = prog(t, 6.6, 1.1); g.fillRect(0, 0, W, H); g.globalAlpha = 1;
}, 'dark');

// 角标：品牌、示意声明、场景号与进度条
function chrome(t, s) {
  if (s.tag.startsWith('11')) return;
  const dark = s.theme === 'dark', c = dark ? 'rgba(244,241,232,.55)' : 'rgba(22,32,28,.5)';
  txt('文启 · FILEACTION', 60, 58, { size: 16, font: 'mono', weight: 700, color: c, ls: 3 });
  txt('概念示意 · 合成数据', W - 60, 58, { size: 16, color: c, align: 'right', ls: 2 });
  txt(s.tag, 60, H - 40, { size: 16, font: 'mono', color: c, ls: 2 });
  line(W - 360, H - 46, W - 60, H - 46, { color: c, lw: 2, alpha: .35 });
  line(W - 360, H - 46, W - 360 + 300 * (t / TOTAL), H - 46, { color: dark ? C.limeHi : C.orange, lw: 3 });
}
// 转场：五条色带在切点处合拢再拉开
function shutter(t) {
  const cuts = SCENES.slice(1).map(s => s.a);
  for (const c of cuts) {
    if (Math.abs(t - c) > 0.5) continue;
    const cols = [C.deep, C.lime, C.orange, C.ink, C.limeHi];
    cols.forEach((col, i) => {
      // 合拢在切点前全部完成，拉开时错位
      const d = 0.05 * i, kin = eio(prog(t, c - 0.42 + d, 0.3)), kout = eio(prog(t, c + d, 0.34));
      const x0 = W * kout, x1 = W * kin;
      if (x1 - x0 <= 0) return;
      g.fillStyle = col; g.fillRect(x0, (H / 5) * i, x1 - x0, H / 5 + 1);
    });
  }
}
window.render = t => {
  t = clamp(t, 0, TOTAL - 1e-3);
  const s = SCENES.find(x => t >= x.a && t < x.b) || SCENES[SCENES.length - 1];
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
  s.draw(t - s.a); chrome(t, s); shutter(t);
  g.globalCompositeOperation = 'overlay'; g.drawImage(grain, 0, 0, W, H); g.globalCompositeOperation = 'source-over';
};
window.frame = (t, q = 0.92) => { window.render(t); return cv.toDataURL('image/jpeg', q); };
window.META = { W, H, FPS, TOTAL };
document.fonts.load('900 40px "Songti SC"').then(() => document.fonts.load('600 40px "PingFang SC"')).then(() => {
  window.READY = true;
  const q = new URLSearchParams(location.search);
  if (q.has('capture')) return;
  if (q.has('t')) return window.render(Number(q.get('t')));
  const audio = document.getElementById('a'), t0 = performance.now();
  if (audio) audio.play().catch(() => {});
  const loop = () => { const t = audio && !audio.paused ? audio.currentTime : (performance.now() - t0) / 1000 % TOTAL; window.render(t); requestAnimationFrame(loop); };
  loop();
});
