"""仅合成验收HTTP替身。生产入口不导入；结果明确标注非真实LLM。"""
import argparse
import asyncio
import json
import os
import hashlib
from fastapi import FastAPI,Request
from fastapi.responses import JSONResponse
import uvicorn

app=FastAPI(title='FileAction synthetic HTTP model — NOT a real LLM')
app.state.calls=0
app.state.embedding_calls=0

@app.get('/health')
async def health(): return {'synthetic_only':True,'calls':app.state.calls,'embedding_calls':app.state.embedding_calls}

@app.post('/v1/embeddings')
async def embed(request:Request):
    """确定性合成向量，不宣称语义质量，只验证有界请求和协议。"""
    body=await request.json()
    texts=body.get('input',[])
    dimensions=body.get('dimensions')
    if body.get('model')!='synthetic-embedding-only' or dimensions!=768 or not isinstance(texts,list) or not 1<=len(texts)<=10:
        return JSONResponse({'error':'synthetic embedding contract mismatch'},status_code=400)
    app.state.embedding_calls+=1
    output=[]
    for i,text in enumerate(texts):
        if not isinstance(text,str): return JSONResponse({'error':'synthetic input invalid'},status_code=400)
        seed=hashlib.sha256(text.encode()).digest()
        vector=[(seed[n%32]+1)/256 for n in range(dimensions)]
        output.append({'index':i,'embedding':vector})
    return {'data':output,'usage':{'total_tokens':sum(len(t.encode()) for t in texts)}}

@app.post('/v1/chat/completions')
async def generate(request:Request):
    app.state.calls+=1
    body=await request.json()
    payload=json.loads(body['messages'][-1]['content'])
    context=payload.get('context',payload)
    await asyncio.sleep(float(os.getenv('FILEACTION_SYNTHETIC_DELAY_SECONDS','1')))
    if 'SYNTHETIC_HTTP_ERROR' in context.get('message',''):
        return JSONResponse({'error':'explicit synthetic failure'},status_code=503)
    if 'context' not in payload:
        answer=dict(intent='answer_question',evidence_requests=[],needs_user_input=False,question=None)
    else:
        claims=[]
        documents=context.get('documents',[])
        if documents and documents[0]['segments']:
            doc=documents[0]; segment=doc['segments'][0]; quote=segment['text'][:80]
            claims=[dict(id='synthetic-claim-1',text='合成HTTP替身引用原文：'+quote,kind='document_fact',evidence=[dict(type='document',document_id=doc['document_id'],version=doc['document_version_id'],segment_id=segment['segment_id'],quote=quote)])]
        artifact=None
        if context['kind']=='generate_artifact':
            artifact=dict(title='合成HTTP替身草稿',kind='markdown',body='# 合成验收草稿\n\n此正文来自本地HTTP测试替身，非真实模型生成。')
        actions=[dict(id='synthetic-action-1',text='合成验收建议：核对申请资料',evidence=claims[0]['evidence'])] if claims else []
        answer=dict(summary='这是本地合成HTTP替身的流程验收回答，非真实LLM解读。',claims=claims,questions=[],memory_candidates=[],action_candidates=actions,unknowns=['合成替身不判断个人资格或真实事务。'],coverage=context['coverage'],artifact=artifact)
    return {'choices':[{'finish_reason':'stop','message':{'content':json.dumps(answer,ensure_ascii=False),'refusal':None}}]}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description='显式合成HTTP验收服务（非真实LLM）')
    parser.add_argument('--port',type=int,default=18941)
    args=parser.parse_args()
    if os.getenv('FILEACTION_SYNTHETIC_HTTP_GATEWAY')!='1': raise SystemExit('必须显式设置FILEACTION_SYNTHETIC_HTTP_GATEWAY=1')
    uvicorn.run(app,host='127.0.0.1',port=args.port,access_log=False)
