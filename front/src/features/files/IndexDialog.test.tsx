import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {ApiClient} from '../../shared/api';
import {IndexDialog} from './IndexDialog';

afterEach(()=>{cleanup();vi.unstubAllGlobals()});
const doc={id:'synthetic-doc',name:'合成索引.txt',revision:1,retention:'temporary' as const,parse_status:'ready',index_status:'not_requested',current_version_id:'version-1'};
function setup(fail=false,pending=false){
  const requests:{url:string,body:any}[]=[];
  vi.stubGlobal('fetch',async(url:string,options:RequestInit={})=>{
    const body=options.body?JSON.parse(String(options.body)):{};requests.push({url,body});
    let data:unknown=doc;
    if(url.endsWith('/auth/csrf'))data={csrf_token:'synthetic'};
    else if(url.endsWith('/index-preview')){
      if(fail)return Response.json({error:{code:'EMBEDDING_NOT_CONFIGURED',message:'Embedding服务尚未配置'}},{status:503});
      data={preview_id:'preview',manifest_hash:'a'.repeat(64),revision:1,provider_domain:'synthetic.invalid',model:'synthetic-embedding',dimensions:768,retention:'temporary',chunks:[{id:'chunk',text:'仅供合成索引验收的正文'}],batches:[['chunk']],budgets:{max_requests:16}};
    }else if(url.endsWith('/indexes'))data=options.method==='DELETE'?{status:pending?'cleanup_pending':'deleted'}:{id:'job',status:'queued',completed_chunks:0,total_chunks:1};
    else if(url.includes('/index-jobs/'))data={id:'job',status:url.endsWith('/cancel')?'cancelled':'running',completed_chunks:0,total_chunks:1};
    return Response.json({data});
  });
  const cache=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={cache}><IndexDialog doc={doc} api={new ApiClient()} userId='synthetic-user' close={vi.fn()} /></QueryClientProvider>);
  return requests;
}
it('预览无外发，独立确认后创建并可取消索引任务',async()=>{
  const requests=setup();
  fireEvent.click(screen.getByRole('button',{name:'预览索引外发范围'}));
  expect(await screen.findByText('仅供合成索引验收的正文')).toBeInTheDocument();
  expect(requests.some(r=>r.url.endsWith('/indexes'))).toBe(false);
  const submit=screen.getByRole('button',{name:'同意发送并建立语义索引'});
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox',{name:'同意将以上片段发送给所示 Embedding 服务'}));
  fireEvent.click(submit);
  await waitFor(()=>expect(requests.find(r=>r.url.endsWith('/indexes'))?.body.consent_to_embed).toBe(true));
  fireEvent.click(await screen.findByRole('button',{name:'取消索引任务'}));
  expect(await screen.findByText('已取消')).toBeInTheDocument();
  expect(requests.find(r=>r.url.endsWith('/cancel'))?.body.confirmed).toBe(true);
});
it('未配置服务时展示真实失败，不创建任务',async()=>{
  const requests=setup(true);
  fireEvent.click(screen.getByRole('button',{name:'预览索引外发范围'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Embedding服务尚未配置');
  expect(requests.some(r=>r.url.endsWith('/indexes'))).toBe(false);
});
it('清理未完成不显示已删除，仍可明确重试撤销',async()=>{
  setup(false,true);
  fireEvent.click(screen.getByRole('button',{name:'撤销语义索引'}));
  fireEvent.click(screen.getByRole('button',{name:'确认撤销语义索引'}));
  expect(await screen.findByText('索引已停用，临时内容仍在清理中，请重试清理。')).toBeInTheDocument();
  expect(screen.queryByText('语义索引已撤销，原文保留。')).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'撤销语义索引'})).toBeEnabled();
});
