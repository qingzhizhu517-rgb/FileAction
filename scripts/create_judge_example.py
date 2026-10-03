"""生成明确标注的合成体验 PDF；不是活动公告或真实用户材料。"""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'front/public/examples/campus-innovation-synthetic.pdf'
FONT = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
pdfmetrics.registerFont(TTFont('Chinese', FONT))
c = canvas.Canvas(str(OUTPUT), pagesize=(595, 842), invariant=True)
c.setTitle('合成体验｜校园创新实践计划通知')
c.setAuthor('文启 FileAction · 合成测试材料')
c.setFillColor(HexColor('#FFFCF4')); c.rect(0, 0, 595, 842, fill=1, stroke=0)
c.setFillColor(HexColor('#E6AD19')); c.rect(42, 764, 48, 5, fill=1, stroke=0)

def text(y, value, size=12, color='#302A20'):
    c.setFillColor(HexColor(color)); c.setFont('Chinese', size); c.drawString(42, y, value)

text(788, '文启 FileAction / 合成体验材料 V1', 10, '#796E58')
text(718, '校园创新实践计划', 28)
text(682, '项目征集通知', 22)
text(644, '虚构活动 · 虚构机构 · 仅用于产品体验，不可据此实际报名', 10, '#8B650D')
sections = [
    (601, '01  机会与时间', [
        '合成机构“青禾实践中心”征集校园问题解决方案，主题包括学习、',
        '生活与无障碍服务。支持完成原型验证，并提供导师交流机会。',
        '报名截止：2026年10月15日18:00（北京时间）。',
        '线上交流：2026年10月18日14:00至16:00（北京时间）。',
    ]),
    (469, '02  谁可以申请', [
        '申请人为在读本科生或研究生，团队人数为1至3人。',
        '无需已有完整产品，但应说明具体问题、目标用户和验证方法。',
        '每名申请人限参与一个项目；提交材料不代表资格审核通过。',
    ]),
    (359, '03  需要准备什么', [
        '提交一页项目说明：问题、目标用户、解决思路、两周验证计划。',
        '同时准备在读证明、团队成员分工；原型截图为可选材料。',
        '不要求提供真实身份证号、银行信息或缴纳任何报名费用。',
    ]),
    (249, '04  报名入口与结果', [
        '演示报名链接：https://example.org/campus-innovation',
        '此链接仅为示意，不提供真实报名功能，请勿提交个人信息。',
        '合成通知约定：2026年10月20日前发布入选结果，名额未说明。',
    ]),
]
for y,title,lines in sections:
    text(y,title,14)
    for i,line in enumerate(lines): text(y-29-i*21,line,11)
c.setStrokeColor(HexColor('#E4D8BB')); c.line(42,116,553,116)
text(94,'体验提示：结合可修改的合成背景理解通知，再自主决定是否生成草稿。',10,'#796E58')
text(64,'合成数据 / 无真实组织、人员、报名或获奖事实',9,'#796E58')
text(42,'FILEACTION SAMPLE V1                                                        01 / 01',9,'#796E58')
c.save()
print(OUTPUT)
