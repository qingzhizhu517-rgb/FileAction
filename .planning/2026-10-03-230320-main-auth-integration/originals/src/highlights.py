"""从原文构建日期、链接等展示块；不抓取链接，也不编造截止时刻。"""
import re
from datetime import datetime, timezone, timedelta
from urllib.parse import urlsplit

DATE = re.compile(r'(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?(?:[T\s]*(\d{1,2})[:：](\d{2})(?::(\d{2}))?)?')
URL = re.compile(r'https?://[^\s<>"\u3000。；，、（）]+')

def safe_url(value):
    try:
        u=urlsplit(value)
        return u.scheme in ('http','https') and bool(u.hostname) and not u.username and not u.password and not any(c in value for c in '\r\n')
    except ValueError: return False

def date_info(value):
    matches=list(DATE.finditer(value))
    if len(matches)!=1:return None
    match=matches[0];year,month,day,hour,minute,second=match.groups()
    try:
        date=datetime(int(year),int(month),int(day),int(hour or 0),int(minute or 0),int(second or 0))
    except ValueError:return None
    # 只有原文明确北京时间/UTC偏移且含具体时刻，才提供精确倒计时。
    offset=None
    if '北京时间' in value or re.search(r'(?:UTC|GMT)\s*\+0?8(?::00)?',value,re.I):offset=8
    elif re.search(r'\b(?:UTC|GMT)\b(?!\s*[+-]\d)',value,re.I):offset=0
    precise=hour is not None and offset is not None
    return {'date':date.date().isoformat(),'timestamp':date.replace(tzinfo=timezone(timedelta(hours=offset))).isoformat() if precise else None,
            'note':'原文明确时区' if precise else '未解析完整时刻或时区；按本机日期估算'}

def extract_highlights(segments):
    out=[];seen=set()
    for s in segments:
        value=s['text'];sid=s['id']
        links=list(s.get('links',[]))+[m.group().rstrip('。；，、.,;）)]}') for m in URL.finditer(value)]
        for link in links:
            if safe_url(link) and ('link',link) not in seen:
                seen.add(('link',link));out.append({'kind':'link','title':'报名入口' if re.search('报名|申请|注册',value) else '文件链接',
                    'value':link,'source_id':sid,'quote':value,'embedded':link in s.get('links',[])})
        if re.search('截止|截至|最迟|报名结束|提交期限|deadline',value,re.I):
            out.append({'kind':'deadline','title':'截止时间','value':value,'source_id':sid,'quote':value,'date_info':date_info(value)})
        elif DATE.search(value):
            out.append({'kind':'date','title':'关键日期','value':value,'source_id':sid,'quote':value})
        elif re.search('须提交|需提交|材料要求|必备材料|申请条件|报名条件',value):
            out.append({'kind':'requirement','title':'材料与条件','value':value,'source_id':sid,'quote':value})
    return out[:10]

def countdown(card,now=None):
    if card.get('kind')!='deadline' or not card.get('date_info'):return None
    info=card['date_info'];now=now or datetime.now().astimezone()
    if info['timestamp']:
        target=datetime.fromisoformat(info['timestamp']);seconds=int((target-now).total_seconds())
        return {'state':'expired' if seconds<=0 else 'active','seconds':max(0,seconds),'precision':'second','note':info['note']}
    days=(datetime.fromisoformat(info['date']).date()-now.astimezone().date()).days
    return {'state':'expired' if days<0 else 'today' if days==0 else 'active','days':max(0,days),'precision':'date','note':info['note']}
