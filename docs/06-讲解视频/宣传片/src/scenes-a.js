// S1–S4：痛点、品牌、内核
// S1 0–7.5：通知堆积
const S1_DOCS = ['竞赛通知', '奖学金', '实习简章', '学时认定', '讲座通知', '保研细则', '评优公示', '社团招新', '志愿时长', '课程调整', '实验室招募', '考试安排', '综测细则', '公司规章', '宿舍通知', '创新学分', '交换项目', '助学金'];
const S1_LAND = S1_DOCS.map((_, i) => 0.6 + i * BEAT * 0.5); // 每半拍落下一份
scene('01 · 又一份通知', 0, 7.5, t => {
  bg(C.paper); dots(80, 120, 8, 12, 34, C.green, .14);
  S1_DOCS.forEach((label, i) => {
    const land = S1_LAND[i], k = prog(t, land - 0.55, 0.55);
    if (k <= 0) return;
    const col = i % 5, row = Math.floor(i / 5);
    const tx = 1020 + col * 170 + ((i * 37) % 23) - 11, ty = 375 + row * 172 + ((i * 53) % 31);
    const y = lerp(-260, ty, ebounce(k)), rot = (((i * 71) % 40) - 20) / 100 * (1 + (1 - k) * 2);
    doc(tx, y, 150, 190, { rot, label, ls: 19, accent: i % 4 === 0 ? C.orange : i % 3 === 0 ? C.sage : C.green });
  });
  rise('又一份', 130, 410, prog(t, 0.3, 0.6), { size: 150, font: 'serif', weight: 900, color: C.ink });
  rise('通知。', 130, 580, prog(t, 0.6, 0.6), { size: 150, font: 'serif', weight: 900, color: C.green });
  rise('竞赛、奖学金、实习、学时……每一份都长得差不多，', 134, 690, prog(t, 1.6, 0.6), { size: 30, color: C.muted });
  rise('哪份跟你有关？要不要做点什么？', 134, 740, prog(t, 2.0, 0.6), { size: 30, color: C.muted });
  const n = S1_LAND.filter(l => t >= l).length;
  txt('UNREAD', 1790, 158, { size: 18, font: 'mono', color: C.muted, align: 'right', ls: 4 });
  txt(String(n * 7 + (n ? 3 : 0)), 1790, 252, { size: 96, font: 'serif', weight: 900, color: C.orange, align: 'right' });
  stamp('读不过来', 520, 900, prog(t, 5.6, 0.5), { size: 40, rot: -0.08 });
});

// S2 7.5–15：通用 AI，人人一样
scene('02 · 通用的解读', 7.5, 15, t => {
  bg(C.ink);
  rise('通用 AI 读文件，', 130, 170, prog(t, 0.1, 0.5), { size: 64, font: 'serif', weight: 900, color: C.paper });
  rise('给每个人的都一样。', 130, 250, prog(t, 0.35, 0.5), { size: 64, font: 'serif', weight: 900, color: C.limeHi });
  const dk = eback(prog(t, 0.4, 0.6));
  doc(1500, 200, 110 * dk || 1, 140 * dk || 1, { label: '大赛通知', ls: 17, alpha: clamp(dk), accent: C.orange });
  const who = [['大一 · 想试试', 360], ['大三 · 有项目', 960], ['研一 · 已获过奖', 1560]];
  who.forEach(([tag, x], i) => {
    const pk = prog(t, 0.8 + i * 0.25, 0.5);
    person(x, 900, 70, { color: C.paper, alpha: eo(pk) });
    txt(tag, x, 1000, { size: 26, color: C.paper, align: 'center', alpha: eo(pk) * 0.8 });
    const ck = prog(t, 1.8 + i * 0.35, 0.5);
    curve(1500, 270, x, 400, ck, { vertical: true, color: C.muted, dash: [8, 10], lw: 2 });
    if (ck >= 1) {
      const ak = eback(prog(t, 2.3 + i * 0.35, 0.45));
      g.save(); g.translate(x, 560); g.scale(ak, ak);
      box(-230, -160, 460, 300, { r: 22, fill: '#26302c', stroke: '#3a4641' });
      txt('该文件主要包括以下几点：', -196, -100, { size: 25, color: C.paper, weight: 600 });
      ['1. 参赛对象与赛道', '2. 报名时间与方式', '3. 材料要求'].forEach((s, j) => txt(s, -196, -44 + j * 46, { size: 23, color: '#a9b2ad' }));
      txt('建议您尽早准备。', -196, 104, { size: 23, color: '#a9b2ad' });
      g.restore();
      line(x, 720, x, 810, { color: C.muted, lw: 2, alpha: ak });
    }
  });
  const ek = eback(prog(t, 3.6, 0.35));
  ['=', '='].forEach((s, i) => txt(s, 660 + i * 600, 580, { size: 90 * ek, weight: 300, color: C.limeHi, align: 'center', base: 'middle', alpha: clamp(ek) }));
  stamp('人人一样', 960, 560, prog(t, 5.0, 0.6), { size: 64, rot: -0.1 });
}, 'dark');

