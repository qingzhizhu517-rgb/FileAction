// 受控 TXT 规则模拟：没有模型调用、OCR、网络请求或文件指令执行。
import { DEMO_DATE } from './fixtures.mjs';

const FORMAT = '行动事务演示TXT-v1';
const STATES = Object.freeze({ unchecked:'未检查', candidate:'可引用候选', update:'需更新/确认', absent:'本次未找到', banned:'不可用于本次', unknown:'无法判断' });
const RULES = [
  ['R1', '在读身份', '在读证明'],
  ['R2', '项目经历', '项目经历'],
  ['R3', '本期签字成员名单', '成员名单'],
  ['R4', '代表成果证明', '代表成果'],
  ['R5', '本期指导老师确认书', '指导老师确认书'],
  ['R6', '特殊身份补充材料', '特殊身份补充材料']
];
const MATERIAL_FIELDS = {
  在读证明:['在读状态','有效至'],
  项目经历:['角色','项目名称','经历'],
  成员名单:['期次','签字状态','成员'],
  代表成果:['成果名称','已申报期次','使用记录'],
  指导老师确认书:['期次','指导老师','确认状态'],
  特殊身份补充材料:['身份分支','证据说明']
};

function invalid(message) { throw new Error(`${message} 请使用下载区的受控 TXT 样本格式，或保留为待核实资料；本演示不会补成预置答案。`); }
function dateValue(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(`${label}须为有效的 YYYY-MM-DD 日期。`);
  const stamp = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(stamp.getTime()) || stamp.toISOString().slice(0,10) !== value) invalid(`${label}不是有效日期。`);
  return value;
}
function need(fields, names) {
  for (const name of names) if (!fields[name]) invalid(`缺少“${name}”字段，无法完整读取受控格式。`);
}
function evidenceAt(data, lineStart, lineEnd = lineStart) {
  return { sourceId:data.id, filename:data.filename, version:data.version, lineStart, lineEnd, text:data.text.split('\n').slice(lineStart - 1,lineEnd).join('\n') };
}
function fieldName(line) {
  const position = line.indexOf('：');
  return position < 1 ? '' : line.slice(0,position).trim();
}
function fieldEvidence(data, names) {
  const lines = data.text.split('\n');
  return names.flatMap((name) => {
    const index = lines.findIndex((line) => fieldName(line) === name);
    return index < 0 ? [] : [evidenceAt(data,index + 1)];
  });
}
function periodList(value) {
  const periods = value.split(/[、，,]/).map((part) => part.trim());
  if (periods.some((period) => !/^第[零〇一二三四五六七八九十百千万0-9]+期$/.test(period))) invalid('申报期次不符合受控格式；请列明“第一期”等具体期次，使用史不明时写“未知”或“待确认”。');
  return [...new Set(periods)];
}

function parseRequirements(data, lines) {
  const rawRules = lines.flatMap((line,index) => /^R\d+｜/.test(line) ? [{line,index}] : []);
  if (rawRules.length !== RULES.length) invalid('通知须完整包含 R1 至 R6 六项受控规则。');
  return RULES.map(([id,title,kind]) => {
    const matching = rawRules.filter(({line}) => line.startsWith(`${id}｜`));
    if (matching.length !== 1) invalid(`${id} 规则缺失或重复。`);
    const {line,index} = matching[0];
    const split = line.split('｜');
    if (split.length !== 3 || split[1] !== title) invalid(`${id} 规则格式或标题不受支持。`);
    const quote = split[2];
    const requirement = { id,title,kind,quote,evidence:evidenceAt(data,index + 1) };
    let supported = false;
    if (id === 'R1') {
      supported = quote === `须提供有效期不早于${data.deadline}的在读证明。`;
      requirement.validThrough = data.deadline;
    } else if (id === 'R2') {
      supported = quote === '须提供本人角色为项目负责人或项目成员的项目经历说明。';
      requirement.allowedRoles = ['项目负责人','项目成员'];
    } else if (id === 'R3') {
      supported = quote === `须提供${data.period}成员名单，且签字状态为全员签字。`;
      requirement.period = data.period;
    } else if (id === 'R4') {
      const match = quote.match(/^须提供代表成果证明；([^。；]+)已申报成果不得重复用于([^。；]+)。$/);
      supported = Boolean(match && match[2] === data.period) || quote === '须提供代表成果证明；本期无往期重复申报限制。';
      requirement.excludedPeriods = match ? periodList(match[1]) : [];
    } else if (id === 'R5') {
      supported = quote === `须提供${data.period}指导老师确认书。`;
      requirement.period = data.period;
    } else if (id === 'R6') {
      supported = quote === '特殊身份材料按附件A核对；附件A未提供时无法判断。';
      requirement.attachment = '附件A';
    }
    if (!supported) invalid(`${id} 规则超出当前受控语法，不能按旧规则判断。`);
    return requirement;
  });
}

