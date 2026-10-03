"""手动真实模型验收：只使用临时合成沉淀，不读取用户的真实记忆；会消耗额度。"""
import json
import tempfile
from pathlib import Path
from datetime import datetime, timezone
from src.core import Application, MemoryStore
from src.model import ModelClient

ROOT = Path(__file__).resolve().parent.parent

def main():
    model = ModelClient(config_path=ROOT / 'var/model-config.json')
    with tempfile.TemporaryDirectory(prefix='wenqi-live-synthetic-memory-') as tmp:
        memory = MemoryStore(Path(tmp) / 'memory.json')
        saved = memory.apply('add', 'user', '合成用户是一名大学老师，负责向学生转发学校通知。', consent=True, source='明确标注的合成验收背景，不是真人资料')
        app = Application(memory, model)
        doc = app.upload('合成记忆复用通知.txt', ('合成验收材料：学校、项目和人物均为虚构。\n星河大学项目创新奖学金通知\n面向全日制在校本科生，须提交成绩单和项目成果说明。\n本校任课教师可将本通知转发给学生，不能代学生提交申请。\n截止时间为2026年10月20日17:00；由学生本人通过学校指定平台提交。\n准备材料不等于资格通过。').encode())
        result = app.chat(doc['id'], '', True)
        analysis = result['analysis']
        refs = [ref for row in analysis['insights'] for ref in row['memory_refs']]
        report = {'date':datetime.now(timezone.utc).isoformat(), 'synthetic_data':True, 'real_model':True,
                  'model':model.status()['model'], 'summary':analysis['summary'], 'overview':analysis['overview'],
                  'response':analysis['response'], 'positioning':analysis['positioning'], 'insights':analysis['insights'],
                  'memory_refs_count':len(refs), 'automatically_saved':False, 'passed':False}
        report_path = ROOT / 'var/live-agent-memory-verification.json'
        report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        assert saved['entries'][0]['id'] in refs, '相关合成教师沉淀应在首轮解读中引用'
        assert any(word in analysis['overview'] + analysis['response'] for word in ['老师','教师','转发']), '应结合相关角色，而不是把用户当作申请学生'
        assert memory.snapshot()['revision'] == saved['revision'], '总结不能自动修改沉淀'
        report['passed'] = True
        report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        app.forget(doc['id'])
        print('PASS 真实模型首轮结合临时合成教师沉淀，引用条目正确且未自动保存新沉淀')

if __name__ == '__main__': main()
