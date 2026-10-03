"""真实 OpenAI 兼容 JSON HTTP；无重试、无生产替身、无自动修复。"""
import asyncio
import json
import httpx
from .contracts import AgentError

class JsonGateway:
    capabilities=dict(json_mode=True,native_tool_calling=False,streaming=False,vision=False,output_budget_parameter=False)
    def __init__(self,base_url,model,api_key,*,client=None):
        if not base_url or not model or not api_key: raise AgentError('MODEL_NOT_CONFIGURED')
        self.url=base_url.rstrip('/')+'/chat/completions'
        self.model,self.api_key,self.client=model,api_key,client

    async def generate(self,policy,payload):
        if self.client is None:
            async with httpx.AsyncClient(timeout=60,follow_redirects=False) as client:
                return await self._request(client,policy,payload)
        return await self._request(self.client,policy,payload)

    async def _request(self,client,policy,payload):
        try:
            body={'model':self.model,'response_format':{'type':'json_object'},'messages':[{'role':'system','content':policy},{'role':'user','content':json.dumps(payload,ensure_ascii=False,allow_nan=False)}]}
            # UTF-8 bytes conservatively bound input tokens, including policy/schema and tool results.
            # 约 100 万 UTF-8 字节，给长文档的分段与引用元数据留出空间；供应商更小的上下文限制仍会返回明确错误。
            if len(json.dumps(body,ensure_ascii=False,allow_nan=False).encode())>1000000:
                raise AgentError('CONTEXT_BUDGET_EXCEEDED')
            async with asyncio.timeout(60):
                async with client.stream('POST',self.url,headers={'Authorization':'Bearer '+self.api_key},json=body,timeout=60) as response:
                    if response.status_code>=300: raise AgentError('MODEL_HTTP_ERROR')
                    size=0; chunks=[]
                    async for chunk in response.aiter_bytes():
                        size+=len(chunk)
                        if size>1048576: raise AgentError('MODEL_RESPONSE_TOO_LARGE')
                        chunks.append(chunk)
                result=json.loads(b''.join(chunks))
                choice=result['choices'][0]
                if choice.get('finish_reason')!='stop': raise AgentError('MODEL_TRUNCATED')
                if choice['message'].get('refusal'): raise AgentError('MODEL_REFUSED')
                answer=json.loads(choice['message']['content'])
                if not isinstance(answer,dict): raise AgentError('MODEL_JSON_INVALID')
                return answer
        except (httpx.TimeoutException,TimeoutError): raise AgentError('MODEL_TIMEOUT') from None
        except httpx.HTTPError: raise AgentError('MODEL_UNAVAILABLE') from None
        except (KeyError,IndexError,TypeError,ValueError) as exc:
            if isinstance(exc,AgentError): raise
            raise AgentError('MODEL_JSON_INVALID') from None