export function parseFile(text, filename = '未命名.txt') {
  if (typeof filename !== 'string' || !/\.txt$/i.test(filename)) invalid('本演示只读取 UTF-8 TXT 文件，不支持 PDF 或其他格式。');
  if (typeof text !== 'string' || !text.trim()) invalid('文件内容为空，无法读取受控格式。');
  if (new TextEncoder().encode(text).length > 100 * 1024) invalid('文件超过 100 KB 的演示上限。');
  text = text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
  const lines = text.split('\n');
  if (!lines[0].startsWith('【演示合成资料】')) invalid('文件缺少演示合成资料标识。');
  const fields = Object.create(null);
  for (const [index,line] of lines.entries()) {
    if (!line.trim() || index === 0 || /^R\d+｜/.test(line)) continue;
    const position = line.indexOf('：');
    if (position < 1) invalid(`第 ${index + 1} 行不符合“字段：内容”的受控格式。`);
    const key = line.slice(0,position).trim();
    const value = line.slice(position + 1).trim();
    if (Object.hasOwn(fields,key)) invalid(`第 ${index + 1} 行字段“${key}”重复，不能自动选一个事实。`);
    fields[key] = value;
  }
  need(fields,['资料格式','类型','编号','版本','标题']);
  if (fields.资料格式 !== FORMAT) invalid('不支持该资料格式版本。');
  if (!/^[NP][A-Za-z0-9_-]{1,30}$/.test(fields.编号)) invalid('编号须以 N 或 P 开头并使用字母、数字、下划线或连字符。');
  if (!/^[1-9]\d{0,5}$/.test(fields.版本)) invalid('版本须为正整数。');
  const data = { id:fields.编号,title:fields.标题,filename,version:Number(fields.版本),text,fields:{...fields} };
  if (fields.类型 === '通知') {
    need(fields,['期次','发布日期','截止日期','渠道','适用分支','附件A']);
    if (!data.id.startsWith('N')) invalid('通知编号须以 N 开头。');
    if (fields.附件A !== '未提供') invalid('本演示没有附件A解析器，不能把附件声称为已检查。');
    data.period = fields.期次;
    data.deadline = dateValue(fields.截止日期,'截止日期');
    data.publishedAt = dateValue(fields.发布日期,'发布日期');
    if (data.publishedAt > data.deadline) invalid('发布日期晚于截止日期，需先核实通知。');
    data.channel = fields.渠道;
    data.branch = fields.适用分支;
    data.attachmentAvailable = false;
    data.source = { id:data.id,filename,version:data.version,text };
    data.requirements = parseRequirements(data,lines);
    return {kind:'notice',data};
  }
  if (fields.类型 !== '材料') invalid('类型须为“通知”或“材料”。');
  if (!data.id.startsWith('P')) invalid('个人材料编号须以 P 开头。');
  need(fields,['材料类型','所属人','确认时间','适用范围']);
  if (!Object.hasOwn(MATERIAL_FIELDS,fields.材料类型)) invalid(`材料类型“${fields.材料类型}”不在受控范围。`);
  need(fields,MATERIAL_FIELDS[fields.材料类型]);
  Object.assign(data,{
    type:fields.材料类型,owner:fields.所属人,period:fields.期次 || '',
    validUntil:fields.有效至 && fields.有效至 !== '待确认' ? dateValue(fields.有效至,'有效至') : '',
    role:fields.角色 || '',usedIn:fields.已申报期次 || '',signatures:fields.签字状态 || '',
    confirmedAt:dateValue(fields.确认时间,'确认时间'),active:true,corrections:[]
  });
  if (data.type === '代表成果' && !['未申报','未知','待确认'].includes(data.usedIn)) data.usedIn = periodList(data.usedIn).join('、');
  for (const [index,line] of lines.entries()) {
    if (!line.startsWith('更正版本')) continue;
    const match = line.match(/^更正版本(\d+)：角色由“([^”]+)”更正为“(项目负责人|项目成员)”；更正依据为本人补充；演示日期(\d{4}-\d{2}-\d{2})。$/);
    if (!match || data.type !== '项目经历' || Number(match[1]) !== data.version + 1 || match[2] !== data.role) invalid('更正补充的版本、角色或来源不连续，需人工核实。');
    dateValue(match[4],'更正演示日期');
    const previousRole = data.role;
    data.version = Number(match[1]);
    data.role = match[3];
    data.corrections.push({version:data.version,previousRole,role:data.role,date:match[4],line:index + 1});
  }
  data.fields.角色 = data.role || data.fields.角色;
  if (!data.fields.角色) delete data.fields.角色;
  if (data.corrections.length) {
    data.fields.原始版本 = fields.版本;
    data.fields.版本 = String(data.version);
  }
  data.source = {id:data.id,filename,version:data.version,text};
  return {kind:'material',data};
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}
function assertSourceMatches(data,kind) {
  const canonical = parseFile(data.text,data.filename);
  if (canonical.kind !== kind) invalid('来源类型与原文不一致，当前结果已过时，请重新读取。');
  const keys = Object.keys(canonical.data).filter((key) => key !== 'active');
  if (keys.some((key) => stableStringify(canonical.data[key]) !== stableStringify(data[key]))) invalid('来源派生事实、版本或引用与可定位原文不一致，当前结果已过时，请重新读取并检查。');
}
function fingerprint(value) {
  const text = stableStringify(value);
  let first = 2166136261;
  let second = 5381;
  for (let i = 0; i < text.length; i++) {
    first = Math.imul(first ^ text.charCodeAt(i),16777619) >>> 0;
    second = Math.imul(second,33) ^ text.charCodeAt(i);
  }
  return `检查快照-v1-${text.length}-${first.toString(36)}-${(second >>> 0).toString(36)}`;
}
function normalPending(pendingFiles) {
  if (!Array.isArray(pendingFiles)) invalid('待读文件范围格式不正确。');
  return pendingFiles.map((file) => typeof file === 'string' ? {filename:file,status:'未读取'} : {filename:String(file?.filename || '未命名文件'),status:String(file?.status || '未读取')});
}
function inputStamp(notice,materials,branchConfirmed,now,pendingFiles) {
  const keys = ['id','title','filename','version','text','fields','period','type','owner','validUntil','role','usedIn','signatures','confirmedAt','corrections','deadline','channel','branch','attachmentAvailable','requirements'];
  const source = (item) => ({...Object.fromEntries(keys.filter((key) => item[key] !== undefined).map((key) => [key,item[key]])),active:item.active !== false});
  return fingerprint({notice:source(notice),materials:materials.map(source),branchConfirmed,now,pendingFiles});
}
function evidenceFor(material) {
  let evidence = fieldEvidence(material,MATERIAL_FIELDS[material.type]);
  if (material.type === '项目经历' && material.corrections?.length) {
    evidence = evidence.filter((item) => fieldName(item.text) !== '角色');
    evidence.push(evidenceAt(material,material.corrections.at(-1).line));
  }
  return evidence;
}
function pairResult(material,status,reason,nextStep) {
  return {materialId:material.id,materialVersion:material.version,materialTitle:material.title,filename:material.filename,status,reason,nextStep,evidence:evidenceFor(material)};
}

