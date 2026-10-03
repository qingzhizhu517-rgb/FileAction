"""文件工作区：COS快照持久化、独立会话和可编辑的文件沉淀。"""
import copy
import hashlib
import json
import os
import threading
import uuid
from pathlib import Path
from datetime import datetime, timezone, timedelta
from .core import AppError, text, parse_document, validate_analysis, ANALYSIS_SYSTEM, ACTION_SYSTEM
from .highlights import extract_highlights, countdown

FIELDS={'role':'阅读身份','background':'相关背景','conditions':'已知条件','notes':'文件要点','pending':'待核实事项'}
WORKSPACE_SYSTEM=ANALYSIS_SYSTEM.replace('\"actions\":[\"可选具体产物名称\"]}', '\"actions\":[\"可选具体产物名称\"],\"file_knowledge_updates\":[],\"thread_context\":\"本会话目标摘要\"}')+'''
这是可持续文件工作区。输入file_knowledge是当前文件的沉淀卡片；用户修改过的locked条目优先于旧聊天和你之前的推断，不能覆盖或重新引入deleted_fields中的内容。与全局memory冲突时，本文件用户修改内容优先用于本文件，用户修改的档案条目须重新读取，不能使用旧值。
conversation仅提供最近几轮，earlier_turns表示还有已保存历史，不能声称之前没有讨论过。thread_context是本会话的目标摘要，不是用户身份事实。
不再返回逐条待保存的memory_candidates，给[]。每次必须输出file_knowledge_updates（无变化时为[]）和thread_context。用户明确自述阅读身份、相关背景或实际条件时，须将新增信息整理进对应卡片，已有同值、locked或deleted字段则不更新。每个文件的沉淀会自动归档到用户档案，不需要另行确认。原文可以整理为notes，推断不得冒充事实。
格式：[{"field":"role/background/conditions/notes/pending","value":"简短内容","kind":"user_fact/document_fact/inference/unknown/global_ref","quote":"真实原文片段或用户自述","source_id":"原文id（文件来源时）","message_id":"用户消息id（当前用户新消息可写latest）","memory_id":"全局记忆id（global_ref时）"}]。最多5项，field不重复。
memory中的target=file是自动归档，kind为document_fact/inference/unknown只表示来源文件事实/推断/未知，不能将其当作已确认的用户身份或资格。kind=user_edit表示用户主动修改，优先使用；条目的file_name标明来源文件。只引用与当前文件或问题相关的档案，并在对应insight.memory_refs列真实id。
用户自述只用user_fact并提供该用户消息的逐字quote；原文事实用document_fact，推断用inference，未知用unknown，都提供真实原文source_id和quote。引用全局条目用global_ref及memory_id，value和quote须来自该条目原文。不要把文件目标人群当作用户身份。locked条目不要返回修改；回答不会变成用户确认猜测。
thread_context输出本轮更新后的会话目的摘要（200字以内），只用于本会话。不要把本会话目标写进共享role或background。pending如已解决可以返回空value。保持首轮先总结，核心问题可跳过，用户可直接关闭工作区。'''

def now():return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec='seconds')

def atomic_json(path,data):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    tmp=path.with_suffix('.tmp')
    with tmp.open('w',encoding='utf-8') as stream:
        os.chmod(tmp,0o600);json.dump(data,stream,ensure_ascii=False,indent=2);stream.flush();os.fsync(stream.fileno())
    os.replace(tmp,path)

