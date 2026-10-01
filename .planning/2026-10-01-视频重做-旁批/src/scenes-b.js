// 场景 7–12：可信复用、直接行动、不硬凑待办、团队组队、三层内核、结尾
(function () {
  const { C, E, P, L, h, place, tf, pop, typed, logo, ICON, fileCard, avatar, svgLayer, line, dot, along, vcurve, S } = K;

  // ── s7 可信复用：通知条款与材料逐项连线，往届获奖证明被拦下 ──
  S.s7 = {
    chapter: ['07', '亮点二 · 可信复用'],
    build(root) {
      this.svg = svgLayer(root);
      this.head = h('div', 'abs', '<span class="muted" style="font-size:24px;letter-spacing:3px">通知原文</span>', root, { left: '130px', top: '160px' });
      this.head2 = h('div', 'abs', '<span class="muted" style="font-size:24px;letter-spacing:3px">你的材料</span>', root, { left: '1180px', top: '160px' });
      const rules = ['第2条　近三年相关获奖证明', '第3条　项目介绍（不少于 1000 字）', '第4条　团队成员名单（本届签字）', '第5条　已获奖成果不得重复申报'];
      this.rules = rules.map((tx, i) => place(h('div', 'card', `<span style="font-size:26px">${tx}</span>`, root, { padding: '22px 28px', width: '560px' }), 130, 230 + i * 150, false));
      const mats = [
        ['省赛二等奖证书 · 2025', '✓ 可用', 'p-ok', 0],
        ['项目介绍 v2 · 6月', '✓ 可用', 'p-ok', 1],
        ['成员名单 · 去年版本', '△ 要处理：本届需重新签字', 'p-warn', 2],
        ['往届获奖证明 · 2024 国赛', '✗ 本次不能用', 'p-no', 3],
      ];
      this.mats = mats.map(([name, st, cls, ri], i) => {
        const y = 230 + i * 150;
        const el = place(h('div', 'card', `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px"><span style="font-size:26px">${name}</span><span class="pill ${cls}">${st}</span></div>`, root, { padding: '22px 28px', width: '640px' }), 1180, y, false);
        const ry = 230 + ri * 150 + 38, color = cls === 'p-ok' ? '#34D399' : cls === 'p-warn' ? '#FBBF24' : '#F87171';
        return { el, cls, ln: line(this.svg, `M690 ${ry} C930 ${ry} 940 ${y + 38} 1180 ${y + 38}`, { color }), at: 1.0 + i * 0.8 };
      });
      this.bad = this.mats[3];
      this.why = place(h('div', 'card', '<span class="no" style="font-size:24px">依据第5条：该成果已于 2024 年获奖，禁止重复申报</span><span class="muted" style="font-size:20px;margin-left:14px">↩ 原文</span>', root, { padding: '16px 24px', width: '700px', border: '1px solid rgba(248,113,113,.6)' }), 1120, 800, false);
      this.lock = place(h('div', 'abs', ICON.lock, root, { width: '64px', height: '64px', color: '#F87171' }), 1860, 718);
      this.note = h('div', 'title', '普通勾选解除不了 · 材料齐全 ≠ 资格通过', root, { top: '830px', left: '130px', right: 'auto', textAlign: 'left', fontSize: '26px', color: '#9AA8CC' });
    },
    frame(t) {
      pop(this.head, t, 0.1, 0.4, { back: false }); pop(this.head2, t, 0.1, 0.4, { back: false });
      this.rules.forEach((r, i) => pop(r, t, 0.2 + i * 0.15, 0.5, { back: false }));
      this.mats.forEach(m => {
        m.ln.draw(P(t, m.at, m.at + 0.6));
        const p = P(t, m.at + 0.3, m.at + 0.8);
        m.el.style.opacity = p; m.el.style.transform = `translateX(${L(40, 0, p)}px)`;
        const pill = m.el.querySelector('.pill'), pp = P(t, m.at + 0.6, m.at + 1.0, E.back);
        pill.style.transform = `scale(${L(0.4, 1, pp)})`; pill.style.opacity = P(t, m.at + 0.6, m.at + 0.8);
      });
      const shake = t > 4.0 && t < 4.6 ? Math.sin(t * 60) * 8 * (4.6 - t) : 0;
      const bp = P(t, 3.8, 4.3);
      this.bad.el.style.transform = `translateX(${shake}px)`;
      this.bad.el.style.boxShadow = bp ? `0 0 0 2px rgba(248,113,113,${bp}), 0 0 40px rgba(248,113,113,${0.4 * bp})` : '';
      this.bad.el.querySelector('span').style.textDecoration = t > 4.3 ? 'line-through' : 'none';
      const lp = P(t, 4.1, 4.6, E.back);
      tf(this.lock, { s: L(2, 1, lp), o: P(t, 4.1, 4.3) });
      pop(this.why, t, 4.6, 0.5, { back: false });
      pop(this.note, t, 6.2, 0.6, { back: false });
    },
  };

  // ── s8 直接行动：缺项飞入待办、起草初稿、导出日历 ──
  S.s8 = {
    chapter: ['08', '亮点三 · 直接行动'],
    build(root) {
      this.todo = place(h('div', 'card', '<div class="lab cy">待办</div>' + [
        ['起草商业计划书', '10月5日'], ['制作项目 PPT', '10月8日'], ['成员名单重新签字', '10月9日'], ['确认指导老师', '10月10日'], ['提交报名', '10月12日'],
      ].map(([a, d]) => `<div class="it" style="display:flex;justify-content:space-between;align-items:center;font-size:26px;padding:12px 0;border-top:1px solid rgba(255,255,255,.08)"><span><span class="bx" style="display:inline-block;width:26px;height:26px;border:2px solid #8E9CC2;border-radius:7px;margin-right:14px;vertical-align:-4px"></span>${a}</span><span class="pill p-warn" style="font-size:19px">${d}</span></div>`).join(''), root, { padding: '28px 32px', width: '560px' }), 120, 190, false);
      this.draft = place(h('div', 'card', '<div class="lab vi">项目简介 · 模型初稿，待你确认</div><div class="tx" style="font-size:25px;line-height:1.75;color:#DCE3FA"></div><div class="src muted" style="font-size:19px;margin-top:14px">依据：项目介绍 v2 · 获奖证书 · 你的意向</div>', root, { padding: '28px 32px', width: '620px', height: '470px' }), 740, 190, false);
      this.cal = place(h('div', 'card', `<div class="lab ok">导出</div><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin:10px 0 18px">${Array.from({ length: 21 }, (_, i) => `<div class="d" style="height:40px;border-radius:8px;background:rgba(255,255,255,.06);font-size:16px;display:flex;align-items:center;justify-content:center;color:#8E9CC2">${i + 1}</div>`).join('')}</div><div style="display:flex;gap:12px"><span class="pill p-ok">📅 日历 .ics</span><span class="pill p-cy">📝 清单 .md</span></div>`, root, { padding: '28px 30px', width: '420px' }), 1400, 190, false);
      this.guard = h('div', 'title', '不替你提交 · 不代签字 · 不编造经历', root, { top: '740px', fontSize: '30px', color: '#9AA8CC' });
    },
    frame(t) {
      pop(this.todo, t, 0.2, 0.6, { back: false });
      [...this.todo.querySelectorAll('.it')].forEach((it, i) => {
        const a = 0.6 + i * 0.35, p = P(t, a, a + 0.5);
        it.style.opacity = p; it.style.transform = `translateX(${L(-40, 0, p)}px)`;
      });
      pop(this.draft, t, 2.2, 0.6, { back: false });
      typed(this.draft.querySelector('.tx'), '「校园交友平台」面向高校学生，以兴趣与课程为纽带连接同伴。项目已完成需求调研与原型设计，获 2025 年省级创新赛二等奖。本届将拓展至社会服务方向……', P(t, 2.6, 6.6, E.lin));
      this.draft.querySelector('.src').style.opacity = P(t, 6.4, 6.9);
      pop(this.cal, t, 3.4, 0.6, { back: false });
      [...this.cal.querySelectorAll('.d')].forEach((d, i) => {
        const on = [4, 7, 8, 9, 11].includes(i) && t > 4.0 + i * 0.12;
        d.style.background = on ? 'linear-gradient(135deg,#34D399,#0EA5E9)' : 'rgba(255,255,255,.06)';
        d.style.color = on ? '#04111A' : '#8E9CC2';
      });
      const bx = this.todo.querySelector('.bx');
      const done = t > 7.6;
      bx.style.background = done ? '#34D399' : 'transparent'; bx.style.borderColor = done ? '#34D399' : '#8E9CC2';
      pop(this.guard, t, 7.8, 0.6, { back: false });
    },
  };

  // ── s9 不硬凑待办：不同文件，不同回应 ──
  S.s9 = {
    chapter: ['09', '不是每份文件都要你做什么'],
    build(root) {
      const cols = [
        [['pdf', 'PDF', '创新创业大赛通知', ''], '<span class="pill p-cy">3 项待办</span><div style="font-size:24px;margin-top:14px;line-height:1.6">告诉你下一步</div>'],
        [['doc', 'DOC', '公司规章制度', ''], '<span class="pill p-vi">2 条与你有关</span><div style="font-size:24px;margin-top:14px;line-height:1.6">试用期请假需提前 3 天</div>'],
        [['pdf', 'PDF', '行业白皮书', ''], '<span class="pill" style="border:1px solid rgba(255,255,255,.3);color:#C7D0EA">跟你关系不大</span><div style="font-size:24px;margin-top:14px;line-height:1.6">没有要做的，就直说</div>'],
      ];
      this.cols = cols.map(([f, resp], i) => {
        const x = 380 + i * 580;
        const file = place(fileCard(root, f), x, 330); file.style.width = '440px';
        const r = place(h('div', 'card', resp, root, { padding: '28px 30px', width: '440px', textAlign: 'center' }), x, 640);
        const ar = place(h('div', 'abs', '↓', root, { fontSize: '56px', color: '#6B7AA6' }), x, 480);
        return { file, r, ar, at: 0.3 + i * 1.3 };
      });
      this.tip = h('div', 'title h3', '回应由「这份文件 × 你」共同决定', root, { top: '800px' });
    },
    frame(t) {
      this.cols.forEach(c => { pop(c.file, t, c.at, 0.5); pop(c.ar, t, c.at + 0.4, 0.4, { back: false, dy: -20 }); pop(c.r, t, c.at + 0.7, 0.6); });
      pop(this.tip, t, 4.8, 0.6, { back: false });
    },
  };

  // ── s10 团队版：能力名片汇入汇集 Agent，推荐分工并指出缺口 ──
  S.s10 = {
    chapter: ['10', '团队版 · 临时组队'],
    build(root) {
      this.svg = svgLayer(root);
      const ppl = [
        ['小王', '#60A5FA,#2563EB', ['2 个 React 项目', '想做教育方向']],
        ['小李', '#F472B6,#BE185D', ['写过商业计划书', '擅长表达']],
        ['小陈', '#34D399,#047857', ['调过大模型 API']],
        ['小赵', '#FBBF24,#B45309', ['做过 PPT 设计']],
        ['小周', '#A78BFA,#6D28D9', ['名片还是空的']],
      ];
      this.ppl = ppl.map(([n, g, tags], i) => {
        const y = 175 + i * 148;
        const card = place(h('div', 'card', `<div style="display:flex;align-items:center;gap:18px"><div class="avatar" style="width:74px;height:74px;background:linear-gradient(135deg,${g})">${ICON.user}</div><div><div style="font-size:26px;font-weight:600">${n}</div><div style="display:flex;gap:8px;margin-top:8px;flex-wrap:nowrap">${tags.map(x => `<span class="pill ${i === 4 ? '' : 'p-cy'}" style="font-size:18px;${i === 4 ? 'border:1px dashed rgba(255,255,255,.35);color:#8E9CC2' : ''}">${x}</span>`).join('')}</div></div></div>`, root, { padding: '16px 22px', width: '440px' }), 80, y - 60, false);
        return { card, ln: line(this.svg, `M520 ${y} C660 ${y} 680 540 800 540`, { color: '#38E1FF', w: 2 }), d: dot(this.svg, '#BFF3FF', 6), at: 0.2 + i * 0.25, y };
      });
      this.hub = place(h('div', 'card glow', `<div style="width:110px;height:110px;margin:0 auto">${logo()}</div><div style="font-size:28px;font-weight:600;margin-top:12px">汇集 Agent</div><div class="muted" style="font-size:20px;margin-top:4px">只看授权的名片</div>`, root, { padding: '28px 34px', textAlign: 'center' }), 920, 540);
      const blocks = [['产品原型', '小王', '做过 2 个 React 项目'], ['商业计划书', '小李', '写过商业计划书'], ['模型接入', '小陈', '调过大模型 API'], ['路演 PPT', '小赵', '做过 PPT 设计']];
      this.blocks = blocks.map(([b, who, why], i) => {
        const y = 200 + i * 150;
        const el = place(h('div', 'card', `<div style="display:flex;justify-content:space-between;align-items:center"><span style="font-size:27px;font-weight:600">${b}</span><span class="pill p-cy">推荐 ${who}</span></div><div class="muted" style="font-size:19px;margin-top:8px">理由：${why} · <span style="color:#A5B4FC">接受 / 互换 / 拒绝</span></div>`, root, { padding: '18px 24px', width: '560px' }), 1280, y - 44, false);
        return { el, ln: line(this.svg, `M1040 540 C1150 540 1170 ${y} 1280 ${y}`, { color: '#8B5CF6', w: 2 }), at: 3.4 + i * 0.4 };
      });
      this.gap = place(h('div', 'card', '<span class="warn" style="font-size:26px">⚠ 缺口：队里没人做过用户访谈</span>', root, { padding: '18px 24px', width: '560px', border: '1px solid rgba(251,191,36,.5)' }), 1280, 790, false);
      this.ask = place(h('div', 'bubble b-ai', '<span class="cy">按需问一句：</span>小周，这块要做访谈，你之前做过类似的吗？', root, { fontSize: '22px', padding: '14px 20px', width: '430px' }), 90, 862, false);
      this.slogan = place(h('div', 'pill p-vi', '它是队友，不是监工', root, { fontSize: '30px', padding: '14px 30px' }), 920, 770);
    },
    frame(t) {
      this.ppl.forEach(p => {
        const q = P(t, p.at, p.at + 0.5); p.card.style.opacity = q; p.card.style.transform = `translateX(${L(-40, 0, q)}px)`;
        p.ln.draw(P(t, p.at + 0.9, p.at + 1.6), 0.7);
        const dp = P(t, p.at + 1.4, p.at + 2.2, E.inout); along(p.ln, p.d, dp, dp > 0 && dp < 1 ? 1 : 0);
      });
      pop(this.hub, t, 1.2, 0.7);
      this.blocks.forEach(b => { b.ln.draw(P(t, b.at, b.at + 0.5)); const q = P(t, b.at + 0.3, b.at + 0.8); b.el.style.opacity = q; b.el.style.transform = `translateX(${L(40, 0, q)}px)`; });
      pop(this.gap, t, 5.6, 0.6);
      // 零记忆的小周被按需问一句，名片当场变丰富
      const last = this.ppl[4].card, fill = t > 8.2;
      const tag = last.querySelector('.pill');
      if (fill !== last._f) { last._f = fill; tag.textContent = fill ? '辩论队 · 做过校园采访' : '名片还是空的'; tag.className = 'pill ' + (fill ? 'p-ok' : ''); tag.style.cssText = fill ? 'font-size:18px' : 'font-size:18px;border:1px dashed rgba(255,255,255,.35);color:#8E9CC2'; }
      last.style.boxShadow = fill ? `0 0 ${40 * (1 - P(t, 8.2, 9.5))}px rgba(52,211,153,.7)` : '';
      pop(this.ask, t, 6.6, 0.6, { back: false });
      this.ask.style.opacity = C(P(t, 6.6, 7.0)) * (1 - P(t, 11.2, 11.6));
      pop(this.slogan, t, 9.6, 0.6);
    },
  };

  // ── s11 三层内核：个人 → 团队 → 企业 同心扩展 ──
  S.s11 = {
    chapter: ['11', '同一个内核'],
    build(root) {
      const rings = [['个人', '跟我有什么关系', 320, '#38E1FF'], ['团队', '谁做哪块最合适', 540, '#8B5CF6'], ['企业', '路线图', 760, '#F472B6']];
      this.rings = rings.map(([n, d, size, c], i) => ({
        el: place(h('div', 'abs', '', root, { width: size + 'px', height: size + 'px', borderRadius: '50%', border: `2px solid ${c}`, boxShadow: `0 0 40px ${c}55, inset 0 0 60px ${c}22` }), 960, 500),
        lab: place(h('div', 'abs', `<div style="font-size:34px;font-weight:600;color:${c}">${n}</div><div class="muted" style="font-size:22px;margin-top:4px">${d}</div>`, root, { textAlign: 'center', width: '300px' }), 960, 500 - size / 2 + 58),
        at: 0.3 + i * 0.9,
      }));
      this.rings[0].lab.style.top = '500px';
      this.core = place(h('div', 'abs', '', root, { width: '4px', height: '4px' }), 960, 520);
      const words = ['读懂事务', '了解人', '协助完成'];
      this.words = words.map((w, i) => place(h('div', 'chip', w, root, { fontSize: '30px', padding: '14px 30px', background: 'rgba(10,14,28,.85)' }), 300, 380 + i * 120));
    },
    frame(t) {
      this.rings.forEach((r, i) => {
        const p = P(t, r.at, r.at + 1.0, E.back);
        tf(r.el, { s: L(0.2, 1, p) * (1 + Math.sin(t * 2 + i) * 0.01), o: P(t, r.at, r.at + 0.5) });
        pop(r.lab, t, r.at + 0.4, 0.6, { back: false });
      });
      this.rings[0].lab.style.transform = `translate(-50%,-50%) scale(${L(0.8, 1, P(t, 0.7, 1.2))})`;
      this.words.forEach((w, i) => pop(w, t, 3.6 + i * 0.6, 0.6));
    },
  };

  // ── s12 结尾：品牌与口号 ──
  S.s12 = {
    chapter: ['', ''],
    build(root) {
      this.logo = place(h('div', 'abs', logo(), root, { width: '180px', height: '180px' }), 960, 360);
      this.name = h('div', 'title', 'DoAgent', root, { top: '480px', fontSize: '110px', fontWeight: 700 });
      this.name.classList.add('grad');
      this.slogan = h('div', 'title h2', '每份文件，都从你的角度读一遍', root, { top: '650px' });
      this.meta = h('div', 'title', '西客松 XiHack 2026 · AI 软件应用赛道　|　演示资料均为合成数据', root, { top: '800px', fontSize: '24px', color: '#7C89AE' });
    },
    frame(t) {
      const lp = P(t, 0.1, 0.9, E.back); tf(this.logo, { s: L(0.4, 1, lp), o: P(t, 0.1, 0.5), r: Math.sin(t * 1.5) * 3 });
      const np = P(t, 0.5, 1.3); tf(this.name, { y: L(30, 0, np), o: np, blur: L(10, 0, np) });
      pop(this.slogan, t, 1.2, 0.7, { back: false });
      pop(this.meta, t, 2.0, 0.6, { back: false });
    },
  };
})();