function checkPair(rule,material,notice,now) {
  let status = STATES.candidate;
  let reason = '';
  let nextStep = '核对本次规则与材料原文后，再决定是否选用于工作草稿。';
  if (rule.id === 'R1') {
    const state = material.fields.在读状态;
    if (state !== '在读') {
      status = state === '已离校' ? STATES.banned : STATES.update;
      reason = `来源写明在读状态为“${state}”，不能确认为本次有效在读证明。`;
      nextStep = '本人核实当前身份，补充有来源的新版本后重新检查。';
    } else if (!material.validUntil || material.validUntil < now || material.validUntil < rule.validThrough) {
      status = STATES.update;
      reason = `证明有效期${material.validUntil ? `至 ${material.validUntil}` : '待确认'}，未覆盖演示日期 ${now} 或本期要求 ${rule.validThrough}。`;
      nextStep = '补充有效期覆盖本期要求的在读证明，再重新检查。';
    } else reason = `原文为在读，有效期至 ${material.validUntil}，覆盖演示日期及本期 ${rule.validThrough} 的要求。`;
  } else if (rule.id === 'R2') {
    if (!rule.allowedRoles.includes(material.role)) {
      status = STATES.update;
      reason = `资料角色为“${material.role}”，尚不能对应规则允许的项目负责人或项目成员。`;
      nextStep = '由本人核实项目角色并补充来源，重新检查新版本。';
    } else reason = `来源中的“${material.role}”和项目经历可定位，属于本次规则允许的角色。`;
  } else if (rule.id === 'R3') {
    const problems = [];
    if (material.period !== rule.period) problems.push(`该名单属于${material.period}，本次要求${rule.period}`);
    if (material.signatures !== '全员签字') problems.push(`签字状态为${material.signatures}`);
    if (problems.length) {
      status = STATES.update;
      reason = `${problems.join('；')}，不能直接沿用。`;
      nextStep = `上传${rule.period}的全员签字名单，由本人核对成员和签字。`;
    } else reason = `原文明示${material.period}、全员签字；期次与本次规则一致。`;
  } else if (rule.id === 'R4') {
    const usedPeriods = material.usedIn.split('、');
    const prohibited = rule.excludedPeriods.filter((period) => usedPeriods.includes(period));
    if (prohibited.length) {
      status = STATES.banned;
      reason = `资料明确记载已用于${prohibited.join('、')}申报，命中本次“已申报成果不得重复用于${notice.period}”规则。`;
      nextStep = '本份成果排除本次用途；另提供符合规则的新成果。普通审核或选用不能解除禁用。';
    } else if (['未知','待确认'].includes(material.usedIn) && rule.excludedPeriods.length) {
      status = STATES.update;
      reason = '禁止重复申报规则明确，但该成果的既往使用史尚待确认。';
      nextStep = '由本人核实是否用于受禁期次，补充使用史证据后重新检查。';
    } else reason = `代表成果与使用史可定位，当前记录“${material.usedIn}”未命中本次已核对的重复限制。`;
  } else if (rule.id === 'R5') {
    if (material.period !== rule.period || material.fields.确认状态 !== '已确认') {
      status = STATES.update;
      reason = `确认书期次为${material.period}，确认状态为${material.fields.确认状态}，未满足本期形式要求。`;
      nextStep = `请指导老师提供${rule.period}已确认的确认书。`;
    } else reason = `原文为${material.period}指导老师已确认，适用范围与本期规则一致。`;
  } else {
    status = STATES.unknown;
    reason = '通知引用的附件A未提供，无法解释特殊身份材料要求。';
    nextStep = '向通知发布方取得附件A并确认适用身份；本演示仅保留待核实标记。';
  }
  // 截止时间变化不解除已命中的明确禁用，只撤下原本可引用的候选。
  if (status === STATES.candidate && now > notice.deadline) {
    status = STATES.update;
    reason += ` 演示日期 ${now} 已晚于通知截止日期 ${notice.deadline}，本期有效性需重新确认。`;
    nextStep = '核实通知是否延期或加入新的有效通知，再重新检查。';
  }
  return pairResult(material,status,reason,nextStep);
}

