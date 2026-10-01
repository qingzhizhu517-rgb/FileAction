// 场景 1–6：痛点、通用 AI、品牌亮相、零记忆首问、记忆生长、主动发现
(function () {
  const { C, E, P, L, rng, h, place, tf, pop, typed, logo, ICON, fileCard, avatar, svgLayer, line, dot, along, vcurve, S } = K;

  // ── s1 通知刷屏：文件从四周涌入堆满画面，手机不断弹出消息 ──
  S.s1 = {
    chapter: ['01', '每天都在发生'],
    build(root) {
      const files = [
        ['pdf', 'PDF', '2026 大学生创新创业大赛通知.pdf', '学院团委 · 12:03'],
        ['img', 'IMG', '奖学金评定细则（截图）.png', '班级群 · 12:05'],
        ['msg', '💬', '转发：请各位同学周五前提交……', '辅导员 · 12:06'],
        ['doc', 'DOC', '社团活动申报表-第三版.docx', '学生会 · 12:10'],
        ['pdf', 'PDF', '第二课堂学分认定办法.pdf', '教务处 · 12:12'],
        ['xls', 'XLS', '参赛队员信息汇总.xlsx', '指导老师 · 12:15'],
        ['img', 'IMG', '实习宣讲会海报.jpg', '就业中心 · 12:20'],
        ['doc', 'DOC', '个人事迹材料模板.docx', '班长 · 12:21'],
        ['pdf', 'PDF', '某某教育公司简章.pdf', '招聘群 · 12:30'],
        ['msg', '💬', '转发：挑战杯校赛启动啦！', '同学 · 12:32'],
      ];
      const r = rng(7), W = 1920, H = 1080;
      this.items = files.map((f, i) => {
        const el = place(fileCard(root, f), 0, 0);
        const ang = r() * Math.PI * 2;
        return { el, sx: W / 2 + Math.cos(ang) * 1400, sy: H / 2 + Math.sin(ang) * 900,
          tx: 290 + (i % 5) * 335 + (r() - 0.5) * 70, ty: 330 + Math.floor(i / 5) * 290 + (r() - 0.5) * 80,
          rot: (r() - 0.5) * 16, at: 0.3 + i * 0.42 };
      });
      this.badge = place(h('div', 'card', '<div style="font-size:24px;color:#8E9CC2">未读消息</div><div class="n" style="font-size:96px;font-weight:700;color:#F87171;line-height:1.1">0</div>', root, { padding: '24px 40px', textAlign: 'center' }), 1720, 830);
      this.q = h('div', 'title h2', '哪些跟我有关？我要做什么？', root, { top: '800px' });
    },
    frame(t) {
      this.items.forEach(it => {
        const p = P(t, it.at, it.at + 1.1, E.out), q = P(t, it.at, it.at + 0.5);
        const drift = Math.sin(t * 0.9 + it.at) * 6;
        tf(it.el, { x: L(it.sx - it.tx, 0, p) + it.tx - 0, y: L(it.sy - it.ty, 0, p) + drift, r: L(it.rot * 4, it.rot, p), s: L(0.6, 1, p), o: q });
        it.el.style.left = '0px'; it.el.style.top = '0px';
        it.el.style.transform = `translate(-50%,-50%) translate(${L(it.sx, it.tx, p)}px,${L(it.sy, it.ty, p) + drift}px) rotate(${L(it.rot * 4, it.rot, p)}deg) scale(${L(0.6, 1, p)})`;
      });
      const n = Math.floor(C((t - 0.3) / 4.6) * 99);
      this.badge.querySelector('.n').textContent = n > 98 ? '99+' : n;
      pop(this.badge, t, 0.4, 0.5);
      pop(this.q, t, 5.4, 0.7, { back: false });
    },
  };

  // ── s2 通用 AI：同一个回答复制给所有人 ──
  S.s2 = {
    chapter: ['02', '通用 AI 的回答'],
    build(root) {
      this.doc = place(fileCard(root, ['pdf', 'PDF', '创新创业大赛通知.pdf', '同一份文件']), 360, 540);
      this.ai = place(h('div', 'card', '<div style="font-size:30px;font-weight:600">通用 AI</div><div class="muted" style="font-size:22px;margin-top:6px">总结 · 概括</div>', root, { padding: '30px 44px', textAlign: 'center' }), 850, 540);
      this.svg = svgLayer(root);
      this.inL = line(this.svg, 'M600 540 L740 540', { color: '#8E9CC2', glow: false });
      const grads = ['#60A5FA,#2563EB', '#F472B6,#BE185D', '#34D399,#047857', '#FBBF24,#B45309'];
      this.rows = grads.map((g, i) => {
        const y = 250 + i * 190;
        const ln = line(this.svg, `M965 540 C1060 540 1060 ${y} 1150 ${y}`, { color: '#8E9CC2', glow: false });
        const av = avatar(root, `linear-gradient(135deg,${g})`, 96); place(av, 1215, y);
        const b = place(h('div', 'card', '<div style="font-size:24px">该通知主要包括以下几点：</div><div class="muted" style="font-size:20px;margin-top:6px">1. 报名时间 2. 参赛要求 3. 提交材料</div>', root, { padding: '18px 26px', width: '470px' }), 1300, y, false);
        b.style.marginTop = '-48px';
        return { ln, av, b, at: 1.6 + i * 0.35 };
      });
      this.stamp = place(h('div', 'abs', '人人都一样', root, { fontSize: '44px', fontWeight: 700, color: '#F87171', border: '4px solid #F87171', padding: '10px 26px', borderRadius: '12px' }), 1540, 560);
    },
    frame(t) {
      pop(this.doc, t, 0.2, 0.6);
      pop(this.ai, t, 0.6, 0.6);
      this.inL.draw(P(t, 0.9, 1.4));
      this.rows.forEach(r => {
        r.ln.draw(P(t, r.at, r.at + 0.5));
        pop(r.av, t, r.at + 0.3, 0.5);
        const p = P(t, r.at + 0.45, r.at + 0.9);
        r.b.style.opacity = p; r.b.style.transform = `translateX(${L(-30, 0, p)}px)`;
      });
      const sp = P(t, 3.7, 4.1, E.back);
      tf(this.stamp, { s: L(2.2, 1, sp), r: -8, o: P(t, 3.7, 3.9) });
    },
  };

  // ── s3 品牌亮相：文件被“读懂”，射线聚焦到你 ──
  S.s3 = {
    chapter: ['03', '换一种读法'],
    build(root) {
      this.rings = [0, 1, 2].map(i => place(h('div', 'abs', '', root, { width: '420px', height: '420px', borderRadius: '50%', border: '2px solid rgba(56,225,255,.5)' }), 960, 420));
      this.logo = place(h('div', 'abs', logo(), root, { width: '220px', height: '220px' }), 960, 420);
      this.name = h('div', 'title', 'DoAgent', root, { top: '590px', fontSize: '120px', fontWeight: 700, letterSpacing: '6px' });
      this.name.classList.add('grad');
      this.tag = h('div', 'title h2', '站在你的角度，读懂每一份文件', root, { top: '770px', color: '#DDE5FF' });
      this.scan = h('div', 'abs', '', root, { left: '0', width: '1920px', height: '3px', background: 'linear-gradient(90deg,transparent,#38E1FF,transparent)', boxShadow: '0 0 30px #38E1FF' });
    },
    frame(t) {
      this.rings.forEach((r, i) => {
        const p = ((t * 0.55 + i / 3) % 1);
        tf(r, { s: L(0.5, 2.2, p), o: (1 - p) * P(t, 0.2, 0.8) });
      });
      const lp = P(t, 0.2, 1.1, E.back);
      tf(this.logo, { s: L(0.2, 1, lp), r: L(-40, 0, lp), o: P(t, 0.2, 0.6) });
      const np = P(t, 0.8, 1.6);
      tf(this.name, { y: L(40, 0, np), o: np, blur: L(12, 0, np) });
      this.name.style.letterSpacing = L(40, 6, np) + 'px';
      pop(this.tag, t, 1.5, 0.7, { back: false });
      const sp = P(t, 0.6, 2.2, E.inout);
      this.scan.style.top = L(100, 1000, sp) + 'px'; this.scan.style.opacity = sp > 0 && sp < 1 ? 0.9 : 0;
    },
  };

  // ── s4 零记忆首问：通用解读 → 一个问题 → 你的解读 ──
  S.s4 = {
    chapter: ['04', '第一次用，不用建档'],
    build(root) {
      this.file = place(fileCard(root, ['pdf', 'PDF', '某某教育公司简章.pdf', '刚刚上传']), 400, 250);
      this.b1 = place(h('div', 'bubble b-ai', '<div class="lab muted">第一版解读</div><div class="tx"></div>', root, { width: '640px' }), 110, 360, false);
      this.q = place(h('div', 'card', '<div class="lab cy">只问你一个问题</div><div style="font-size:32px;margin:6px 0 20px">你上传它，是在……？</div><div style="display:flex;gap:16px"><span class="chip o0">找实习</span><span class="chip o1">了解行业</span><span class="chip o2">先存着</span></div>', root, { padding: '28px 32px', width: '620px' }), 110, 640, false);
      this.opt = this.q.querySelector('.o0');
      this.cur = place(h('div', 'cursor', ICON.cursor, root), 0, 0, false);
      this.rip = h('div', 'ripple', '', this.cur);
      this.arrow = place(h('div', 'abs', '→', root, { fontSize: '90px', color: '#38E1FF', textShadow: '0 0 30px #38E1FF' }), 875, 600);
      this.b2 = place(h('div', 'card glow', '<div class="lab cy">站在你的角度 · 第二版</div><div class="tx2" style="font-size:30px;line-height:1.7"></div><div class="acts" style="display:flex;gap:14px;margin-top:22px"><span class="pill p-cy">对照你的经历看岗位</span><span class="pill p-vi">准备面试要点</span></div>', root, { padding: '32px 36px', width: '820px' }), 990, 300, false);
      this.mem = place(h('div', 'pill p-vi', '＋ 记住：想找教育方向实习', root, { fontSize: '26px', padding: '12px 24px' }), 1400, 860);
    },
    frame(t) {
      pop(this.file, t, 0.1, 0.5);
      pop(this.b1, t, 0.5, 0.5, { back: false });
      typed(this.b1.querySelector('.tx'), '这是一家教育科技公司，主营 K12 课程与教研产品，正在招聘多个岗位。', P(t, 0.7, 2.2, E.lin));
      pop(this.q, t, 2.4, 0.6);
      const cp = P(t, 3.0, 3.8, E.inout);
      this.cur.style.transform = `translate(${L(700, 190, cp)}px,${L(950, 745, cp)}px)`;
      this.cur.style.opacity = P(t, 3.0, 3.2) * (1 - P(t, 5.2, 5.5));
      const click = P(t, 3.8, 4.4);
      tf(this.rip, { s: L(0.3, 1.6, click), o: click > 0 && click < 1 ? 1 - click : 0 });
      this.opt.style.background = t > 3.85 ? 'linear-gradient(135deg,#38E1FF,#8B5CF6)' : '';
      this.opt.style.borderColor = t > 3.85 ? 'transparent' : '';
      tf(this.arrow, { x: L(-30, 0, P(t, 4.0, 4.5)), o: P(t, 4.0, 4.4) });
      pop(this.b2, t, 4.2, 0.7, { dy: 40 });
      typed(this.b2.querySelector('.tx2'), '你说想找教育方向的实习：它有产品和教研两类实习岗，教研岗更看重家教经历。', P(t, 4.6, 6.6, E.lin));
      pop(this.mem, t, 7.0, 0.6);
    },
  };

  // ── s5 记忆自己长出来：回答与纠正汇入中心，长成可删除的记忆卡片 ──
  S.s5 = {
    chapter: ['05', '记忆自己长出来'],
    build(root) {
      this.svg = svgLayer(root);
      this.core = place(h('div', 'abs', logo(), root, { width: '150px', height: '150px' }), 960, 520);
      this.halo = place(h('div', 'abs', '', root, { width: '300px', height: '300px', borderRadius: '50%', background: 'radial-gradient(circle,rgba(139,92,246,.45),transparent 70%)' }), 960, 520);
      const inputs = [['我在找教育方向的实习', 330, 250], ['更正：我是项目成员，不是负责人', 330, 520], ['拍了一张获奖证书', 330, 790]];
      this.ins = inputs.map(([tx, x, y], i) => ({
        el: place(h('div', 'bubble b-me', tx, root, { fontSize: '26px', padding: '16px 24px', whiteSpace: 'nowrap' }), x, y),
        ln: line(this.svg, `M${x + 200} ${y} C${700} ${y} ${760} 520 ${880} 520`, { color: '#A78BFA' }),
        d: dot(this.svg, '#E9D5FF', 7), at: 0.4 + i * 0.7,
      }));
      const mems = [['意向', '教育方向实习', 'p-vi'], ['经历', '校园交友平台 · 项目成员', 'p-cy'], ['获奖', '省赛二等奖 · 2025', 'p-ok'], ['材料', '项目介绍 v2', 'p-cy'], ['意向', 'To B 教育创业', 'p-vi']];
      this.mems = mems.map(([k, v, c], i) => ({
        el: place(h('div', 'card', `<div style="display:flex;align-items:center;gap:14px"><span class="pill ${c}">${k}</span><span style="font-size:26px">${v}</span></div><div class="muted" style="font-size:18px;margin-top:10px;display:flex;gap:18px"><span>✎ 修改</span><span>⏸ 停用</span><span>🗑 删除</span><span style="margin-left:auto">↩ 来源</span></div>`, root, { padding: '18px 22px', width: '430px' }), 1530, 190 + i * 165),
        at: 2.4 + i * 0.45,
      }));
      this.cnt = h('div', 'abs', '', root, { left: '800px', top: '690px', width: '320px', textAlign: 'center', fontSize: '26px', color: '#C4B5FD' });
    },
    frame(t) {
      pop(this.core, t, 0.1, 0.6);
      tf(this.halo, { s: 1 + Math.sin(t * 3) * 0.08 + P(t, 2.4, 5) * 0.3, o: P(t, 0.1, 0.6) });
      this.ins.forEach(it => {
        pop(it.el, t, it.at, 0.5);
        it.ln.draw(P(t, it.at + 0.3, it.at + 0.9), 0.8);
        const dp = P(t, it.at + 0.6, it.at + 1.3, E.inout);
        along(it.ln, it.d, dp, dp > 0 && dp < 1 ? 1 : 0);
      });
      let n = 0;
      this.mems.forEach(m => { const p = pop(m.el, t, m.at, 0.6, { dy: 0, x: 0, s0: 0.6 }); if (t > m.at) n++; m.el.style.transform += ` translateX(${L(-120, 0, P(t, m.at, m.at + 0.6))}px)`; });
      this.cnt.textContent = n ? `记忆卡片 × ${n}` : '';
      this.cnt.style.opacity = P(t, 2.4, 2.8);
    },
  };

  // ── s6 主动发现：新通知扫描记忆图谱，相关节点被点亮并汇成提醒 ──
  S.s6 = {
    chapter: ['06', '亮点一 · 主动发现'],
    build(root) {
      this.svg = svgLayer(root);
      const nodes = [
        ['「校园交友平台」Idea', 520, 260, 1], ['To B 教育创业意向', 330, 470, 1], ['项目介绍 v2', 610, 640, 1], ['部分团队信息', 380, 830, 1],
        ['英语六级 · 2024', 830, 900, 0], ['课程作业：数据库', 170, 660, 0], ['家教经历', 180, 300, 0], ['社团：摄影协会', 800, 420, 0],
      ];
      this.nodes = nodes.map(([tx, x, y, hot], i) => ({
        el: place(h('div', 'chip', tx, root, { fontSize: '23px' }), x, y), x, y, hot, at: 0.2 + i * 0.12,
      }));
      this.edges = [[0, 1], [0, 2], [2, 3], [1, 6], [2, 5], [0, 7], [3, 4], [5, 6]].map(([a, b]) => {
        const A = nodes[a], B = nodes[b];
        return line(this.svg, `M${A[1]} ${A[2]} L${B[1]} ${B[2]}`, { color: 'rgba(140,160,220,.35)', w: 2, glow: false });
      });
      this.notice = place(fileCard(root, ['pdf', 'PDF', '2026 大学生创新创业大赛', '新通知 · 社会服务赛道']), 1450, 170, true);
      this.notice.classList.add('glow');
      this.beam = h('div', 'abs', '', root, { top: '120px', width: '6px', height: '860px', background: 'linear-gradient(180deg,transparent,#38E1FF,transparent)', boxShadow: '0 0 40px 10px rgba(56,225,255,.4)' });
      this.hot = this.nodes.filter(n => n.hot).map((n, i) => ({ n, ln: line(this.svg, `M${n.x + 120} ${n.y} C1000 ${n.y} 1050 560 1140 560`, { color: '#38E1FF' }), at: 4.2 + i * 0.25 }));
      this.alert = place(h('div', 'card glow', `
        <div class="lab cy" style="display:flex;align-items:center;gap:10px"><span style="width:26px;display:inline-block">${ICON.spark}</span>发现一项与你有关的活动</div>
        <div style="font-size:32px;font-weight:600;margin:4px 0 14px">大学生创新创业大赛 <span class="pill p-warn" style="font-size:20px;vertical-align:middle">截止 10月12日</span></div>
        <div style="font-size:24px;line-height:1.7;color:#CBD5F5">你的「校园交友平台」Idea 与本次赛道相关<br>你说过：“以后想做 To B 教育方向创业”</div>
        <div class="rows" style="margin-top:16px;font-size:24px;line-height:2">
          <div><span class="ok">✓</span> 已有：项目 Idea · 项目介绍 · 部分团队信息</div>
          <div><span class="muted">□</span> 还缺：商业计划书 · 项目 PPT · 指导老师</div>
        </div>`, root, { padding: '30px 36px', width: '700px' }), 1140, 360, false);
    },
    frame(t) {
      this.nodes.forEach(n => {
        pop(n.el, t, n.at, 0.5);
        const lit = n.hot ? P(t, 3.6, 4.1) : 0, dim = n.hot ? 0 : P(t, 3.6, 4.1);
        n.el.style.opacity = C(P(t, n.at, n.at + 0.3)) * (1 - dim * 0.65);
        n.el.style.borderColor = lit ? `rgba(56,225,255,${0.3 + lit * 0.7})` : '';
        n.el.style.boxShadow = lit ? `0 0 ${30 * lit}px rgba(56,225,255,.55)` : 'none';
        n.el.style.color = lit ? '#E6FBFF' : '';
      });
      this.edges.forEach((e, i) => e.draw(P(t, 0.8 + i * 0.1, 1.5 + i * 0.1), 1));
      pop(this.notice, t, 1.4, 0.6);
      const bp = P(t, 2.2, 3.8, E.inout);
      this.beam.style.left = L(1000, 90, bp) + 'px';
      this.beam.style.opacity = bp > 0 && bp < 1 ? 1 : 0;
      this.hot.forEach(x => x.ln.draw(P(t, x.at, x.at + 0.7)));
      pop(this.alert, t, 5.0, 0.7, { dy: 40 });
      [...this.alert.querySelectorAll('.rows > div')].forEach((d, i) => { const p = P(t, 6.2 + i * 0.5, 6.7 + i * 0.5); d.style.opacity = p; d.style.transform = `translateX(${L(-20, 0, p)}px)`; });
    },
  };
})();
