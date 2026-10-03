"""仅合成文本与HTTP替身；不调用云模型。"""
import json
import httpx
import pytest

def envelope():
    return dict(summary='合成摘要', claims=[dict(id='c1', text='合成事实',kind='document_fact', evidence=[dict(type='document',document_id='d',version='v',segment_id='s',quote='允许')])],questions=[],memory_candidates=[],action_candidates=[],unknowns=[],coverage='full_selected_text',artifact=None)

def manifest():
    return dict(kind='interpret',coverage='selected_excerpts', documents=[dict(document_id='d',document_version_id='v',segments=[dict(segment_id='s',text='允许片段',char_start=7)])],facts=[])

def test_validates_exact_quote_scope_kind_and_server_offsets():
    from fileaction.agent.contracts import validate_answer, AgentError
    answer = validate_answer(envelope(),manifest())
    assert answer['coverage'] == 'selected_excerpts'
    assert answer['claims'][0]['evidence'][0]['char_start'] == 7
    for change in ({'quote':'不存在'},{'document_id':'foreign'},{'version':'old'}):
        value=envelope(); value['claims'][0]['evidence'][0].update(change)
        with pytest.raises(AgentError,match='EVIDENCE_INVALID'): validate_answer(value,manifest())
    value=envelope(); value['claims'][0]['kind']='user_fact'
    with pytest.raises(AgentError,match='EVIDENCE_INVALID'): validate_answer(value,manifest())

def test_plan_forbids_arbitrary_tools_and_excessive_budget():
    from fileaction.agent.contracts import Plan
    from pydantic import ValidationError
    for tool in ('shell','http','sql'):
        with pytest.raises(ValidationError): Plan.model_validate(dict(intent='clarify',evidence_requests=[dict(tool=tool,arguments={})],needs_user_input=False,question=None))
    with pytest.raises(ValidationError): Plan.model_validate(dict(intent='clarify',evidence_requests=[dict(tool='search_evidence',arguments=dict(query='x',document_ids=[],limit=1))]*7,needs_user_input=False,question=None))

@pytest.mark.asyncio
@pytest.mark.parametrize('case', ['good','refusal','truncated','large','invalid','timeout'])
async def test_gateway_bounded_and_never_repairs(case):
    from fileaction.agent.gateway import JsonGateway
    from fileaction.agent.contracts import AgentError
    calls=[]
    async def handler(request):
        calls.append(request)
        if case=='timeout': raise httpx.ReadTimeout('synthetic')
        if case=='large': return httpx.Response(200,content=b'x'*(1048576+1))
        if case=='invalid': return httpx.Response(200,content=b'{}')
        return httpx.Response(200,json={'choices':[{'finish_reason':'length' if case=='truncated' else 'stop','message':{'content':json.dumps(envelope()),'refusal':'no' if case=='refusal' else None}}]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        gateway=JsonGateway('https://synthetic.invalid/v1','synthetic','synthetic',client=client)
        if case=='good': assert (await gateway.generate('policy',{}))['summary']=='合成摘要'
        else:
            with pytest.raises(AgentError): await gateway.generate('policy',{})
    assert len(calls)==1

@pytest.mark.asyncio
@pytest.mark.parametrize('kind,calls_expected',[('interpret',1),('generate_artifact',1),('chat',2),('propose_actions',2)])
async def test_graph_bounds_calls_and_keeps_content_out_of_state(kind,calls_expected):
    from fileaction.agent.graph import BoundedAgent
    sent=[]; phases=[]
    context=manifest(); context['kind']=kind
    async def call(stage,policy,payload):
        sent.append(stage)
        if stage=='planning': return dict(intent='answer_question',evidence_requests=[],needs_user_input=False,question=None)
        value=envelope()
        if kind=='generate_artifact': value['artifact']=dict(title='合成产物',kind='markdown',body='合成正文')
        return value
    async def phase(value): phases.append(value)
    result=await BoundedAgent().run('r',context,call,phase)
    assert len(sent)==calls_expected
    assert result['summary']=='合成摘要'
    assert phases[-1]=='validating'

def test_tools_cannot_expand_manifest_or_access_unselected_drafts():
    from fileaction.agent.graph import resolve_tools
    from fileaction.agent.contracts import Plan,AgentError
    plan=Plan.model_validate(dict(intent='answer_question',needs_user_input=False,question=None,evidence_requests=[dict(tool='search_evidence',arguments=dict(query='允许',document_ids=['foreign'],limit=6))]))
    with pytest.raises(AgentError,match='TOOL_SCOPE_INVALID'): resolve_tools(plan,manifest())

def test_workspace_summary_does_not_publish_internal_run_content():
    from types import SimpleNamespace
    from fileaction.workspaces.service import WorkspaceService
    value=dict(id='workspace',revision=1,title='合成工作区',answers={'uncommitted':'private'},artifacts=[{'body':'uncommitted'}],active_run='r',cancel_epoch=3,actions={'private':'action'},action_requests={'private':'request'},shown_proposals={'private':'proposal'})
    assert WorkspaceService.public(SimpleNamespace(value=value))==dict(id='workspace',revision=1,title='合成工作区')

@pytest.mark.asyncio
async def test_public_messages_filter_uncommitted_generated_assistant():
    from types import SimpleNamespace
    from fileaction.workspaces.routes import visible_messages
    from fileaction.runs.errors import RunError
    messages={'items':[{'id':'user','role':'user','text':'用户输入'},{'id':'assistant','role':'assistant','text':'未提交答案','run_id':'pending'}],'next_cursor':None}
    class Reader:
        async def result(self,actor,identifier): raise RunError('RESULT_NOT_AVAILABLE')
    result=await visible_messages(messages,Reader(),None)
    assert [item['id'] for item in result['items']]==['user']

@pytest.mark.asyncio
async def test_gateway_full_request_budget_prevents_http_send():
    from fileaction.agent.gateway import JsonGateway
    from fileaction.agent.contracts import AgentError
    def forbidden(request): raise AssertionError('超限不得发送HTTP')
    async with httpx.AsyncClient(transport=httpx.MockTransport(forbidden)) as client:
        gateway=JsonGateway('https://synthetic.invalid/v1','synthetic','synthetic',client=client)
        with pytest.raises(AgentError,match='CONTEXT_BUDGET_EXCEEDED'):
            await gateway.generate('policy'*200000,{'text':'x'*2000})