export function evaluate(notice, materials = [], {branchConfirmed = false,now = DEMO_DATE,pendingFiles = []} = {}) {
  if (!notice || !Array.isArray(notice.requirements) || notice.requirements.length !== 6) invalid('请先读取完整的受控通知。');
  if (!Array.isArray(materials)) invalid('所选资料范围须为列表。');
  now = dateValue(now,'演示检查日期');
  pendingFiles = normalPending(pendingFiles);
  if (materials.length + pendingFiles.length > 5) invalid('本次最多选择 5 份资料（包括未读与失败文件）。');
  if (materials.some((material) => !material?.text || !Object.hasOwn(MATERIAL_FIELDS,material.type))) invalid('资料尚未成功读取，须保留在未读范围中。');
  if (new Set(materials.map(({id}) => id)).size !== materials.length) invalid('同一来源编号出现多个版本，请先明确本次使用的版本。');
  assertSourceMatches(notice,'notice');
  for (const material of materials) assertSourceMatches(material,'material');
  const active = materials.filter((material) => material.active !== false);
  const checked = active.length;
  const total = checked + pendingFiles.length;
  const complete = checked > 0 && pendingFiles.length === 0;
  const omitted = materials.length - active.length;
  const description = total === 0 ? '未选择可检查资料；仅列通知要求，不能推断个人是否拥有材料。' : `已检查所选 ${checked}/${total} 份启用资料${complete ? '，本次选定范围检查完成' : '，仍有未读或失败文件，属于部分覆盖'}。${omitted ? `另有 ${omitted} 份已停用来源，不参与检查。` : ''}`;
  const coverage = {checked,total,complete,pendingFiles,description};
  const snapshotKey = inputStamp(notice,materials,Boolean(branchConfirmed),now,pendingFiles);
  return notice.requirements.map((rule) => {
    const relevant = active.filter((material) => material.type === rule.kind);
    let status,reason,nextStep,pairs = [];
    if (checked === 0) {
      status = STATES.unchecked;
      reason = total ? '所选资料尚未读取完成，没有可检查的个人事实。' : '尚未提供本次可检查的个人资料；通知要求已列出。';
      nextStep = total ? '补充可读 TXT 或移除不再属于本次范围的失败文件，再检查。' : '可跳过资料直接导出要求清单，或按需选择本次相关资料。';
    } else if (!branchConfirmed) {
      status = STATES.unknown;
      reason = `尚未确认是否适用“${notice.branch}”分支，不能将本次规则套用到个人资料。`;
      nextStep = '先核对并确认适用分支、期限、渠道和禁止条件，再重新检查。';
      pairs = relevant.map((material) => pairResult(material,status,reason,nextStep));
    } else if (rule.id === 'R6' && !notice.attachmentAvailable) {
      status = STATES.unknown;
      reason = '本次通知引用附件A，但附件A未提供；特殊身份是否适用及补充材料范围均无法判断。';
      nextStep = '向通知发布方取得附件A并确认身份分支，保留此项待核实，不声称完整覆盖。';
      pairs = relevant.map((material) => pairResult(material,status,reason,nextStep));
    } else if (relevant.length) {
      pairs = relevant.map((material) => checkPair(rule,material,notice,now));
      status = [STATES.candidate,STATES.unknown,STATES.update,STATES.banned].find((state) => pairs.some((pair) => pair.status === state));
      const mainPairs = pairs.filter((pair) => pair.status === status);
      reason = mainPairs.map((pair) => pair.reason).join(' ');
      nextStep = [...new Set(mainPairs.map((pair) => pair.nextStep))].join(' ');
      if (pairs.some((pair) => pair.status !== status)) reason += ' 其他版本或资料的不同判断保留在配对说明中。';
    } else if (!complete) {
      status = STATES.unchecked;
      reason = '当前已读资料中没有对应来源，但所选范围仍有未读或失败文件，不能判断本次未找到。';
      nextStep = '补充读取失败文件的可读文本，或明确移除该文件后重新检查范围。';
    } else {
      status = STATES.absent;
      reason = `本次已检查所选 ${checked} 份资料，范围内未发现“${rule.title}”来源；不代表本人从未拥有。`;
      nextStep = rule.id === 'R5' ? `另行选择或向指导老师索取${notice.period}确认书，再加入本次检查。` : `在所选范围外查找“${rule.title}”，补充相关文件后重新检查。`;
    }
    const mainPairs = pairs.filter((pair) => pair.status === status);
    return {
      id:rule.id,requirementId:rule.id,title:rule.title,status,reason,nextStep,
      ruleEvidence:rule.evidence,evidence:mainPairs.flatMap((pair) => pair.evidence),
      materialIds:mainPairs.map((pair) => pair.materialId),materialVersions:Object.fromEntries(mainPairs.map((pair) => [pair.materialId,pair.materialVersion])),
      pairs,coverage:{...coverage},noticeVersion:notice.version,snapshotKey
    };
  });
}

