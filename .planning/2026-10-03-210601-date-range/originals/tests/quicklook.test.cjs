/* 合成原文；验证速览事实提取边界，不调用模型。 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('src/web/app.js','utf8');
const extract=new Function(app.slice(app.indexOf('function quicklookItems(doc)'),app.indexOf('function renderHighlights()'))+';return quicklookItems;')();
test('链接路径中的日期不是通知的时间节点',()=>{
 const result=extract({segments:[{id:'L1',text:'操作指南：https://example.com/2099-11-30/instructions'}]});
 assert.equal(result.dates.length,0);assert.equal(result.links.length,1);
});
test('同一段含多个日期时，不将一个时区套用到其他日期',()=>{
 const result=extract({segments:[{id:'L1',text:'报名截止：2099年11月30日17:00（北京时间），缴费截止：2099年12月1日17:00（UTC）。'}]});
 assert.equal(result.dates.length,2);
 assert.ok(result.dates.every(d=>!d.date_info.timestamp));
});
test('真实明确的日期可计时，未知时区不编造精确计时',()=>{
 const result=extract({segments:[{id:'L1',text:'报名截止：2099年11月30日17:00（北京时间）。'},{id:'L2',text:'提交截止：2099年12月1日17:00（UTC+02）。'}]});
 assert.equal(result.dates[0].date_info.timestamp,'2099-11-30T17:00:00+08:00');
 assert.equal(result.dates[1].date_info.timestamp,null);
});
