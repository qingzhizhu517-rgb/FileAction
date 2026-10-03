"""无循环、无外部追踪、无正文checkpoint的有界LangGraph。"""
from decimal import Decimal
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from langsmith import tracing_context
from pydantic import ValidationError
from .contracts import AgentError, Plan, validate_answer, validate_evidence
from .prompts import policy

class State(TypedDict):
    run_id: str
    node: str
    model_calls: int
    tool_calls: int

def resolve_tools(plan,manifest):
    docs={d['document_id']:d for d in manifest['documents']}
    result=[]
    for request in plan.evidence_requests:
        args=request.arguments
        if request.tool=='search_evidence':
            if any(i not in docs for i in args.document_ids): raise AgentError('TOOL_SCOPE_INVALID')
            selected=args.document_ids or list(docs)
            found=[dict(document_id=i,version=docs[i]['document_version_id'],**s) for i in selected for s in docs[i]['segments'] if args.query.casefold() in s['text'].casefold()]
            result.append(found[:args.limit])
        elif request.tool=='read_segments':
            found=[]
            for ref in args.segments:
                doc=docs.get(ref.document_id)
                if not doc or doc['document_version_id']!=ref.version: raise AgentError('TOOL_SCOPE_INVALID')
                parts=[s for s in doc['segments'] if s['segment_id']==ref.segment_id]
                if not parts: raise AgentError('TOOL_SCOPE_INVALID')
                found.extend(parts)
            result.append(found)
        elif request.tool=='inspect_confirmed_facts':
            facts={f['id']:f for f in manifest['facts'] if f.get('confirmed')}
            if any(i not in facts for i in args.fact_ids): raise AgentError('TOOL_SCOPE_INVALID')
            result.append([facts[i] for i in args.fact_ids])
        elif request.tool=='read_artifact_version':
            artifact=manifest.get('selected_artifact')
            if not artifact or artifact['id']!=args.artifact_id or artifact['version']!=args.version: raise AgentError('TOOL_SCOPE_INVALID')
            result.append(artifact)
        else:
            evidence=validate_evidence(args.evidence,manifest)
            result.append(dict(value=str(Decimal(str(args.numerator))/Decimal(str(args.denominator))),evidence=evidence))
    return result

class BoundedAgent:
    async def run(self,run_id,manifest,call,phase,resolve_hybrid=None):
        content={}
        async def plan(state):
            await phase('planning')
            raw=await call('planning',policy('planning'),manifest)
            try: content['plan']=Plan.model_validate(raw)
            except ValidationError: raise AgentError('MODEL_PLAN_INVALID') from None
            return {'node':'planning','model_calls':1}
        async def resolve(state):
            await phase('resolving_evidence')
            if manifest.get('retrieval_mode')=='hybrid' and resolve_hybrid:
                content['context'],content['tools']=await resolve_hybrid(content.get('plan'))
            else:
                content['tools']=resolve_tools(content['plan'],manifest) if 'plan' in content else []
            return {'node':'resolving_evidence','tool_calls':len(content.get('plan').evidence_requests) if 'plan' in content else 0}
        async def generate(state):
            await phase('generating')
            if state['model_calls']>=2: raise AgentError('MODEL_BUDGET_EXCEEDED')
            payload={'context':content.get('context',manifest),'tool_results':content['tools']}
            if 'plan' in content: payload['plan']=content['plan'].model_dump()
            content['raw']=await call('generating',policy('generating'),payload)
            return {'node':'generating','model_calls':state['model_calls']+1}
        async def validate(state):
            await phase('validating')
            content['answer']=validate_answer(content['raw'],content.get('context',manifest))
            return {'node':'validating'}
        graph=StateGraph(State)
        for name,fn in [('planning',plan),('resolving_evidence',resolve),('generating',generate),('validating',validate)]: graph.add_node(name,fn)
        graph.add_edge(START,'planning' if manifest['kind'] in {'chat','propose_actions'} else 'resolving_evidence')
        graph.add_edge('planning','resolving_evidence')
        graph.add_edge('resolving_evidence','generating')
        graph.add_edge('generating','validating')
        graph.add_edge('validating',END)
        with tracing_context(enabled=False):
            await graph.compile().ainvoke({'run_id':run_id,'node':'preparing_context','model_calls':0,'tool_calls':0},config={'recursion_limit':8,'callbacks':[]})
        return content['answer']
