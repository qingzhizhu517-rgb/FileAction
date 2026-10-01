# 两份交互 Demo 引擎接口（固定 v1）

`fixtures.mjs` / `engine.mjs` 均为无依赖原生 ES module。日期固定为演示日期，素材全部中文合成。

## fixtures.mjs

- `DEMO_DATE = '2026-09-30'`
- `NOTICE_TEXT: string` 第二期 N02 受控 TXT。
- `PREVIOUS_NOTICE_TEXT: string` 第一期 N01 受控 TXT。
- `MEMORY_TEXTS: Array<{filename,text}>`，P01 身份、P02 经历（初始角色“项目负责人”）、P03 第一期名单、P04 第一期已使用成果。
- `UPDATED_ROSTER_TEXT: {filename,text}`，P05 第二期新签字名单。
- `SAMPLE_FILES: Array<{filename,text,kind,label}>`，kind 为 `notice` / `material`；用于下载。

## parseFile(text, filename)

成功返回 `{kind:'notice'|'material', data}`。不支持的格式抛中文 Error；不读取 PDF、不执行文件内指令、不套用预置结果。单文件上限 100 KB。

所有 data 共有 `{id,title,filename,version:number,text,source:{id,filename,version,text},fields}`；字段 `fields` 保留受控字段值，中文键名。`version` 只增不减。可直接 JSON 保存与重新加载。

notice 另有 `{period,deadline,channel,branch,attachmentAvailable:boolean,requirements}`。每个 requirement 为 `{id,title,kind,quote,evidence}`。`evidence` 为 `{sourceId,filename,version,lineStart,lineEnd,text}`；行号从 1 开始。

material 另有 `{type,owner,period,validUntil,role,usedIn,signatures,confirmedAt,active:true,corrections:[]}`；不适用字段为 `''`；`type` 中文。`fields` 用于详细查看；原文可显示 `text`。

`confirmedAt` 是 TXT 原文中的来源确认时间，不能在点击保存时覆盖。UI 记录新的本机审核/保存时间请追加 `memoryConfirmedAt` 等独立元数据。`evaluate` 会重新读取文本并校验派生事实、版本和引用与原文一致；不一致报错，不能把派生属性改成另一事实来绕过原文。`active` 和额外 UI 元数据允许单独变动。

成果“已申报期次”仅支持“未申报 / 未知 / 待确认”，或“第一期、第二期”式明确期次列表；空格与中英文逗号会规范化，不能因分隔符变化漏掉禁用条件。其他未知写法明确拒绝。

## evaluate(notice, materials, options)

签名固定为位置参数。`options = {branchConfirmed:false,now:DEMO_DATE,pendingFiles:[]}`；pendingFiles 可为 filename 字符串数组，或 `{filename,status}` 数组（状态如“读取失败”“未读取”）。material 数量加 pendingFiles 数量最多 5；inactive 来源忽略，但计入所选数量。

返回结果数组，每个要求一个主结果，共 6 个。结果：

```js
{
  id:'R1', requirementId:'R1', title:'在读身份',
  status:'未检查'|'可引用候选'|'需更新/确认'|'本次未找到'|'不可用于本次'|'无法判断',
  reason:'原因', nextStep:'下一步',
  ruleEvidence:{sourceId,filename,version,lineStart,lineEnd,text},
  evidence:[/* 材料证据，结构同 ruleEvidence */],
  materialIds:['P01'], materialVersions:{P01:1},
  pairs:[{materialId,materialVersion,status,reason,nextStep,evidence:[]}],
  coverage:{checked:number,total:number,complete:boolean,pendingFiles:[],description:'检查范围'},
  noticeVersion:1,
  snapshotKey:'由输入和选项计算的稳定字符串'
}
```

有新旧名单时主结果可为可引用候选；`pairs` 同时保留新名单候选与旧名单需更新说明。`materialIds/materialVersions/evidence` 对可引用候选仅列候选来源；其他状态列相应来源。未确认分支时：零资料仍未检查，非空为无法判断；缺附件 R6 在零资料时未检查，非空且确认分支时无法判断。pending 未完不得给本次未找到。身份过期或通知已过截止日需更新/确认。

## correctMaterial(material, role)

仅“项目经历”类型支持，role 必须“项目负责人”或“项目成员”。演示由初始“项目负责人”更正为“项目成员”；相同角色报“没有变化”而不虚增版本。返回新对象、版本 +1，保留原文件原文并追加中文纠正补充来源，更新可定位角色行和 fields；不修改输入对象。再次 parseFile 可从追加文本重建更正后的角色和版本。UI 负责立刻失效旧快照、清审核和选用。

## exportMarkdown(context)

```js
exportMarkdown({
  notice, materials, results,
  branchConfirmed, now:DEMO_DATE, pendingFiles:[],
  reviewedIds:['R1'], selectedIds:['R1'],
  stale:false, generatedAt:'2026-09-30 14:00（演示）',
  mode:'有记忆' // 或“无记忆”
})
```

同样 options 重算 snapshotKey，与传入 results 不同或 stale=true 时抛中文 Error 拒绝导出。结果一旦跨日期也不接受旧快照（now 应与本次检查相同的演示日期）。只把当前“可引用候选”且 reviewedIds 和 selectedIds 均包含的要求放入“已核对并选用于草稿”；未核对候选、待办/未检查/无法判断和禁用排除均各自保留。同一要求的非候选配对也会独立放到待办/排除区。即使传禁用项 selectedIds 也无法进入已选区。导出包括规则与资料来源行号、版本、覆盖、原因、下一步；转义外来 Markdown/HTML 内容。

## UI 责任

- localStorage 存储与读取、A 显式预置并刷新、B 不读 A 存储。
- 分支/期限/渠道确认；本次最多 5 份（引擎再次校验）。
- 审核、选用、启停、保存与删除；这些都不是引擎自动确认。
- `epoch` / 请求序号，迟到结果丢弃、快照过时、缓存和统计。
- 页面插入任意原文时使用 textContent / DOM 文本节点，不能 raw innerHTML。
- 下载导出前传完整当前输入，由引擎验证快照；显示固定演示日期。