class WorkspaceApplication:
    def __init__(self,memory,model,storage,index_path):
        self.memory,self.model,self.storage=memory,model,storage
        self.path=Path(index_path);self.lock=threading.RLock();self.projects={};self.index={}
        if self.path.exists():
            try:
                self.index=json.loads(self.path.read_text())
                if not isinstance(self.index,dict):raise ValueError()
            except Exception:raise AppError('工作区索引损坏，未覆盖原文件，请备份检查。',500) from None

    def _load(self,pid):
        if not isinstance(pid,str):raise AppError('文件工作区不存在。',404)
        if pid not in self.projects:
            item=self.index.get(pid)
            if not item:raise AppError('文件工作区不存在或临时数据已结束。',404)
            _,raw=self.storage.read(item['archive_id'])
            try:
                data=json.loads(raw)
                if data['id']!=pid or data['schema']!=1 or not isinstance(data['threads'],list):raise ValueError()
            except Exception:raise AppError('COS工作区快照格式不正确，未覆盖或伪造对话。',502) from None
            data['archive']=item['archive_id'];data['_raw']=None;data['sync_error']='';data['pending']=False
            self.projects[pid]=data
        p=self.projects[pid]
        if not p.get('_profile_migrated'):
            if p['knowledge']['entries']:self.memory.sync_file(pid,p['document']['name'],p['knowledge']['entries'])
            p['_profile_migrated']=True
        return p

    def _thread(self,uid):
        for pid in list(self.projects)+[p for p in self.index if p not in self.projects]:
            # 已知持久会话映射避免为每次请求读取其他文件。
            if pid not in self.projects and uid not in self.index[pid].get('thread_ids',[]):continue
            project=self._load(pid)
            for thread in project['threads']:
                if thread['id']==uid:return project,thread
        raise AppError('会话不存在，请从文件工作区重新打开。',404)

    def _sync_info(self,p):return {'pending':bool(p.get('pending')),'error':p.get('sync_error',''),'persistent':bool(p.get('archive'))}

    def _commit(self,p):
        p['updated']=now()
        if not p.get('cloud_enabled'):return
        p['pending']=True
        if not p.get('stored'):
            p['sync_error']='原文件尚未成功保存，请重试工作区保存。';return
        status=self.storage.status()
        if (p['stored']['bucket'],p['stored']['region'])!=(status['bucket'],status['region']):
            p['sync_error']='COS配置与本工作区存储桶不同，未自动迁移或外发。';return
        try:
            data={k:v for k,v in p.items() if not k.startswith('_') and k not in ('archive','pending','sync_error')}
            raw=json.dumps(data,ensure_ascii=False).encode()
            record=self.storage.save(p['id']+'.json',raw,consent=True,kind='workspace')
            meta={'id':p['id'],'name':p['document']['name'],'sha256':p['sha256'],'suffix':p['suffix'],
                  'updated':p['updated'],'preview':p.get('summary','')[:160],'thread_ids':[t['id'] for t in p['threads']],
                  'archive_id':record['id'],'bucket':record['bucket'],'region':record['region']}
            new_index={**self.index,p['id']:meta}
            atomic_json(self.path,new_index)
            self.index=new_index;p['archive']=record['id'];p['pending']=False;p['sync_error']=''
        except (AppError,OSError) as error:
            p['sync_error']=str(error) if isinstance(error,AppError) else '本机工作区索引写入失败，未报告同步成功。'

    def _knowledge(self,p):
        return {**copy.deepcopy(p['knowledge']),'entries':self.memory.file_cards(p['id'],p['knowledge']['entries'])}

    def _selected_memory(self,p,memory):
        """档案全部保留；发送有限的相关上下文，右侧展示实际入选条目。"""
        body='\n'.join(s['text'] for s in p['document']['segments'])[:12000]
        grams={body[i:i+2] for i in range(len(body)-1)}
        def score(e):
            if e['target']!='file':return 1000
            words={e['content'][i:i+2] for i in range(len(e['content'])-1)}
            overlap=len(words & grams)/max(1,len(words))
            return (20 if e.get('file_id')==p['id'] else 0)+(10 if e.get('field') in ('role','background') else 0)+overlap
        ranked=sorted(memory,key=lambda e:(score(e),e.get('updated','')),reverse=True)
        selected=[];size=0
        for e in ranked:
            if len(selected)>=20:break
            if size+len(e['content'])>16000:continue
            if e['target']=='file' and e.get('file_id')!=p['id'] and e.get('field') not in ('role','background') and score(e)<.08:continue
            selected.append(copy.deepcopy(e));size+=len(e['content'])
        return selected

    def _view(self,p,t):
        memory=self.memory.snapshot()
        analysis=t.get('analysis')
        if t.get('global_revision')!=memory['revision'] or t.get('knowledge_revision')!=p['knowledge']['revision'] or t.get('provider')!=self._provider():analysis=None
        return {**copy.deepcopy(p['document']),'id':t['id'],'file_id':p['id'],'revision':t['revision'],
                'memory':self._selected_memory(p,memory['entries']),'memory_revision':memory['revision'],'knowledge':self._knowledge(p),
                'profile_basis':self._basis(p,t,memory,analysis),
                'messages':copy.deepcopy(t['messages']),'analysis':copy.deepcopy(analysis),'draft':copy.deepcopy(t.get('draft')),
                'threads':[{'id':item['id'],'title':item['title'],'messages':len(item['messages'])} for item in p['threads']],
                'stored':copy.deepcopy(p['stored']),'persistent':bool(p.get('archive')),'sync':self._sync_info(p),
                'highlights':[{**c,'countdown':countdown(c)} for c in p['highlights']],
                'send_authorized':t.get('send_authorized',False) and t.get('provider')==self._provider(),
                'outdated':bool(t['messages'] and analysis is None),'thread_context':t.get('context','')}

    def _basis(self,p,t,memory,analysis):
        selected=self._selected_memory(p,memory['entries'])
        ids=t.get('memory_ids',[]) if analysis else []
        used={ref for i in (analysis or {}).get('insights',[]) for ref in i['memory_refs']}
        if ids:selected=[e for e in memory['entries'] if e['id'] in ids]
        return [{**copy.deepcopy(e),'used':e['id'] in used,'provided':e['id'] in t.get('memory_ids',[]) and bool(analysis)} for e in selected]

    def _provider(self):
        c=self.model.status() if hasattr(self.model,'status') else {}
        return {'base_url':c.get('base_url',''),'model':c.get('model','')}

    def list_workspaces(self):
        with self.lock:
            status=self.storage.status();items={}
            for pid,item in self.index.items():
                items[pid]={**item,'persistent':True,'available':status['configured'] and item['bucket']==status['bucket'] and item['region']==status['region']}
            for pid,p in self.projects.items():
                items[pid]={'id':pid,'name':p['document']['name'],'updated':p['updated'],'preview':p.get('summary','')[:160],
                            'thread_ids':[t['id'] for t in p['threads']],'persistent':bool(p.get('archive')),
                            'available':True,'sync':self._sync_info(p)}
            return sorted(items.values(),key=lambda v:v['updated'],reverse=True)

    def upload(self,name,raw):
        document=parse_document(name,raw);digest=hashlib.sha256(raw).hexdigest();suffix=Path(name).suffix.lower()
        with self.lock:
            for pid in list(self.projects)+[p for p in self.index if p not in self.projects]:
                item=self.projects.get(pid) or self.index[pid]
                if item['sha256']==digest and item['suffix']==suffix:
                    p=self._load(pid);p['_raw']=raw
                    return self._view(p,next(t for t in p['threads'] if t['id']==p['active_thread']))
            if len(self.projects)>=50:raise AppError('已打开50份文件，请移除不需要的临时工作区后重试。',429)
            pid=uuid.uuid4().hex;document['id']=pid
            p={'schema':1,'id':pid,'document':document,'sha256':digest,'suffix':suffix,'threads':[],
               'active_thread':None,'knowledge':{'revision':0,'entries':[],'deleted_fields':[]},'stored':None,
               'cloud_enabled':False,'archive':None,'pending':False,'sync_error':'','updated':now(),'summary':'',
               'highlights':extract_highlights(document['segments']),'_raw':raw}
            self.projects[pid]=p
            return self.new_thread(pid)

    def new_thread(self,pid,title='新的对话'):
        title=text(title,'会话名称',100)
        with self.lock:
            p=self._load(pid)
            if len(p['threads'])>=30:raise AppError('每文件最多30个会话，请复用已有会话。')
            t={'id':uuid.uuid4().hex,'title':title,'revision':0,'messages':[],'analysis':None,'draft':None,'context':'',
               'global_revision':self.memory.snapshot()['revision'],'knowledge_revision':p['knowledge']['revision'],'send_authorized':False}
            p['threads'].append(t);p['active_thread']=t['id'];self._commit(p);return self._view(p,t)

    def open_workspace(self,pid,thread_id=None):
        with self.lock:
            p=self._load(pid);uid=thread_id or p['active_thread']
            t=next((t for t in p['threads'] if t['id']==uid),None)
            if not t:raise AppError('此会话不属于该文件。',404)
            p['active_thread']=t['id'];return self._view(p,t)

    def store_document(self,uid,consent):
        if consent is not True:raise AppError('请确认将原文件、全部对话和文件沉淀持续保存到COS。',403)
        with self.lock:
            p,t=self._thread(uid)
            p['cloud_enabled']=True;p['pending']=True
            if not p['stored']:
                try:p['stored']=self.storage.save(p['document']['name'],p['_raw'],consent=True)
                except AppError as error:p['sync_error']=str(error);raise
            self._commit(p)
            return {**p['stored'],'workspace_sync':self._sync_info(p)}

    def sync_workspace(self,pid,consent):
        with self.lock:
            p=self._load(pid)
            return self.store_document(p['active_thread'],consent)

    def open_stored(self,uid):
        name,raw=self.storage.read(uid);doc=self.upload(name,raw)
        with self.lock:
            p,t=self._thread(doc['id'])
            if not p['stored']:
                p['stored']=next(copy.deepcopy(r) for r in self.storage.records if r['id']==uid)
            return self._view(p,t)

    def _knowledge_updates(self,values,p,conversation,memory):
        if not isinstance(values,list) or len(values)>5:raise AppError('模型文件沉淀格式不正确。',502)
        source={s['id']:s['text'] for s in p['document']['segments']}
        users={m['id']:m['content'] for m in conversation if m['role']=='user'}
        if users:users['latest']=next(reversed(users.values()))
        global_refs={m['id']:m['content'] for m in memory}
        out=[];seen=set()
        for row in values:
            if not isinstance(row,dict) or row.get('field') not in FIELDS or row.get('field') in seen:raise AppError('模型文件沉淀字段不正确。',502)
            field=row['field'];seen.add(field)
            value=text(row.get('value'),'文件沉淀',2000,empty=field=='pending')
            kind=row.get('kind');quote=text(row.get('quote',''),'沉淀来源',2000,empty=not value)
            if not value and field=='pending':out.append({'field':field,'value':'','kind':'unknown'});continue
            if kind=='user_fact':source_value=users.get(row.get('message_id'));source_label='来自对话 · Agent整理'
            elif kind=='global_ref':source_value=global_refs.get(row.get('memory_id'));source_label='来自用户档案'
            elif kind in ('document_fact','inference','unknown'):source_value=source.get(row.get('source_id'));source_label={'document_fact':'来自原文','inference':'AI推断 · 未确认','unknown':'待核实'}[kind]
            else:raise AppError('模型沉淀来源类型不正确。',502)
            if not source_value or quote not in source_value:raise AppError('文件沉淀来源校验失败，未保存无依据内容。',502)
            out.append({'field':field,'label':FIELDS[field],'value':value,'kind':kind,'quote':quote,'source_id':row.get('source_id',''),
                        'message_id':row.get('message_id',''),'source':source_label,'locked':False,'updated':now()})
        return out

    def _invalidate(self,p,except_id=None):
        for t in p['threads']:
            if t['id']!=except_id:t['revision']+=1;t['analysis']=None

    def chat(self,uid,message,consent,on_delta=None):
        if consent is not True:raise AppError('请确认将文件、对话和相关沉淀发送给模型。',403)
        message=text(message,'消息',4000,empty=True)
        with self.lock:
            p,t=self._thread(uid)
            if t['messages'] and not message:raise AppError('已有对话，请继续输入问题。')
            if len(t['messages'])>=1000:raise AppError('本会话已保存500轮，请新开会话，原记录仍保留。')
            recent=copy.deepcopy(t['messages'][-12:])
            conversation=[{k:m[k] for k in ('id','role','content')} for m in recent]
            user={'id':uuid.uuid4().hex,'role':'user','content':message,'created':now()} if message else None
            if user:conversation.append({k:user[k] for k in ('id','role','content')})
            while sum(len(m['content']) for m in conversation)>28000 and len(conversation)>1:conversation.pop(0)
            t['revision']+=1;rev=t['revision'];t['analysis']=None
            knowledge_rev=p['knowledge']['revision'];memory=self.memory.snapshot();global_rev=memory['revision'];provider=self._provider()
            selected=self._selected_memory(p,memory['entries'])
            payload={'document':copy.deepcopy(p['document']),'background':[],'memory':selected,'conversation':conversation,
                     'file_knowledge':self._knowledge(p)['entries'],'deleted_fields':list(p['knowledge']['deleted_fields']),
                     'thread_context':t['context'],'earlier_turns':max(0,len(t['messages'])-len(recent))//2}
        def emit(field,value):
            with self.lock:
                current_p,current_t=self._thread(uid)
                if current_t['revision']!=rev or self.memory.snapshot()['revision']!=global_rev or current_p['knowledge']['revision']!=knowledge_rev or self._provider()!=provider:
                    raise AppError('档案已修改或请求已取消，流式结果停止生效。',409)
            on_delta(field,value)
        answer=self.model.complete_stream(WORKSPACE_SYSTEM,payload,emit) if on_delta else self.model.complete(WORKSPACE_SYSTEM,payload)
        checked=validate_analysis(answer,payload['document']['segments'],[],selected)
        updates=self._knowledge_updates(answer.get('file_knowledge_updates',answer.get('file_knowledge',[])),p,conversation,selected)
        context=text(answer.get('thread_context',t['context']),'会话目标',1000,empty=True)
        with self.lock:
            p,t=self._thread(uid)
            if t['revision']!=rev or p['knowledge']['revision']!=knowledge_rev or self.memory.snapshot()['revision']!=global_rev or self._provider()!=provider:
                raise AppError('沉淀、模型已修改或请求已取消，旧回复未生效，请按最新设置重试。',409)
            entries={e['field']:e for e in self._knowledge(p)['entries']};changed=False
            for row in updates:
                if [p['id'],row['field']] in memory.get('suppressed',[]) or row['field'] in p['knowledge']['deleted_fields'] or entries.get(row['field'],{}).get('locked'):continue
                if not row['value']:
                    if row['field'] in entries:del entries[row['field']];changed=True
                elif entries.get(row['field'],{}).get('value')!=row['value'] or entries.get(row['field'],{}).get('kind')!=row['kind']:
                    entries[row['field']]=row;changed=True
            archived=self.memory.sync_file(p['id'],p['document']['name'],list(entries.values()),expected_revision=global_rev)
            if changed:
                p['knowledge']['entries']=list(entries.values());p['knowledge']['revision']+=1;self._invalidate(p,uid)
            if user:t['messages'].append(user)
            t['messages'].append({'id':uuid.uuid4().hex,'role':'assistant','content':checked['response'],'analysis':checked,'memory':copy.deepcopy(selected),'knowledge':self._knowledge(p),'created':now()})
            t.update(analysis=checked,context=context,send_authorized=True,provider=provider,global_revision=archived['revision'],memory_ids=[e['id'] for e in selected],knowledge_revision=p['knowledge']['revision'])
            if len(t['messages'])<=2 and message:t['title']=message[:30]
            p['summary']=checked['summary'];self._commit(p)
            return {'analysis':checked,'revision':rev,'background':[],'memory':self._selected_memory(p,archived['entries']),
                    'knowledge':self._knowledge(p),'sync':self._sync_info(p),'document':self._view(p,t)}

    def edit_knowledge(self,pid,field,value,expected_revision):
        if field not in FIELDS:raise AppError('沉淀字段不正确。')
        value=text(value,'沉淀内容',2000,empty=True)
        with self.lock:
            p=self._load(pid);card=p['knowledge']
            if expected_revision!=card['revision']:raise AppError('卡片已更新，请重新加载后修改。',409)
            entries={e['field']:e for e in self._knowledge(p)['entries']}
            if value:
                entries[field]={'field':field,'label':FIELDS[field],'value':value,'kind':'user_fact','source':'用户修改 · 优先使用',
                                'quote':value,'source_id':'','message_id':'','locked':True,'updated':now()}
                if field in card['deleted_fields']:card['deleted_fields'].remove(field)
            else:
                entries.pop(field,None)
                if field not in card['deleted_fields']:card['deleted_fields'].append(field)
            self.memory.sync_file(pid,p['document']['name'],list(entries.values()),force_fields=[field])
            card['entries']=list(entries.values());card['revision']+=1;self._invalidate(p);self._commit(p)
            return {'knowledge':self._knowledge(p),'sync':self._sync_info(p)}

    def action(self,uid,revision,goal,confirmed,consent,on_delta=None):
        if confirmed is not True or consent is not True:raise AppError('请确认生成初稿与发送范围。',403)
        goal=text(goal,'目标',1000)
        with self.lock:
            p,t=self._thread(uid);memory=self.memory.snapshot();kr=p['knowledge']['revision'];gr=memory['revision'];provider=self._provider()
            if revision!=t['revision'] or not t['analysis'] or t['knowledge_revision']!=kr or t['global_revision']!=gr or t.get('provider')!=provider:
                raise AppError('背景或解读已更新，请先继续对话再生成。',409)
            payload={'document':copy.deepcopy(p['document']),'background':[],'memory':self._selected_memory(p,memory['entries']),
                     'file_knowledge':self._knowledge(p)['entries'],'analysis':copy.deepcopy(t['analysis']),
                     'conversation':[{k:m[k] for k in ('id','role','content')} for m in t['messages'][-12:]],'goal':goal}
        system=ACTION_SYSTEM+'\nfile_knowledge和memory中的用户修改优先于旧聊天；inference和unknown均未确认，其他文件的document_fact不能当作用户资格事实。'
        def emit(field,value):
            with self.lock:
                cp,ct=self._thread(uid)
                if ct['revision']!=revision or self.memory.snapshot()['revision']!=gr or cp['knowledge']['revision']!=kr or self._provider()!=provider:
                    raise AppError('档案已修改或请求取消，旧初稿停止输出。',409)
            on_delta(field,value)
        answer=self.model.complete_stream(system,payload,emit) if on_delta else self.model.complete(system,payload)
        draft={'title':text(answer.get('title'),'标题',200),'markdown':text(answer.get('markdown'),'正文',30000)}
        with self.lock:
            p,t=self._thread(uid)
            if t['revision']!=revision or p['knowledge']['revision']!=kr or self.memory.snapshot()['revision']!=gr or self._provider()!=provider:raise AppError('背景已更新或请求取消，旧初稿未生效。',409)
            t['draft']=draft;self._commit(p);return {'draft':draft,'revision':revision,'sync':self._sync_info(p)}

    def save_draft(self,uid,markdown):
        markdown=text(markdown,'草稿正文',30000,empty=True)
        with self.lock:
            p,t=self._thread(uid)
            if not t.get('draft'):raise AppError('还没有可编辑草稿。',409)
            t['draft']['markdown']=markdown;self._commit(p);return {'saved':True,'sync':self._sync_info(p)}

    def close_thread(self,uid):
        with self.lock:
            p,t=self._thread(uid);t['revision']+=1;self._commit(p);return {'closed':True,'sync':self._sync_info(p)}

    def cancel(self,uid):
        with self.lock:
            p,t=self._thread(uid);t['revision']+=1;t['analysis']=None;return {'cancelled':True}

    def refresh_memory(self,uid):
        with self.lock:
            p,t=self._thread(uid);self._invalidate(p);return {'refreshed':True}

    def analyze(self,uid,background,consent):
        if not isinstance(background,list) or len(background)>30:raise AppError('背景格式不正确。')
        return self.chat(uid,'\n'.join(text(v,'背景',1500) for v in background),consent)

    def forget(self,uid):return self.close_thread(uid)

    def delete_workspace(self,pid,consent):
        if consent is not True:raise AppError('移除文件及全部会话需要确认。',403)
        with self.lock:
            p=self._load(pid)
            archive_ids=[r['id'] for r in self.storage.records if r.get('kind')=='workspace' and r['name']==pid+'.json']
            for key in archive_ids:self.storage.delete(key,consent=True)
            if p.get('stored'):self.storage.delete(p['stored']['id'],consent=True)
            new={k:v for k,v in self.index.items() if k!=pid}
            if self.path.exists():atomic_json(self.path,new)
            self.index=new;self.projects.pop(pid,None);return {'deleted':True}
