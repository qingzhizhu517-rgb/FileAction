// 场景 7–12：可信复用、直接行动、不硬凑、团队、同一内核、结尾
(function () {
  const { C, E, P, L, h, at, tf, rise, typed, write, stroke, sheet, svgLayer, line, hcurve, logo, S } = K;

  // ── s7 可信复用：每条材料对回原文，往届获奖证明被拦下 ──
  S.s7 = {
    chapter: ['07', '可信复用'],
    build(root) {
      this.rule = at(sheet(root, {
        title: '通知原文 · 申报要求', meta: '2026 大学生创新创业大赛',
        lines: ['第 2 条　近三年相关获奖证明', '第 3 条　项目介绍（不少于 1000 字）', '第 4 条　团队成员名单（本届签字）', '第 5 条　已获奖成果不得重复申报'],
        width: 700,
      }), 150, 220);
      this.list = at(h('div', 'card', '<div class="label">你的材料</div>', root, { width: '760px', padding: '30px 36px' }), 1000, 220);
      this.items = [
        ['ok', '✓', '省赛二等奖证书 · 2025', '对应第 2 条'],
        ['ok', '✓', '项目介绍 v2 · 6 月', '对应第 3 条'],
        ['warn', '△', '成员名单 · 去年版本', '要按本届重签'],
        ['red', '✗', '往届获奖证明 · 2024', '第 5 条不让再用'],
      ].map(([c, s, v, why]) => h('div', 'row', `<span class="${c}" style="font-size:30px;width:32px">${s}</span><span class="v">${v}</span><span class="mini ${c === 'red' ? 'red' : ''}">${why}</span>`, this.list));
      this.mark = h('div', 'mark', '', this.rule.lines[3], { width: '400px', left: '0', bottom: '-6px' });
      this.note = at(h('div', 'note', '这张去年评过奖，这次不能用。', root), 1000, 760);
    },
    frame(t) {
      rise(this.rule, t, 0.1);
      rise(this.list, t, 0.5);
      this.items.forEach((r, i) => { r.style.opacity = P(t, 1.0 + i * 0.6, 1.5 + i * 0.6); });
      const last = this.items[3];
      last.style.textDecoration = t > 4.4 ? 'line-through' : 'none';
      last.style.textDecorationColor = '#C2412B';
      stroke(this.mark, P(t, 4.6, 5.1));
      write(this.note, P(t, 5.0, 6.4, E.lin));
    },
  };

  // ── s8 直接行动：缺项、截止日、初稿、日历 ──
  S.s8 = {
    chapter: ['08', '直接动手'],
    build(root) {
      this.todo = at(h('div', 'card', '<div class="label">还缺</div>', root, { width: '520px', padding: '30px 34px' }), 150, 240);
      this.todos = [['商业计划书', '10/08'], ['项目 PPT', '10/09'], ['成员名单重签', '10/10'], ['确认指导老师', '10/10'], ['提交报名', '10/12']].map(([v, d]) =>
        h('div', 'row', `<span style="width:22px;height:22px;border:1.5px solid #1E1C19;border-radius:3px;flex:none"></span><span class="v">${v}</span><span class="mini latin" style="font-size:22px">${d}</span>`, this.todo));
      this.draft = at(sheet(root, { title: '项目介绍 · 初稿', meta: '用你确认过的材料起草', lines: [], width: 560 }), 720, 240);
      this.dtx = h('div', 'ln', '', this.draft, { minHeight: '230px' });
      h('div', 'note', '初稿，等你确认', this.draft, { position: 'relative', fontSize: '26px', marginTop: '10px' });
      this.cal = at(h('div', 'card', '<div class="label">十月</div><div class="g" style="display:grid;grid-template-columns:repeat(7,44px);gap:8px"></div>', root, { padding: '30px 30px' }), 1340, 240);
      const g = this.cal.querySelector('.g');
      this.days = Array.from({ length: 31 }, (_, i) => h('div', 'latin', String(i + 1), g, { height: '44px', lineHeight: '44px', textAlign: 'center', fontSize: '20px', borderRadius: '50%', color: '#5F594F' }));
      this.hits = [7, 8, 9, 11];
    },
    frame(t) {
      rise(this.todo, t, 0.1);
      this.todos.forEach((r, i) => { r.style.opacity = P(t, 0.4 + i * 0.3, 0.8 + i * 0.3); });
      rise(this.draft, t, 1.8);
      typed(this.dtx, '「校园交友平台」面向高校学生，以兴趣和课程为线索帮同学找到搭档。团队已完成原型，并获 2025 年省赛二等奖。', P(t, 2.2, 5.0, E.lin));
      rise(this.cal, t, 4.6);
      this.hits.forEach((d, i) => {
        const on = t > 5.4 + i * 0.25;
        const el = this.days[d];
        el.style.background = on ? (d === 11 ? '#C2412B' : '#1E1C19') : 'transparent';
        el.style.color = on ? '#FFFDF8' : '#5F594F';
      });
    },
  };

  // ── s9 没有要做的，就直说 ──
  S.s9 = {
    chapter: ['09', '不硬凑待办'],
    build(root) {
      this.doc = at(sheet(root, { title: '图书馆国庆开放时间调整', meta: '校园公告', lines: [88, 72, 80, 50], width: 640 }), 300, 300);
      this.note = at(h('div', 'note', '跟你关系不大，<br>知道就行，不用做什么。', root, { fontSize: '44px' }), 1060, 420);
    },
    frame(t) {
      rise(this.doc, t, 0.1);
      write(this.note, P(t, 1.0, 2.8, E.lin));
    },
  };

  // ── s10 临时组队：能力名片 → 分工建议 → 缺口 ──
  S.s10 = {
    chapter: ['10', '临时组队'],
    build(root) {
      this.svg = svgLayer(root);
      const people = [['小王', '做过 2 个 React 项目'], ['小李', '写过商业计划书'], ['小陈', '调过大模型 API'], ['小赵', '做过路演 PPT']];
      this.cards = people.map(([n, s], i) => at(h('div', 'card', `<div class="serif" style="font-size:30px;font-weight:600">${n}</div><div class="c2" style="font-size:22px;margin-top:6px">${s}</div><div class="c3" style="font-size:16px;margin-top:10px;letter-spacing:2px">本人授权 · 可回溯</div>`, root, { width: '420px', padding: '22px 28px' }), 150, 150 + i * 160));
      const jobs = [['产品原型', '小王', '有 React 原型经验'], ['商业计划书', '小李', '写过同类计划书'], ['模型接入', '小陈', '调过大模型 API'], ['路演 PPT', '小赵', '做过路演']];
      this.jobs = jobs.map(([j, who, why], i) => at(h('div', 'card', `<div style="display:flex;align-items:baseline;gap:16px"><span class="serif" style="font-size:30px;font-weight:600">${j}</span><span class="c2" style="font-size:22px">建议：${who}</span></div><div class="c3" style="font-size:18px;margin-top:8px">理由：${why}</div>`, root, { width: '520px', padding: '22px 28px' }), 1250, 150 + i * 160));
      this.lines = jobs.map((_, i) => line(this.svg, hcurve(572, 212 + i * 160, 1248, 212 + i * 160), { color: '#9A9286', w: 1.4 }));
      this.gap = at(h('div', 'note', '队里还缺一个能做用户访谈的人。', root), 700, 810);
      this.foot = at(h('div', 'abs c3', '分工由成员决定，旁批只给建议，不盯进度。', root, { fontSize: '22px', letterSpacing: '2px' }), 700, 875);
    },
    frame(t) {
      this.cards.forEach((c, i) => rise(c, t, 0.2 + i * 0.3));
      this.lines.forEach((l, i) => l.draw(P(t, 2.0 + i * 0.3, 2.7 + i * 0.3)));
      this.jobs.forEach((c, i) => rise(c, t, 2.4 + i * 0.3));
      write(this.gap, P(t, 4.8, 6.4, E.lin));
      rise(this.foot, t, 8.0);
    },
  };

  // ── s11 同一件事：个人、团队、企业 ──
  S.s11 = {
    chapter: ['11', '同一件事'],
    build(root) {
      this.cols = [['个人', '跟我有什么关系', '本届完整实现'], ['团队', '谁做哪块最合适', '本届轻量实现'], ['企业', '谁需要做什么', '路线图']].map(([a, b, c], i) =>
        at(h('div', 'abs', `<div class="serif" style="font-size:64px;font-weight:600">${a}</div><div class="c2" style="font-size:28px;margin-top:18px">${b}</div><div class="c3" style="font-size:19px;margin-top:14px;letter-spacing:3px">${c}</div>`, root, { width: '420px', textAlign: 'center' }), 270 + i * 480, 310));
      this.rules = [0, 1].map(i => at(h('div', 'abs', '', root, { width: '1px', height: '200px', background: '#DCD5C7' }), 720 + i * 480, 320));
      this.core = h('div', 'head', '读懂文件　·　了解人　·　把事办完', root, { top: '700px', fontSize: '44px', fontWeight: 400, letterSpacing: '4px' });
    },
    frame(t) {
      this.cols.forEach((c, i) => rise(c, t, 0.3 + i * 1.0));
      this.rules.forEach((r, i) => { r.style.opacity = P(t, 1.0 + i, 1.4 + i); });
      rise(this.core, t, 5.2);
    },
  };

  // ── s12 结尾 ──
  S.s12 = {
    chapter: ['', ''],
    build(root) {
      this.logo = at(h('div', 'abs', '', root, { width: '150px', height: '150px' }), 885, 230);
      this.name = h('div', 'head', '旁批 <span class="latin" style="font-style:italic;font-weight:400;font-size:44px;letter-spacing:4px;color:#5F594F">Margin</span>', root, { top: '420px', fontSize: '96px', letterSpacing: '16px' });
      this.line = h('div', 'head', '每份文件，都从你的角度读一遍', root, { top: '590px', fontSize: '44px', fontWeight: 400, letterSpacing: '6px' });
      this.foot = h('div', 'head c3', '西客松 XiHack 2026　·　概念演示，画面与数据均为合成示意', root, { top: '930px', fontSize: '20px', fontFamily: 'var(--sans)', fontWeight: 400, letterSpacing: '3px' });
    },
    frame(t) {
      const lp = P(t, 0.3, 1.2, E.inout);
      if (this.logo._p !== lp) { this.logo.innerHTML = logo(lp); this.logo._p = lp; }
      rise(this.logo, t, 0, 0.5);
      rise(this.name, t, 0.6, 0.8);
      rise(this.line, t, 1.3, 0.8);
      rise(this.foot, t, 2.2, 0.8);
    },
  };
})();
