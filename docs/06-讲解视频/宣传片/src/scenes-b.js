// S5–S8：同一份文件不同人、主动发现与可信复用、直接动手、按需索取
// S5 30–36.25：文件 × 你 = 回应
scene('05 · 文件 × 你', 30, 36.25, t => {
  const sk = eio(prog(t, 0, 0.6));
  bg(C.paper);
  g.fillStyle = C.lime; g.fillRect(0, 0, 960 * sk, H);
  g.fillStyle = C.deep; g.fillRect(W - 960 * sk, 0, 960 * sk, H);
  const dk = ebounce(prog(t, 0.4, 0.8));
  doc(960, lerp(-200, 330, dk), 170, 220, { label: '公司规章', ls: 22, accent: C.orange });
  chip('同一份文件', 960, 150, { align: 'center', size: 24, fill: C.paper, color: C.ink, alpha: prog(t, 1, .4) });
  person(300, 420, 80, { color: C.deep, alpha: eo(prog(t, 1.2, .4)) });
  txt('求职的学生', 300, 530, { size: 26, weight: 700, color: C.deep, align: 'center', alpha: prog(t, 1.3, .4) });
  rise('这家公司', 130, 700, prog(t, 1.5, .5), { size: 92, font: 'serif', weight: 900, color: C.deep });
  rise('靠不靠谱？', 130, 810, prog(t, 1.7, .5), { size: 92, font: 'serif', weight: 900, color: C.deep });
  person(1620, 420, 80, { color: C.lime, alpha: eo(prog(t, 1.9, .4)) });
  txt('刚入职的员工', 1620, 530, { size: 26, weight: 700, color: C.lime, align: 'center', alpha: prog(t, 2, .4) });
  rise('试用期', 1790, 700, prog(t, 2.2, .5), { size: 92, font: 'serif', weight: 900, color: C.lime, align: 'right' });
  rise('要注意什么？', 1790, 810, prog(t, 2.4, .5), { size: 92, font: 'serif', weight: 900, color: C.lime, align: 'right' });
  const fk = eback(prog(t, 3.4, .5));
  if (fk > 0) {
    g.save(); g.translate(960, 950); g.scale(fk, fk);
    box(-400, -50, 800, 100, { r: 50, fill: C.ink });
    txt('文件  ×  你  =  你的回应', 0, 3, { size: 40, font: 'serif', weight: 900, color: C.paper, align: 'center', base: 'middle', ls: 4 });
    g.restore();
  }
  txt('不预设文件分类 · 跟你关系不大的，一句话说明，不硬凑待办', 960, 1040, { size: 22, color: C.muted, align: 'center', alpha: prog(t, 4.2, .5) });
});

