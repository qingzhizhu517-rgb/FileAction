// 场景 1–6：通知堆积、通用 AI、品牌、第一次使用、记忆、主动发现
(function () {
  const { C, E, P, L, rng, h, at, tf, rise, typed, write, stroke, sheet, svgLayer, line, hcurve, logo, CURSOR, S } = K;

  // ── s1 一天的通知，一张张落到桌上 ──
  S.s1 = {
    chapter: ['01', '每天都在发生'],
    build(root) {
      const docs = [
        ['2026 大学生创新创业大赛通知', '学院团委'], ['奖学金评定细则', '班级群 · 截图'],
        ['第二课堂学分认定办法', '教务处'], ['社团活动申报表（第三版）', '学生会'],
        ['某某教育公司简章', '招聘群'], ['挑战杯校赛启动', '同学转发'],
      ];
      const r = rng(11);
      this.docs = docs.map(([title, meta], i) => {
        const el = sheet(root, { title, meta, lines: [92, 80, 88, 60], width: 470 });
        at(el, 250 + (i % 3) * 360 + (r() - 0.5) * 60, 200 + Math.floor(i / 3) * 250 + (r() - 0.5) * 40);
        return { el, r: (r() - 0.5) * 9, a: 0.2 + i * 0.55 };
      });
      this.count = at(h('div', 'abs', '<div class="label">今天收到</div><div class="serif n" style="font-size:120px;font-weight:600;line-height:1">0</div><div class="c3" style="font-size:22px;margin-top:6px">份文件</div>', root), 1560, 360);
    },
    frame(t) {
      this.docs.forEach(d => {
        const p = P(t, d.a, d.a + 0.8);
        tf(d.el, { y: L(-60, 0, p), r: L(d.r * 2.2, d.r, p), o: P(t, d.a, d.a + 0.3) });
      });
      rise(this.count, t, 0.3);
      this.count.querySelector('.n').textContent = Math.round(C((t - 0.3) / 3.6) * 14);
    },
  };

  // ── s2 同一份文件，给每个人同一段话 ──
  S.s2 = {
    chapter: ['02', '通用 AI 怎么读'],
    build(root) {
      this.doc = at(sheet(root, { title: '创新创业大赛通知', meta: '同一份文件', lines: [90, 76, 84, 70, 58], width: 460 }), 170, 300);
      this.svg = svgLayer(root);
      this.rows = ['同学 A', '同学 B', '同学 C', '同学 D'].map((who, i) => {
        const y = 200 + i * 175;
        const el = at(h('div', 'card', `<div class="label">${who}</div><div style="font-size:24px;color:#5F594F">该通知主要包括以下几点：1. 报名时间 2. 参赛要求 3. 提交材料</div>`, root, { width: '760px', padding: '20px 28px' }), 1000, y);
        const ln = line(this.svg, hcurve(640, 520, 990, y + 62), { color: '#B8AF9F', w: 1.4 });
        return { el, ln, a: 1.2 + i * 0.35 };
      });
      this.note = at(h('div', 'note', '四个人，一模一样。', root, { fontSize: '44px' }), 1290, 900);
    },
    frame(t) {
      rise(this.doc, t, 0.2);
      this.rows.forEach(r => { r.ln.draw(P(t, r.a - 0.3, r.a + 0.3)); rise(r.el, t, r.a, 0.6); });
      write(this.note, P(t, 3.4, 4.4, E.lin));
    },
  };

  // ── s3 名字与图标 ──
  S.s3 = {
    chapter: ['', ''],
    build(root) {
      this.logo = at(h('div', 'abs', '', root, { width: '200px', height: '200px' }), 860, 210);
      this.name = h('div', 'head', '旁批', root, { top: '450px', fontSize: '150px', letterSpacing: '30px', paddingLeft: '30px' });
      this.en = h('div', 'head latin', 'Margin', root, { top: '640px', fontSize: '46px', fontStyle: 'italic', fontWeight: 400, color: '#5F594F', letterSpacing: '6px' });
      this.tag = h('div', 'head', '在文件旁边，写给你本人的批注', root, { top: '770px', fontSize: '36px', fontWeight: 400, color: '#5F594F', letterSpacing: '6px' });
    },
    frame(t) {
      const lp = P(t, 0.6, 1.6, E.inout);
      if (this.logo._p !== lp) { this.logo.innerHTML = logo(lp); this.logo._p = lp; }
      rise(this.logo, t, 0.1, 0.6);
      rise(this.name, t, 0.9, 0.8, 24);
      rise(this.en, t, 1.3, 0.8);
      rise(this.tag, t, 1.9, 0.8);
    },
  };

  // ── s4 第一次用：只问一句，批注就变成你的 ──
  S.s4 = {
    chapter: ['04', '第一次用，不用填资料'],
    build(root) {
      this.doc = at(sheet(root, {
        title: '某某教育 · 2026 校园招聘简章', meta: '刚刚上传',
        lines: ['公司主营 K12 课程与教研产品。', '招聘岗位：产品实习生、教研实习生。', '教研岗优先考虑有家教或助教经历者。', '实习期不少于三个月，可转正。', 70],
        width: 760,
      }), 150, 190);
      this.u1 = h('div', 'mark', '', this.doc.lines[1], { width: '350px', left: '0', bottom: '-4px' });
      this.u2 = h('div', 'mark', '', this.doc.lines[2], { width: '360px', left: '0', bottom: '-4px' });
      this.n1 = at(h('div', 'note', '你在找教育方向的实习，<br>这两个岗位都对口。', root), 1000, 380);
      this.n2 = at(h('div', 'note', '教研岗看重家教经历，<br>你带过两年初中数学。', root), 1000, 530);
      this.ask = at(h('div', 'card', '<div class="label">只问一句</div><div class="serif" style="font-size:36px;font-weight:600;margin-bottom:24px">传这个，是在……</div><span class="opt o0">找实习</span><span class="opt">了解行业</span><span class="opt">先存着</span>', root, { width: '720px', padding: '30px 34px' }), 1000, 300);
      this.opt = this.ask.querySelector('.o0');
      this.cur = at(h('div', 'cursor', CURSOR, root), 0, 0);
      this.gen = at(h('div', 'card', '<div class="label">通用解读</div><div class="tx" style="font-size:25px;color:#5F594F;line-height:1.6"></div>', root, { width: '720px' }), 1000, 160);
    },
    frame(t) {
      rise(this.doc, t, 0.1);
      rise(this.gen, t, 0.6);
      typed(this.gen.querySelector('.tx'), '这是一份教育公司的招聘简章，介绍了公司业务和两个实习岗位。', P(t, 0.8, 2.4, E.lin));
      rise(this.ask, t, 2.6);
      const cp = P(t, 3.4, 4.3, E.inout);
      this.cur.style.transform = `translate(${L(1500, 1080, cp)}px,${L(700, 430, cp)}px)`;
      this.cur.style.opacity = P(t, 3.3, 3.5) * (1 - P(t, 5.0, 5.3));
      this.opt.classList.toggle('on', t > 4.4);
      // 选完后：两张卡片退场，页边出现朱批
      const out = P(t, 5.0, 5.6);
      this.ask.style.opacity = C(P(t, 2.6, 3.3)) * (1 - out);
      this.gen.style.opacity = C(P(t, 0.6, 1.3)) * (1 - out);
      stroke(this.u1, P(t, 5.7, 6.2));
      write(this.n1, P(t, 6.0, 7.2, E.lin));
      stroke(this.u2, P(t, 7.4, 7.9));
      write(this.n2, P(t, 7.7, 8.9, E.lin));
    },
  };

  // ── s5 记忆：看得见，能删 ──
  S.s5 = {
    chapter: ['05', '记忆看得见，也能删'],
    build(root) {
      this.says = ['“我在找教育方向的实习。”', '“不对，我是项目成员，不是负责人。”', '（拍了一张获奖证书）'].map((s, i) =>
        at(h('div', 'abs serif', s, root, { fontSize: '34px', color: '#5F594F' }), 150, 330 + i * 120));
      this.book = at(h('div', 'card', '<div class="label">旁批记得的</div>', root, { width: '780px', padding: '30px 36px' }), 990, 220);
      this.rows = [['意向', '教育方向实习'], ['经历', '校园交友平台 · 项目成员'], ['获奖', '省赛二等奖 · 2025'], ['意向', '想做 To B 教育创业'], ['材料', '项目介绍 v2 · 6 月']].map(([k, v]) =>
        h('div', 'row', `<span class="k">${k}</span><span class="v">${v}</span><span class="mini">来源 · 删除</span>`, this.book));
      this.strike = h('div', 'mark', '', this.book, { width: '360px', top: '0', left: '110px' });
    },
    frame(t) {
      this.says.forEach((s, i) => rise(s, t, 0.3 + i * 0.8));
      rise(this.book, t, 1.0);
      this.rows.forEach((r, i) => { const p = P(t, 1.6 + i * 0.5, 2.2 + i * 0.5); r.style.opacity = p; });
      // 删除第四条：划掉后淡出
      const row = this.rows[3];
      this.strike.style.top = (row.offsetTop + row.offsetHeight / 2) + 'px';
      stroke(this.strike, P(t, 5.6, 6.1));
      row.style.opacity = C(P(t, 3.1, 3.7)) * (1 - 0.7 * P(t, 6.2, 6.8));
    },
  };

  // ── s6 主动发现：新通知进来，页边写着“跟你有关” ──
  S.s6 = {
    chapter: ['06', '主动发现'],
    build(root) {
      this.doc = at(sheet(root, {
        title: '2026 大学生创新创业大赛通知', meta: '新收到 · 学院团委',
        lines: ['一、本届新增“社会服务”赛道。', '二、报名截止：10 月 12 日。', '三、需提交商业计划书与项目 PPT。', 86, 64],
        width: 760,
      }), 150, 200);
      this.u1 = h('div', 'mark', '', this.doc.lines[0], { width: '320px', left: '0', bottom: '-4px' });
      this.u2 = h('div', 'mark', '', this.doc.lines[1], { width: '250px', left: '0', bottom: '-4px' });
      this.n1 = at(h('div', 'note', '跟你有关：你存过的「校园交友平台」<br>点子，正好对得上这个赛道。', root), 1000, 380);
      this.n2 = at(h('div', 'note', '还剩 12 天。', root), 1000, 520);
      this.n3 = at(h('div', 'note', '你说过，以后想做 To B 教育创业。', root, { color: '#5F594F' }), 1000, 610);
    },
    frame(t) {
      rise(this.doc, t, 0.1);
      stroke(this.u1, P(t, 1.2, 1.7));
      write(this.n1, P(t, 1.5, 3.2, E.lin));
      stroke(this.u2, P(t, 3.4, 3.8));
      write(this.n2, P(t, 3.6, 4.2, E.lin));
      write(this.n3, P(t, 4.6, 5.8, E.lin));
    },
  };
})();