// S3 15–20：品牌亮相
scene('03 · 文启 FileAction', 15, 20, t => {
  bg(C.paper);
  const bk = prog(t, 0.1, 1.2);
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2, r0 = 200 + eo(bk) * 120, r1 = r0 + 60 + eo(bk) * 520;
    line(560 + Math.cos(a) * r0, 540 + Math.sin(a) * r0, 560 + Math.cos(a) * r1, 540 + Math.sin(a) * r1, { color: i % 6 ? C.line : C.limeHi, lw: i % 6 ? 2 : 5, alpha: 1 - bk * 0.6 });
  }
  g.globalAlpha = 1;
  logo(560, 540, 380, prog(t, 0, 1.0));
  rise('文启', 900, 560, prog(t, 0.7, 0.6), { size: 220, font: 'serif', weight: 900, color: C.ink, ls: 10 });
  rise('F I L E A C T I O N', 910, 640, prog(t, 1.1, 0.5), { size: 34, font: 'mono', weight: 600, color: C.green, ls: 6 });
  line(910, 690, 910 + 760 * eio(prog(t, 1.4, 0.8)), 690, { color: C.ink, lw: 3 });
  rise('每份文件，都从你的角度读一遍。', 910, 770, prog(t, 1.8, 0.6), { size: 44, font: 'serif', weight: 700, color: C.ink });
  rise('从文件开启行动', 912, 830, prog(t, 2.2, 0.6), { size: 26, color: C.muted, ls: 6 });
});