// S6 36.25–48.75：主动发现 + 可信复用
const S6 = {
  nodes: [['你', 400, 520, 'me'], ['「校园交友平台」Idea', 220, 330], ['想做 To B 教育创业', 560, 300, 'intent'], ['项目介绍 v2 · 6月', 210, 720], ['往届获奖证明', 580, 760, 'no'], ['成员名单 · 去年', 430, 900]],
  rows: [['ok', '项目 Idea', '与“社会服务”赛道相关', 1], ['ok', '项目介绍 v2', '来源可定位，版本有效', 3], ['warn', '成员名单', '需按本届重新签字', 5], ['no', '往届获奖证明', '原文第5条：不得重复申报', 4], ['gap', '还缺', '商业计划书 · 项目 PPT · 指导老师', -1]]
};
scene('06 · 主动发现 · 可信复用', 36.25, 48.75, t => {
  bg(C.paper); dots(1000, 120, 26, 3, 34, C.green, .12);
  const fade = 1 - eo(prog(t, 8.2, .6));
  // 左：记忆关联图
  S6.nodes.forEach(([s, x, y, kind], i) => {
    const nk = eback(prog(t, 0.2 + i * 0.18, .5));
    if (i) curve(400, 520, x, y, prog(t, 0.3 + i * 0.18, .5), { color: C.line, lw: 2.5, alpha: fade });
    if (nk <= 0) return;
    g.save(); g.globalAlpha = fade; g.translate(x, y); g.scale(nk, nk);
    if (kind === 'me') { g.beginPath(); g.arc(0, 0, 54, 0, Math.PI * 2); g.fillStyle = C.deep; g.fill(); txt('你', 0, 3, { size: 40, font: 'serif', weight: 900, color: C.paper, align: 'center', base: 'middle', alpha: fade }); }
    else chip(s, 0, 0, { align: 'center', size: 22, fill: kind === 'intent' ? C.white : kind === 'no' ? '#f6dccd' : C.lime, stroke: kind === 'intent' ? C.sage : null, dash: kind === 'intent' ? [6, 6] : null, alpha: fade });
    g.restore();
  });
  // 右：发现卡
  const K = { x: 860, y: 170, w: 940, h: 760 };
  const ck = eo(prog(t, 0.9, .6));
  g.save(); g.translate(0, (1 - ck) * 60); g.globalAlpha = ck;
  box(K.x, K.y, K.w, K.h, { r: 28, shadow: 50 });
  txt('发现一项可能与你有关的活动', K.x + 50, K.y + 70, { size: 22, color: C.orange, weight: 700, ls: 2 });
  txt('大学生创新创业大赛', K.x + 50, K.y + 135, { size: 48, font: 'serif', weight: 900 });
  chip('截止 10月12日 · 原文第3条', K.x + K.w - 50 - tw('截止 10月12日 · 原文第3条', 20, 'sans', 600) - 28, K.y + 118, { size: 20, fill: C.ink, color: C.paper });
  line(K.x + 50, K.y + 180, K.x + K.w - 50, K.y + 180, { color: C.line });
  g.restore();
  S6.rows.forEach(([kind, a, b, src], i) => {
    const at = 2.0 + i * BEAT * 2, rk = prog(t, at, .4), y = K.y + 250 + i * 98;
    if (src >= 0) { const n = S6.nodes[src]; curve(n[1] + tw(n[0], 22, 'sans', 600) / 2 + 20, n[2], K.x - 4, y, prog(t, at - .35, .4), { color: MARK[kind], lw: 3, alpha: fade * .9 }); }
    if (rk <= 0) return;
    if (kind === 'no') { g.fillStyle = 'rgba(208,98,43,.08)'; rr(K.x + 24, y - 44, K.w - 48, 88, 14); g.fill(); }
    mark(kind, K.x + 80, y, 40, rk);
    rise(a, K.x + 130, y + 10, rk, { size: 30, weight: 800, color: kind === 'no' ? C.orange : C.ink });
    rise(b, K.x + 340, y + 10, rk, { size: 24, color: C.muted });
  });
  stamp('本次不能用', K.x + K.w - 170, K.y + 250 + 3 * 98 - 6, prog(t, 6.25 - .05, .6), { size: 34, rot: -0.14 });
  const bk = prog(t, 7.2, .4);
  ['起草项目简介', '导出待办与日历'].forEach((s, i) => chip(s, K.x + 50 + i * 230, K.y + K.h - 60, { size: 22, fill: i ? C.lime : C.deep, color: i ? C.deep : C.paper, alpha: bk }));
  // 点回原文
  const pk = eo(prog(t, 8.4, .6));
  if (pk > 0) {
    g.save(); g.globalAlpha = pk; g.translate(0, (1 - pk) * 40);
    box(110, 290, 640, 420, { r: 20, fill: C.ink, shadow: 40 });
    txt('点回原文 · 大赛通知', 150, 350, { size: 22, color: C.limeHi, font: 'mono', weight: 700 });
    ['三、截止：10月12日前提交', '四、材料：计划书、PPT、成员名单', '五、已获奖成果不得重复申报', '六、请各学院统一报送'].forEach((s, i) => {
      const y = 430 + i * 66;
      if (i === 2) { g.fillStyle = 'rgba(208,98,43,.35)'; g.fillRect(140, y - 34, 580, 50); }
      txt(s, 160, y, { size: 26, color: i === 2 ? C.white : '#9aa5a0', weight: i === 2 ? 800 : 500 });
    });
    g.restore();
    curve(750, 562, K.x + 24, K.y + 250 + 3 * 98, prog(t, 8.8, .5), { color: C.orange, lw: 3, dash: [8, 8] });
  }
  rise('主动发现，可信复用。', 110, 1000, prog(t, 0.4, .6), { size: 64, font: 'serif', weight: 900, color: C.ink });
  txt('每条匹配都能点回原文 · 模型初稿与你的确认分开 · 「本次不能用」不能被一键勾掉', 860, 990, { size: 22, color: C.muted, alpha: prog(t, 9.4, .5) });
});