export function correctMaterial(material, role) {
  if (!material || material.type !== '项目经历') invalid('本演示只支持对项目经历补充角色更正。');
  if (!['项目负责人','项目成员'].includes(role)) invalid('角色须为项目负责人或项目成员。');
  if (material.role === role) invalid('角色没有变化，无需新增更正版本。');
  const addition = `更正版本${material.version + 1}：角色由“${material.role}”更正为“${role}”；更正依据为本人补充；演示日期${DEMO_DATE}。`;
  const corrected = parseFile(`${material.text.trimEnd()}\n${addition}\n`,material.filename).data;
  corrected.active = material.active !== false;
  return corrected;
}

function escapeMarkdown(value) {
  return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\\/g,'\\\\').replace(/([`*_{}\[\]()#+.!|~-])/g,'\\$1').replace(/\r?\n/g,' ');
}
function sourceLine(evidence) {
  const location = evidence.lineStart === evidence.lineEnd ? `第 ${evidence.lineStart} 行` : `第 ${evidence.lineStart}–${evidence.lineEnd} 行`;
  return `${escapeMarkdown(evidence.filename)} · ${escapeMarkdown(evidence.sourceId)} · 版本 ${evidence.version} · ${location}：${escapeMarkdown(evidence.text)}`;
}
function markdownItem(result, marker = '') {
  const lines = [`### ${result.id} ${escapeMarkdown(result.title)}`, '', `- 状态：${result.status}${marker ? `；${marker}` : ''}`,`- 原因：${escapeMarkdown(result.reason)}`,`- 下一步：${escapeMarkdown(result.nextStep)}`,`- 检查范围：${escapeMarkdown(result.coverage.description)}`,`- 本次规则：${sourceLine(result.ruleEvidence)}`];
  if (result.evidence.length) lines.push(...result.evidence.map((evidence) => `- 材料依据：${sourceLine(evidence)}`));
  else lines.push('- 材料依据：没有可定位的对应个人来源，保留当前未检查或待核实状态。');
  if (result.pairs.some((pair) => pair.status !== result.status)) lines.push('- 其他资料配对：见下方待办或排除分区，未并入当前选用依据。');
  return `${lines.join('\n')}\n`;
}

export function exportMarkdown(context) {
  if (!context || context.stale) throw new Error('当前结果已过时，请重新检查后再导出。');
  const {notice,materials = [],results,branchConfirmed = false,now = DEMO_DATE,pendingFiles = []} = context;
  const current = evaluate(notice,materials,{branchConfirmed,now,pendingFiles});
  if (!Array.isArray(results) || results.length !== current.length || new Set(results.map(({id}) => id)).size !== current.length || current.some((result) => results.find(({id}) => id === result.id)?.snapshotKey !== result.snapshotKey)) throw new Error('通知、资料、分支、范围或日期已变化，当前快照已过时，请重新检查后再导出。');
  // 按当前输入重新计算正文；传入结果里的状态或证据改写不能解除禁用。
  const reviewed = new Set(context.reviewedIds || []);
  const selected = new Set(context.selectedIds || []);
  const approved = current.filter((result) => result.status === STATES.candidate && reviewed.has(result.id) && selected.has(result.id));
  const otherCandidates = current.filter((result) => result.status === STATES.candidate && !approved.includes(result));
  const secondary = current.flatMap((result) => result.pairs.filter((pair) => pair.status !== result.status).map((pair) => ({
    ...result,title:`${result.title} · ${pair.materialId} 配对说明`,status:pair.status,reason:pair.reason,nextStep:pair.nextStep,
    evidence:pair.evidence,materialIds:[pair.materialId],materialVersions:{[pair.materialId]:pair.materialVersion},pairs:[]
  })));
  const pending = [...current,...secondary].filter((result) => result.status !== STATES.candidate && result.status !== STATES.banned);
  const banned = [...current,...secondary].filter((result) => result.status === STATES.banned);
  const sections = [
    ['已核对并选用于草稿',approved,(result) => markdownItem(result,'已核对本次依据；已选用于草稿')],
    ['候选，仍待核对或未选用',otherCandidates,(result) => markdownItem(result,reviewed.has(result.id) ? '已核对；未选用' : '尚未核对；不能进入已选区')],
    ['待办、未检查与无法判断',pending,(result) => markdownItem(result,'保留边界；不是材料齐全结论')],
    ['不可用于本次',banned,(result) => markdownItem(result,'仅列排除说明；不会进入建议提交材料')]
  ];
  const heading = [
    '# 星桥计划 · 材料准备工作草稿', '',
    '> 演示合成资料与规则模拟；未调用模型，未共享，未正式提交。本清单不代表资格通过、材料齐全、报名成功或审批完成。', '',
    `- 事务：${escapeMarkdown(notice.title)}（${notice.id}，版本 ${notice.version}）`,
    `- 演示模式：${escapeMarkdown(context.mode || '本次材料准备')}`,
    `- 生成时间：${escapeMarkdown(context.generatedAt || `${now}（固定演示日期）`)}`,
    `- 检查日期：${now}（固定演示日期，不是实时日期推断）`,
    `- 截止日期：${notice.deadline}；渠道：${escapeMarkdown(notice.channel)}`,
    `- 分支：${escapeMarkdown(notice.branch)}；${branchConfirmed ? '已由用户确认适用' : '尚未确认，不能判定个人适用性'}`,
    `- 通知覆盖：R1–R6 原文可定位；附件A未提供，特殊身份规则未完整覆盖。`,
    `- 资料覆盖：${escapeMarkdown(current[0].coverage.description)}`,
    ...normalPending(pendingFiles).map((file) => `- 未完成文件：${escapeMarkdown(file.filename)}（${escapeMarkdown(file.status)}）`),
    '- 保存不是导出前提；保存、核对、选用、正式提交为不同动作。', ''
  ];
  for (const [title,items,render] of sections) {
    heading.push(`## ${title}`, '', ...(items.length ? items.map(render) : ['无。\n']));
  }
  heading.push('---','','资料或规则修改后应重新检查并导出；此下载副本不会自动更新或撤回。仅证明受控演示流程，不证明任意文件理解、节时、留存、付费或团队协作能力。','');
  return heading.join('\n');
}
