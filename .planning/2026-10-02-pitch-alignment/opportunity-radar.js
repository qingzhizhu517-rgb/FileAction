/* 机会雷达：进入视口后自动播放本地合成关联示例，不上传或处理真实文件。 */
'use strict';

(() => {
  const scene = document.querySelector('.opportunity-scene');
  if (!scene) return;
  const panel = scene.querySelector('.opportunity-sticky');
  const stage = scene.querySelector('.radar-stage');
  const map = scene.querySelector('.radar-map');
  const notice = scene.querySelector('.radar-notice');
  const sweep = scene.querySelector('.radar-sweep');
  const scan = scene.querySelector('.radar-scan');
  const result = scene.querySelector('.radar-result');
  const rows = [...result.querySelectorAll('.radar-result-row')];
  const next = scene.querySelector('.radar-next');
  const buttons = [...scene.querySelectorAll('[data-radar-case]')];
  const memories = [...scene.querySelectorAll('[data-radar-memory]')];
  const links = [...scene.querySelectorAll('[data-radar-line]')];
  const steps = [...scene.querySelectorAll('[data-radar-step]')];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const compact = window.matchMedia('(max-width: 900px)');
  const clamp = value => Math.max(0, Math.min(1, value));
  const smooth = value => value * value * (3 - 2 * value);
  const phase = (progress, start, length) => smooth(clamp((progress - start) / length));
  // 示例分别说明 Idea、获奖经历、求职意向的关联，不把无关背景强行匹配。
  const examples = {
    competition: {
      notice: '大学生创新创业大赛', detail: ['社会服务赛道', '寻找回应真实需求的项目'],
      title: ['你存下的地图构想，', '遇到了合适的赛道。'],
      reason: '无障碍地图关注校园出行需求，与通知中的“社会服务”赛道方向相关。',
      evidence: '依据：已保存构想 × 通知 § 2',
      ready: ['校园无障碍地图 Idea', '已确认的项目介绍 v2'],
      missing: ['缺：本次参赛简介', '待更新：本届签字名单'],
      caution: '往届获奖成果本次不能重复申报（通知 § 5）。',
      next: '看看已有材料怎么用',
      memories: [
        ['校园无障碍地图', '社会服务赛道相关', 'match'],
        ['往届获奖成果', '本次不能重复申报', 'caution'],
        ['想找教育方向实习', '与本次竞赛无直接关联', 'idle'],
        ['项目介绍 v2', '已有内容可用于起草', 'match'],
      ],
    },
    scholarship: {
      notice: '本年度奖学金申报', detail: ['成绩与综合测评条件', '核对相关支撑材料'],
      title: ['你留下的获奖记录，', '连到了新的申请。'],
      reason: '竞赛获奖经历可作为这次申请的支撑线索；成绩排名 6 / 120 符合示例的成绩条件。',
      evidence: '依据：获奖记录、成绩单 × 通知 § 2',
      ready: ['学年成绩单 · 6 / 120', '已关联的竞赛获奖证书'],
      missing: ['缺：综合测评排名证明', '待核实：证书认定范围'],
      caution: '证书已关联不等于本次可用；综测排名仍需确认。',
      next: '看看材料如何核对',
      memories: [
        ['校园无障碍地图', '不直接证明申请条件', 'idle'],
        ['竞赛获奖记录', '关联支撑材料，范围待核', 'match'],
        ['想找教育方向实习', '与本次申请无直接关联', 'idle'],
        ['学年成绩单', '已知排名 6 / 120', 'match'],
      ],
    },
    internship: {
      notice: '教育科技公司实习', detail: ['产品与教研方向', '需求调研与用户反馈'],
      title: ['你说过的求职意向，', '遇到了相关的岗位。'],
      reason: '你想找教育方向实习；岗位包含需求调研，与你已有的校园产品调研经历相连。',
      evidence: '依据：已确认意向、项目经历 × 岗位职责',
      ready: ['教育方向求职意向', '校园产品调研经历'],
      missing: ['待更新：岗位版简历', '待确认：到岗时间与时长'],
      caution: '经历匹配只是线索；是否投递仍由你决定。',
      next: '继续探索完整 Demo',
      memories: [
        ['校园无障碍地图', '可回看项目调研过程', 'match'],
        ['往届获奖成果', '奖项不直接代表岗位匹配', 'idle'],
        ['想找教育方向实习', '与你确认过的意向相关', 'match'],
        ['校园产品调研经历', '对应岗位的需求调研职责', 'match'],
      ],
    },
  };
  const duration = 5200;
  let paused = document.documentElement.classList.contains('motion-paused');
  let progress = 0;
  let elapsed = 0;
  let lastTick = null;
  let visible = false;
  let drawFrame = 0;
  let visibilityFrame = 0;
  let measureFrame = 0;
  let lastDrawn = -1;
  let mapShift = 0;

  function lines(element, values) {
    element.replaceChildren();
    values.forEach((value, index) => {
      if (index) element.append(document.createElement('br'));
      element.append(document.createTextNode(value));
    });
  }
  function list(element, values) {
    element.replaceChildren(...values.map(value => {
      const item = document.createElement('li');
      item.textContent = value;
      return item;
    }));
  }
  function selectExample(key) {
    if (!examples[key]) return;
    stopPlayback();
    elapsed = reduced.matches ? duration : 0;
    progress = reduced.matches ? 1 : 0;
    const data = examples[key];
    scene.dataset.radarCase = key;
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.radarCase === key)));
    scene.querySelector('#radar-notice-title').textContent = data.notice;
    lines(scene.querySelector('#radar-notice-detail'), data.detail);
    lines(scene.querySelector('#radar-result-title'), data.title);
    scene.querySelector('#radar-reason').textContent = data.reason;
    scene.querySelector('#radar-evidence').textContent = data.evidence;
    list(scene.querySelector('#radar-ready'), data.ready);
    list(scene.querySelector('#radar-missing'), data.missing);
    scene.querySelector('#radar-caution').textContent = data.caution;
    next.setAttribute('href', key === 'internship' ? '#closing' : '#trusted-reuse');
    next.replaceChildren(document.createTextNode(`${data.next} `));
    const arrow = document.createElement('span');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '↗';
    next.append(arrow);
    memories.forEach((memory, index) => {
      const [title, description, relevance] = data.memories[index];
      memory.querySelector('strong').textContent = title;
      memory.querySelector('small').textContent = description;
      memory.dataset.relevance = relevance;
      links[index].dataset.relevance = relevance;
    });
    measure();
  }

  function draw(force = false) {
    if (!force && Math.abs(progress - lastDrawn) < .00001) return;
    lastDrawn = progress;
    const arrival = phase(progress, 0, .18);
    const outcome = phase(progress, .57, .2);
    const compactView = compact.matches && !reduced.matches;
    const mapOpacity = compactView ? 1 - phase(progress, .59, .14) : 1;
    map.style.opacity = mapOpacity.toFixed(4);
    map.style.visibility = mapOpacity === 0 ? 'hidden' : 'visible';
    map.style.transform = compactView
      ? `translateY(${-outcome * 22}px) scale(${1 - outcome * .06})`
      : `translateX(${(1 - outcome) * mapShift}px)`;
    const arrivalDistance = compact.matches ? -10 : -48;
    const arrivalAngle = compact.matches ? -3 : -9;
    notice.style.transform = `translateY(${(1 - arrival) * arrivalDistance}px) rotate(${(1 - arrival) * arrivalAngle}deg) scale(${.94 + arrival * .06})`;
    const scanning = phase(progress, .12, .38);
    const scanOpacity = reduced.matches ? 0 : Math.sin(Math.PI * scanning) * .85;
    sweep.style.opacity = scanOpacity.toFixed(4);
    sweep.style.setProperty('--radar-angle', `${scanning * 430 - 100}deg`);
    scan.style.opacity = scanOpacity.toFixed(4);
    scan.style.top = `${scanning * 100}%`;
    memories.forEach((memory, index) => {
      const light = phase(progress, .18 + index * .055, .18);
      const linked = memory.dataset.relevance !== 'idle';
      memory.style.opacity = (.24 + light * (linked ? .76 : .3)).toFixed(4);
      memory.style.transform = `translateY(${(1 - light) * (index < 2 ? -12 : 12)}px) scale(${.94 + light * .06})`;
      memory.style.setProperty('--memory-light', light.toFixed(4));
      memory.querySelector('small').style.visibility = light === 0 ? 'hidden' : 'visible';
      links[index].style.opacity = light.toFixed(4);
      links[index].style.setProperty('--radar-dash', String((1 - light) * 100));
    });
    const reveal = phase(progress, compactView ? .70 : .59, compactView ? .13 : .18);
    result.style.opacity = reveal.toFixed(4);
    result.style.visibility = reveal === 0 ? 'hidden' : 'visible';
    result.style.transform = `translate(${compactView ? 0 : (1 - reveal) * 40}px, ${(1 - reveal) * 18}px) scale(${.97 + reveal * .03})`;
    rows.forEach((row, index) => {
      const shown = phase(progress, .63 + index * .043, .11);
      row.style.opacity = shown.toFixed(4);
      row.style.transform = `translateY(${(1 - shown) * 12}px)`;
      row.style.visibility = shown === 0 ? 'hidden' : 'visible';
    });
    next.inert = !reduced.matches && progress < .96;
    scene.querySelector('.radar-notice-status').textContent = progress < .18 ? '新通知进入 · 自动演示' : progress < .55 ? '正在唤起已有背景' : '关联线索已展开';
    const current = progress < .18 ? 0 : progress < .64 ? 1 : 2;
    steps.forEach((step, index) => {
      step.classList.toggle('is-current', current === index);
      if (current === index) step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });
    scene.querySelector('.radar-scroll-hint').textContent = reduced.matches ? '从你的角度，发现新的可能' : progress === 1 ? '点击通知可重播，或继续向下探索 ↓' : '自动演示中，让关联一点点亮起';
    scene.style.setProperty('--radar-progress', progress.toFixed(4));
    scene.dataset.radarProgress = progress.toFixed(4);
    scene.dataset.radarPhase = ['arrival', 'connecting', 'opportunity'][current];
  }

  function measure() {
    measureFrame = 0;
    scene.classList.toggle('radar-enabled', !reduced.matches);
    const header = document.querySelector('.nav-wrap').offsetHeight + 1;
    scene.style.setProperty('--radar-header', `${header}px`);
    const available = Math.max(240, window.innerHeight - header);
    const resultHeight = result.offsetHeight;
    const minimumStage = compact.matches ? (available < 560 ? 370 : 400) : 438;
    const stageHeight = Math.ceil(Math.max(minimumStage, resultHeight));
    scene.style.setProperty('--radar-stage-height', `${stageHeight}px`);
    // 动态模式下手机在同一舞台交接星图与结果；静态模式则顺序展开。
    if (!compact.matches) stage.style.height = `${stageHeight}px`;
    else stage.style.removeProperty('height');
    mapShift = (stage.clientWidth - map.clientWidth) / 2;
    const width = map.clientWidth;
    const height = map.clientHeight;
    scene.querySelector('.radar-links').setAttribute('viewBox', `0 0 ${width} ${height}`);
    memories.forEach((memory, index) => {
      const x1 = notice.offsetLeft, y1 = notice.offsetTop;
      const x2 = memory.offsetLeft, y2 = memory.offsetTop;
      const bend = index % 2 ? 35 : -35;
      const d = `M${x1},${y1} Q${(x1 + x2) / 2 + bend},${(y1 + y2) / 2} ${x2},${y2}`;
      links[index].querySelectorAll('path').forEach(path => path.setAttribute('d', d));
    });
    draw(true);
    updateVisibility();
  }
  function stopPlayback() {
    cancelAnimationFrame(drawFrame);
    drawFrame = 0;
    lastTick = null;
  }
  function canPlay() {
    return visible && !paused && !reduced.matches && !document.hidden && progress < 1;
  }
  function tick(now) {
    drawFrame = 0;
    if (!canPlay()) { syncPlayback(); return; }
    if (lastTick !== null) elapsed += now - lastTick;
    lastTick = now;
    progress = clamp(elapsed / duration);
    draw();
    if (progress < 1) drawFrame = requestAnimationFrame(tick);
    else { lastTick = null; scene.dataset.radarPlayback = 'complete'; }
  }
  function syncPlayback() {
    if (reduced.matches) {
      stopPlayback();
      elapsed = duration;
      progress = 1;
      draw(true);
      scene.dataset.radarPlayback = 'static';
    } else if (canPlay()) {
      scene.dataset.radarPlayback = 'playing';
      if (!drawFrame) drawFrame = requestAnimationFrame(tick);
    } else {
      stopPlayback();
      scene.dataset.radarPlayback = progress === 1 ? 'complete' : paused || document.hidden ? 'paused' : 'waiting';
    }
  }
  function updateVisibility() {
    visibilityFrame = 0;
    const rect = stage.getBoundingClientRect();
    const header = document.querySelector('.nav-wrap').getBoundingClientRect().bottom;
    // 画板刚露出一小段就开播；滚动仅判断可见性，不控制时间线。
    visible = Math.min(rect.bottom, innerHeight) - Math.max(rect.top, header) >= Math.min(96, rect.height * .2);
    syncPlayback();
  }
  function queueVisibility() {
    if (!visibilityFrame) visibilityFrame = requestAnimationFrame(updateVisibility);
  }
  function queueMeasure() {
    if (!measureFrame) measureFrame = requestAnimationFrame(measure);
  }
  buttons.forEach((button, index) => {
    button.disabled = false;
    button.addEventListener('click', () => {
      selectExample(button.dataset.radarCase);
    });
    button.addEventListener('keydown', event => {
      const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!delta && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      const target = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + delta + buttons.length) % buttons.length;
      buttons[target].focus({ preventScroll: true });
      selectExample(buttons[target].dataset.radarCase);
    });
  });
  window.addEventListener('scroll', queueVisibility, { passive: true });
  window.addEventListener('resize', queueMeasure, { passive: true });
  window.addEventListener('pageshow', queueMeasure);
  reduced.addEventListener('change', queueMeasure);
  document.addEventListener('motionpreferencechange', event => {
    paused = event.detail.paused;
    syncPlayback();
  });
  document.addEventListener('visibilitychange', () => {
    syncPlayback();
    if (!document.hidden) queueMeasure();
  });
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(queueMeasure);
    [panel, result, scene.querySelector('.radar-cases'), document.querySelector('.organize-scene'), document.querySelector('.hero-scroll'), document.querySelector('.nav-wrap')].forEach(element => { if (element) observer.observe(element); });
  }
  selectExample('competition');
  document.fonts?.ready.then(queueMeasure);
})();