// S7 48.75–55：直接动手
scene('07 · 直接动手', 48.75, 55, t => {
  bg(C.deep); dots(1200, 70, 18, 2, 34, C.lime, .12);
  rise('直接', 120, 300, prog(t, 0, .5), { size: 170, font: 'serif', weight: 900, color: C.paper });
  rise('动手。', 120, 480, prog(t, 0.2, .5), { size: 170, font: 'serif', weight: 900, color: C.limeHi });
  rise('只用你确认过的资料。不替你提交，不代签，不编经历。', 126, 570, prog(t, .6, .5), { size: 28, color: '#a9c2b6' });
  ['商业计划书', '项目 PPT', '指导老师信息'].forEach((s, i) => {
    const k = prog(t, 1.2 + i * BEAT, .4), done = t > 3.4 + i * 0.3;
    if (k <= 0) return;
    const x = 126 + i * 250, y = 680;
    g.save(); g.globalAlpha = k;
    box(x, y - 34, 228, 68, { r: 34, fill: done ? C.lime : 'transparent', stroke: done ? null : C.lime, dash: done ? null : [6, 6] });
    mark(done ? 'ok' : 'gap', x + 36, y, 30);
    txt(s, x + 64, y + 9, { size: 23, weight: 700, color: done ? C.deep : C.lime });
    g.restore();
  });
  [['准备清单.md', 0], ['截止日历.ics', 1]].forEach(([s, i]) => chip(s, 126 + i * 230, 800, { size: 22, font: 'mono', fill: C.orange, color: C.white, alpha: eback(prog(t, 4.2 + i * .2, .4)) }));
  txt('导出格式固定，带出处', 126, 880, { size: 22, color: '#a9c2b6', alpha: prog(t, 4.6, .4) });
  // 日历卡
  const ck = eo(prog(t, .8, .6));
  g.save(); g.globalAlpha = ck; g.translate((1 - ck) * 80, 0);
  box(1000, 130, 820, 380, { r: 24, fill: C.paper, shadow: 40 });
  txt('2026 · 10月', 1040, 190, { size: 30, font: 'serif', weight: 900 });
  '一二三四五六日'.split('').forEach((d, i) => txt(d, 1070 + i * 108, 240, { size: 20, color: C.muted, align: 'center' }));
  for (let d = 1; d <= 31; d++) {
    const idx = d + 2, cx = 1070 + (idx % 7) * 108, cy = 288 + Math.floor(idx / 7) * 46; // 10月1日为周四
    const hl = { 6: [C.green, '计划书初稿', 1.8], 9: [C.green, 'PPT', 2.2], 12: [C.orange, '截止', 2.6] }[d];
    if (hl) { const hk = eback(prog(t, hl[2], .4)); g.beginPath(); g.arc(cx, cy - 7, 20 * hk, 0, Math.PI * 2); g.fillStyle = hl[0]; g.fill(); }
    txt(String(d), cx, cy, { size: 20, weight: hl ? 800 : 500, color: hl && t > hl[2] ? C.white : C.ink, align: 'center' });
    if (hl && t > hl[2] + .2) txt(hl[1], cx, cy + 32, { size: 16, weight: 700, color: hl[0], align: 'center' });
  }
  g.restore();
  // 起草卡
  const dk = eo(prog(t, 1.4, .6));
  g.save(); g.globalAlpha = dk; g.translate((1 - dk) * 80, 0);
  box(1000, 550, 820, 400, { r: 24, fill: C.white, shadow: 40 });
  txt('项目简介', 1040, 612, { size: 30, font: 'serif', weight: 900 });
  chip('模型初稿 · 待你修改', 1580, 600, { size: 18, fill: '#f6dccd', color: C.orange });
  const draft = ['「校园交友平台」面向在读大学生，以兴趣与', '共同课程连接同校同学，属“社会服务”赛道。', '项目已完成需求调研与原型 v2（6月），', '团队成员信息待按本届重新确认。'];
  const dt = prog(t, 2.2, 3.4);
  draft.forEach((s, i) => { const k = clamp(dt * draft.length - i); if (k > 0) txt(typed(s, k), 1040, 680 + i * 52, { size: 25, color: C.ink }); });
  if (dt < 1 && Math.floor(t * 3) % 2 === 0) { const i = Math.min(3, Math.floor(dt * 4)), s = typed(draft[i], clamp(dt * 4 - i)); g.fillStyle = C.green; g.fillRect(1040 + tw(s, 25) + 4, 656 + i * 52, 3, 30); }
  g.restore();
}, 'dark');

