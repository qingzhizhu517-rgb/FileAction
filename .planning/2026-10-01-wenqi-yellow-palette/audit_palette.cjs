// 离线配色审计：不代替浏览器渲染验收。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('../2026-10-01-wenqi-morandi-refinement/test-runtime/node_modules/jsdom');
const current = fs.readFileSync(path.resolve(__dirname, '../../05-交互Demo/可行动事务Agent-文启高保真Demo.html'), 'utf8');
const before = fs.readFileSync(path.join(__dirname, 'before/05-交互Demo/可行动事务Agent-文启高保真Demo.html'), 'utf8');
const palette = new Set(['#F6C945', '#E6AD19', '#FFF7D6', '#FFFDF8', '#FFFFFF', '#2B2B2B', '#6B6B6B', '#F1E7C8']);
const colors = [...current.matchAll(/#[\da-f]{3,8}\b/gi)].map(m => m[0].toUpperCase());
assert.ok(colors.every(c => palette.has(c) || /^#2B2B2B[\dA-F]{2}$/.test(c)), '发现色板以外的颜色');
const definitions = new Set([...current.matchAll(/(--[\w-]+):/g)].map(m => m[1]));
const usages = new Set([...current.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]));
assert.deepEqual([...usages].filter(v => !definitions.has(v)), [], '发现未定义的颜色变量');
assert.ok(!/var\(--var/.test(current), '发现嵌套错误的颜色变量');
const stripColors = text => text.replace(/\r\n/g, '\n').replace(/#[\da-f]{3,8}\b|var\(--[\w-]+\)/gi, '<COLOR>');
const script = text => text.match(/<script>([\s\S]*?)<\/script>/)[1];
assert.equal(stripColors(script(current)), stripColors(script(before)), '本轮存在非颜色脚本修改');

const css = text => text.match(/<style>([\s\S]*?)<\/style>/)[1];
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', error => errors.push(error.message));
const oldDom = new JSDOM('<style>' + css(before) + '</style>', { virtualConsole: vc });
const newDom = new JSDOM('<style>' + css(current) + '</style>', { virtualConsole: vc });
assert.deepEqual(errors, [], 'CSS 解析失败');

// 对比已有规则的尺寸、网格、字号、间距等属性，确认换肤没有改动布局。
function structure(rules) {
  const result = [];
  for (const rule of rules) {
    if (rule.selectorText === ':root') continue;
    if (rule.cssRules) {
      result.push({ group: rule.conditionText || rule.name || rule.type, children: structure(rule.cssRules) });
    } else if (rule.style) {
      const properties = {};
      for (let i = 0; i < rule.style.length; i++) {
        const property = rule.style[i];
        if (/(?:color|background|border|shadow|fill|stroke|outline)/.test(property) || property.startsWith('--')) continue;
        properties[property] = rule.style.getPropertyValue(property);
      }
      result.push({ selector: rule.selectorText || rule.keyText, properties });
    }
  }
  return result;
}
const oldStructure = structure(oldDom.window.document.styleSheets[0].cssRules);
const newStructure = structure(newDom.window.document.styleSheets[0].cssRules);
assert.deepEqual(newStructure.slice(0, oldStructure.length), oldStructure, '已有布局或规则顺序发生变化');
assert.ok(newStructure.slice(oldStructure.length).every(r => Object.keys(r.properties || {}).length === 0), '主题补充中含非颜色属性');

function luminance(hex) {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return channels.reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
}
for (const [fg, bg] of [['#2B2B2B', '#F6C945'], ['#2B2B2B', '#E6AD19'], ['#6B6B6B', '#FFFDF8'], ['#6B6B6B', '#FFF7D6']]) {
  const values = [luminance(fg), luminance(bg)].sort((a, b) => a - b);
  const ratio = (values[1] + .05) / (values[0] + .05);
  assert.ok(ratio >= 4.5);
  console.log(`文字对比度 ${fg} / ${bg}: ${ratio.toFixed(2)}:1`);
}
oldDom.window.close();
newDom.window.close();
console.log(`配色审计通过：八色及透明阴影，变量定义完整，${oldStructure.length} 条已有规则的布局属性一致，脚本逻辑不变。`);
