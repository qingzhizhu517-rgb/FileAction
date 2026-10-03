/* 合成原文；验证速览事实提取边界，不调用模型。 */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('src/web/app.js','utf8');
const extract=new Function(app.slice(app.indexOf('function quicklookItems(doc)'),app.indexOf('function renderHighlights()'))+';return quicklookItems;')();
test('报名与缴费的明确起止日期各合并成一行，重复区间去重',()=>{
 const result=extract({segments:[
  {id:'P6',text:'报名时间：9月18日10:00—9月23日17:00。'},
  {id:'P7',text:'缴费时间：9月18日10:00至9月24日17:00。'},
  {id:'P8',text:'报名时间：9月18日10:00—9月23日17:00。'}
 ]});
 assert.equal(result.dates.length,2);
 assert.equal(result.dates[0].title,'报名日期');
 assert.equal(result.dates[0].value,'9月18日10:00 至 9月23日17:00');
 assert.equal(result.dates[0].source_id,'P6');assert.equal(result.dates[0].date_info,null);
 assert.equal(result.dates[1].title,'缴费日期');
 assert.equal(result.dates[1].value,'9月18日10:00 至 9月24日17:00');
});
test('不同事项的日期和无连接词的多日期不强行合并',()=>{
 for(const text of ['报名截止：9月23日17:00；缴费截止：9月24日17:00。','笔试时间：12月12日、12月13日。']){
  assert.equal(extract({segments:[{id:'P1',text}]}).dates.length,2);
 }
});
test('完整日期区间以终点估算截止日，起止年份不擅自补全',()=>{
 const dates=extract({segments:[{id:'P1',text:'报名时间：2099年9月18日10:00到2099年9月23日17:00（北京时间）。'},{id:'P2',text:'活动日期：2099年9月18日至9月23日。'}]}).dates;
 assert.equal(dates.length,2);
 assert.equal(dates[0].date_info.date,'2099-09-23');assert.equal(dates[0].date_info.timestamp,null);
 assert.equal(dates[1].value,'2099年9月18日 至 9月23日');assert.equal(dates[1].date_info,null);
});
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