// S8 55–62.5：按需索取，记忆自己长出来
const S8_NODES = Array.from({ length: 18 }, (_, i) => {
  const a = i * 2.39996, r = 70 + Math.sqrt(i + 1) * 78;
  return { x: 1390 + Math.cos(a) * r * 1.25, y: 560 + Math.sin(a) * r * 0.9, s: ['竞赛获奖 · 2025', '项目经历 v2', '在读证明', '想做教育方向', '会 React', '计划书写作', '志愿时长', '课程成绩', '实习意向', '社团职务', '英语成绩', '作品链接', '获奖证书', '团队名单', '指导老师', '论文草稿', '个人事迹', '奖学金记录'][i] };
});
scene('08 · 按需索取', 55, 62.5, t => {
  bg(C.paper);
  rise('不建档，', 120, 200, prog(t, 0, .5), { size: 76, font: 'serif', weight: 900 });
  rise('需要时才问一句。', 120, 290, prog(t, .2, .5), { size: 76, font: 'serif', weight: 900, color: C.green });
  // 对话
  const bk = eo(prog(t, .7, .5));
  g.save(); g.globalAlpha = bk; g.translate(0, (1 - bk) * 30);
  logo(150, 410, 44);
  box(200, 360, 640, 170, { r: 24, fill: C.white, shadow: 24 });
  txt('这份通知要求近三年获奖，', 236, 420, { size: 28, weight: 700 });
  txt('你有相关证书吗？拍一张就行。', 236, 468, { size: 28, weight: 700 });
  txt('为什么问：本次材料第4项需要', 236, 510, { size: 19, color: C.muted });
  g.restore();
  const press = prog(t, 2.0, .2);
  [['拍一张', C.deep, C.paper], ['跳过', 'transparent', C.ink]].forEach(([s, f, c], i) => {
    const k = eback(prog(t, 1.2 + i * .15, .4)); if (k <= 0) return;
    g.save(); g.translate(260 + i * 180, 590); g.scale(k * (i === 0 ? 1 - Math.sin(press * Math.PI) * .1 : 1), k);
    box(-75, -32, 150, 64, { r: 32, fill: f, stroke: i ? C.ink : null }); txt(s, 0, 2, { size: 24, weight: 700, color: c, align: 'center', base: 'middle' });
    g.restore();
  });
  const pk = eo(prog(t, 2.4, .5));
  if (pk > 0) {
    g.save(); g.globalAlpha = pk; g.translate((1 - pk) * 120, 0);
    box(470, 650, 370, 230, { r: 20, fill: C.deep });
    box(500, 676, 310, 178, { r: 8, fill: '#f8f3e3' });
    txt('获 奖 证 书', 655, 730, { size: 26, font: 'serif', weight: 900, color: C.amber, align: 'center' });
    line(560, 762, 750, 762, { color: C.amber, lw: 1.5 }); line(580, 790, 730, 790, { color: '#d8cfb4', lw: 6 });
    g.beginPath(); g.arc(760, 820, 20, 0, Math.PI * 2); g.fillStyle = C.orange; g.globalAlpha = pk * .7; g.fill();
    g.restore();
  }
  const tk = eback(prog(t, 3.2, .4));
  if (tk > 0) { g.save(); g.translate(200, 940); g.scale(tk, tk); chip('已沉淀为记忆卡片 · 可查看、修改、删除', 0, 0, { size: 22, fill: C.lime }); g.restore(); }
  // 右：记忆图生长
  const grown = S8_NODES.filter((_, i) => t > 3.0 + i * 0.17);
  S8_NODES.forEach((n, i) => {
    const k = eback(prog(t, 3.0 + i * 0.17, .4)); if (k <= 0) return;
    const p = i ? S8_NODES.slice(0, i).reduce((b, m) => (Math.hypot(m.x - n.x, m.y - n.y) < Math.hypot(b.x - n.x, b.y - n.y) ? m : b), { x: 1390, y: 560 }) : { x: 1390, y: 560 };
    curve(p.x, p.y, n.x, n.y, k, { color: C.sage, lw: 2, alpha: .6 });
  });
  g.beginPath(); g.arc(1390, 560, 46, 0, Math.PI * 2); g.fillStyle = C.deep; g.fill();
  txt('你', 1390, 563, { size: 34, font: 'serif', weight: 900, color: C.paper, align: 'center', base: 'middle' });
  S8_NODES.forEach((n, i) => {
    const k = eback(prog(t, 3.0 + i * 0.17, .4)); if (k <= 0) return;
    g.save(); g.translate(n.x, n.y); g.scale(k, k); chip(n.s, 0, 0, { size: 17, align: 'center', fill: i === 0 ? C.orange : C.white, color: i === 0 ? C.white : C.deep, stroke: i ? C.line : null }); g.restore();
  });
  txt('记忆卡片', 1800, 150, { size: 20, color: C.muted, align: 'right', ls: 3 });
  txt(String(4 + grown.length), 1800, 240, { size: 88, font: 'serif', weight: 900, color: C.green, align: 'right' });
  txt('用得越多，要问的越少。', 1390, 1000, { size: 34, font: 'serif', weight: 900, align: 'center', alpha: prog(t, 5.4, .5) });
});
