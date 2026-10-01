from pathlib import Path
import re

TASK = Path(__file__).resolve().parent
ROOT = TASK.parents[1]
DEMO = ROOT / '05-交互Demo/可行动事务Agent-文启高保真Demo.html'
source = (TASK / 'before/05-交互Demo/可行动事务Agent-文启高保真Demo.html').read_text(encoding='utf-8')

def replace(old, new):
    global source
    if source.count(old) != 1:
        raise ValueError(f'目标出现次数不为 1：{old[:80]}')
    source = source.replace(old, new)

# 移除被替代的事务卡样式，保留其他页面样式。
style_start = source.index('<style>')
style_end = source.index('</style>')
styles = source[style_start:style_end]
styles = re.sub(r'\.transaction[^{}]*\{[^{}]*\}', '', styles)
styles += '\n' + (TASK / 'transaction-picker.css').read_text(encoding='utf-8') + '\n'
source = source[:style_start] + styles + source[style_end:]

for prefix in ('action', 'package'):
    pattern = r'<section class="transaction-section" aria-labelledby="' + prefix + r'-transaction-title">.*?</section>'
    matches = re.findall(pattern, source)
    if len(matches) != 1:
        raise ValueError('未找到唯一选择区域：' + prefix)
    replace(matches[0], f'<section class="transaction-section" aria-label="选择当前事务"><div class="transaction-switcher" id="{prefix}-transactions"></div></section>')

picker = '''<div class="transaction-picker" id="transaction-picker" role="dialog" aria-modal="false" aria-labelledby="transaction-picker-title" hidden><header class="transaction-picker-header"><h2 id="transaction-picker-title">切换事务</h2><button class="icon-button" id="transaction-picker-close" aria-label="关闭事务选择器"><i data-icon="x"></i></button></header><div class="transaction-search"><i data-icon="search"></i><input id="transaction-search" type="search" role="combobox" aria-label="搜索事务名称、目标或关联文件" aria-autocomplete="list" aria-controls="transaction-options" aria-expanded="false" autocomplete="off" placeholder="搜索事务名称、目标或关联文件…"><button class="icon-button" id="transaction-search-clear" type="button" aria-label="清空事务搜索" hidden><i data-icon="x"></i></button></div><div class="transaction-options" id="transaction-options" role="listbox" aria-label="匹配的事务"></div><div class="transaction-picker-empty" id="transaction-picker-empty" hidden><i data-icon="search"></i><strong>没有找到匹配的事务</strong><p>试试其他名称、目标或关联文件名。</p></div><footer class="transaction-picker-footer"><span id="transaction-result-count" role="status" aria-live="polite"></span><span class="keyboard-hint">↑ ↓ 选择 · Enter 确认 · Esc 关闭</span></footer></div>
'''
replace('<div class="reference-menu"', picker + '<div class="reference-menu"')
replace('<div><strong>02</strong><span>个事务</span></div>', '<div><strong id="package-transaction-count">02</strong><span>个事务</span></div>')
replace('<div><strong>06</strong><span>项产物</span></div>', '<div><strong id="package-output-count">06</strong><span>项产物</span></div>')
replace('<div><strong>06</strong><span>份来源文件</span></div>', '<div><strong id="package-source-count">06</strong><span>份来源文件</span></div>')
start = source.index('function transactionCards(context){')
end = source.index('\nfunction saveOutput', start)
source = source[:start] + (TASK / 'transaction-picker.js').read_text(encoding='utf-8') + source[end:]
replace("transactionCards('查看成果')", "transactionSelector('查看成果')")
replace("transactionCards('选择事务')", "transactionSelector('选择事务')")
replace("  renderOutput(outputSelections[activeTransaction]);", """  const allTransactions=Object.values(transactions);
  document.querySelector('#package-transaction-count').textContent=String(allTransactions.length).padStart(2,'0');
  document.querySelector('#package-output-count').textContent=String(allTransactions.reduce((sum,transaction)=>sum+transaction.outputs.length,0)).padStart(2,'0');
  document.querySelector('#package-source-count').textContent=String(new Set(allTransactions.flatMap(transaction=>transaction.files)).size).padStart(2,'0');
  renderOutput(outputSelections[activeTransaction]||item.outputs[0]?.id);""")
replace("  if(button.dataset.transaction)selectTransaction(button.dataset.transaction);\n", '')
replace("  closeReferenceMenu();closeReference();", "  closeTransactionPicker();closeReferenceMenu();closeReference();")
replace("  if(!transactions[id])return;\n  saveOutput();", "  if(!Object.hasOwn(transactions,id))return;\n  closeTransactionPicker();\n  saveOutput();")
DEMO.write_text(source, encoding='utf-8', newline='\n')
print('已更新事务选择器：' + str(DEMO))