// S4 20–30：Document → 可行动事务 → Workflow
scene('04 · 内核', 20, 30, t => {
  bg(C.lime);
  g.save(); font(200, 'sans', 900); g.lineWidth = 2; g.strokeStyle = 'rgba(22,63,50,.12)';
  for (let r = 0; r < 4; r++) g.strokeText('DOCUMENT → ACTION → WORKFLOW → ', -((t * 60 + r * 400) % 3400), 260 + r * 250);
  g.restore();
  rise('从文件，到行动。', 130, 150, prog(t, 0.1, 0.6), { size: 72, font: 'serif', weight: 900, color: C.deep });
  [['DOCUMENT', 120, 0.3], ['可行动事务', 730, 2.4], ['WORKFLOW', 1440, 5.6]].forEach(([s, x, a]) => txt(s, x, 260, { size: 22, font: 'mono', weight: 700, color: C.green, ls: 4, alpha: prog(t, a, 0.4) }));
  // 左：通知原文
  const D = { x: 120, y: 300, w: 500, h: 600 };
  box(D.x, D.y, D.w, D.h, { r: 14, shadow: 30, alpha: eo(prog(t, 0.3, 0.5)) });
  const L = ['关于举办大学生创新创业大赛的通知', '一、参赛对象：全日制在读本科生', '二、赛道：含“社会服务”赛道', '三、截止：10月12日前提交', '四、材料：计划书、PPT、成员名单', '五、已获奖成果不得重复申报', '六、请各学院统一报送'];
  const scanY = D.y + 40 + eio(prog(t, 1.0, 1.6)) * 520;
  L.forEach((s, i) => {
    const y = D.y + 70 + i * 74, hit = [1, 3, 4, 5].includes(i) || i === 2;
    if (hit && scanY > y - 10) { g.fillStyle = i === 5 ? 'rgba(208,98,43,.18)' : 'rgba(201,224,143,.75)'; g.fillRect(D.x + 26, y - 30, D.w - 52, 44); }
    txt(s, D.x + 36, y, { size: i ? 22 : 23, weight: i ? 500 : 800, color: C.ink, alpha: eo(prog(t, 0.4 + i * 0.06, 0.4)) });
  });
  if (t > 1 && t < 2.8) line(D.x + 10, scanY, D.x + D.w - 10, scanY, { color: C.orange, lw: 4 });
  // 中：事务卡，字段从原文飞入
  const K = { x: 730, y: 300, w: 560, h: 600 };
  box(K.x, K.y, K.w, K.h, { r: 24, fill: C.deep, shadow: 40, alpha: eo(prog(t, 2.2, 0.5)) });
  const rows = [['对象', '在读本科生 · 你符合', 1], ['条件', '社会服务赛道', 2], ['时间', '10月12日截止', 3], ['材料', '计划书 · PPT · 成员名单', 4], ['下一步', '对照你已有的材料', 5]];
  rows.forEach(([k, v, src], i) => {
    const fk = eio(prog(t, 2.6 + i * 0.35, 0.6));
    if (fk <= 0) return;
    const sx = D.x + 300, sy = D.y + 60 + src * 74, ex = K.x + 40, ey = K.y + 110 + i * 98;
    const x = lerp(sx, ex, fk), y = lerp(sy, ey, fk) - Math.sin(fk * Math.PI) * 60;
    if (fk < 1) { chip(v, x, y, { size: 20, fill: C.limeHi }); return; }
    txt(k, ex, ey + 8, { size: 22, color: C.limeHi, font: 'mono', weight: 700 });
    txt(v, ex + 120, ey + 8, { size: 27, color: C.paper, weight: 700 });
    line(ex, ey + 44, K.x + K.w - 40, ey + 44, { color: 'rgba(220,234,196,.18)', lw: 1.5 });
  });
  txt('可行动事务', K.x + 40, K.y + 58, { size: 26, font: 'serif', weight: 900, color: C.lime, alpha: prog(t, 2.4, 0.4) });
  // 右：工作流
  const steps = ['核对已有材料', '列出缺项与截止', '起草缺的材料', '导出待办与日历'];
  steps.forEach((s, i) => {
    const sk = prog(t, 5.7 + i * BEAT, 0.5), y = 360 + i * 145;
    if (i > 0) line(1480, y - 145 + 30, 1480, lerp(y - 145 + 30, y - 30, eo(sk)), { color: C.deep, lw: 4 });
    if (sk <= 0) return;
    const sc = eback(sk); g.save(); g.translate(1480, y); g.scale(sc, sc);
    g.beginPath(); g.arc(0, 0, 30, 0, Math.PI * 2); g.fillStyle = i === 3 ? C.orange : C.deep; g.fill();
    txt(String(i + 1), 0, 2, { size: 26, weight: 800, color: C.paper, align: 'center', base: 'middle' });
    g.restore();
    rise(s, 1540, y + 12, sk, { size: 34, weight: 800, color: C.deep });
  });
  curve(D.x + D.w + 10, 600, K.x - 10, 600, prog(t, 2.2, 0.4), { color: C.deep, lw: 4 });
  curve(K.x + K.w + 10, 600, 1440, 600, prog(t, 5.4, 0.4), { color: C.deep, lw: 4 });
});
