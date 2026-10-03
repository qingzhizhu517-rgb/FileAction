import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { SessionContext } from '../../app/session';
import { ApiClient } from '../../shared/api';
import { DeliverablesPage } from './DeliverablesPage';
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks()});
it('保存新版后旧版缓存重新核对，历史下载仍需确认且携带最新revision',async()=>{
  let current=1;const exports:any[]=[];
  const artifact=(version:number)=>({id:'a',workspace_id:'ws',title:'缓存合成成果',body:version===1?'模型原稿':'用户新版',version,current_version:current,revision:current,author_kind:version===1?'model':'user',historical:version!==current,retention:'temporary',validity:'current',sources:[],unknowns:[],verification_note:'合成提示'});
  vi.stubGlobal('fetch',async(path:string,options:RequestInit={})=>{
    if(path.endsWith('/auth/csrf'))return Response.json({data:{csrf_token:'synthetic'}});
    if(options.method==='PATCH'){current=2;return Response.json({data:artifact(2)})}
    if(path.endsWith('/export')){exports.push(JSON.parse(String(options.body)));return new Response('合成原稿')}
    if(path.endsWith('/artifacts'))return Response.json({data:{items:[artifact(current)]}});
    if(path.endsWith('/versions'))return Response.json({data:{items:Array.from({length:current},(_,i)=>artifact(i+1))}});
    if(path.includes('/artifacts/a'))return Response.json({data:artifact(Number(new URL(path,'http://test').searchParams.get('version')??current))});
    return Response.json({data:{items:[]}});
  });
  const url=vi.fn(()=> 'blob:synthetic');vi.stubGlobal('URL',class extends URL{static createObjectURL=url;static revokeObjectURL=vi.fn()});vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  render(<MemoryRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,staleTime:15000}}})}><SessionContext.Provider value={{user:{id:'u',username:'synthetic',display_name:'合成',revision:1},api:new ApiClient(),logout:async()=>{}}}><DeliverablesPage/></SessionContext.Provider></QueryClientProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button',{name:'查看与编辑 缓存合成成果'}));
  fireEvent.change(await screen.findByLabelText('成果正文'),{target:{value:'用户新版'}});
  fireEvent.click(screen.getByRole('button',{name:'保存为新版本'}));
  await vi.waitFor(()=>expect(screen.getByLabelText('查看版本')).toHaveValue('2'));
  fireEvent.change(screen.getByLabelText('查看版本'),{target:{value:'1'}});
  await vi.waitFor(()=>expect(screen.getByLabelText('成果正文')).toHaveValue('模型原稿'));
  fireEvent.click(screen.getByRole('button',{name:'下载此版本 Markdown'}));
  expect(await screen.findByText('确认导出历史或过时版本')).toBeInTheDocument();
  expect(exports).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:'确认下载所选版本'}));
  await vi.waitFor(()=>expect(exports).toHaveLength(1));
  expect(exports[0]).toMatchObject({version:1,expected_revision:2,confirm_historical:true});
});
it('编辑冲突保留dirty内容，关闭需放弃确认，历史导出明确确认并下载二进制',async()=>{
  const calls:{path:string;body:any}[]=[];
  const latest={id:'a',workspace_id:'ws',title:'合成成果',body:'用户第二版',version:2,current_version:2,revision:2,author_kind:'user',historical:false,retention:'temporary',validity:'current',sources:[],unknowns:['合成未知项'],verification_note:'用户编辑内容未经自动核验'};
  vi.stubGlobal('fetch',async(path:string,options:RequestInit={})=>{
    const body=options.body?JSON.parse(String(options.body)):undefined; calls.push({path,body});
    if(options.method==='PATCH')return Response.json({error:{code:'REVISION_CONFLICT',message:'版本已变化，请核对'}},{status:409});
    if(path.endsWith('/export'))return new Response('所选历史Markdown',{headers:{'Content-Type':'text/markdown'}});
    const old={...latest,body:'模型第一版',version:1,author_kind:'model',historical:true};
    let data:unknown={items:[]};
    if(path.endsWith('/auth/csrf'))data={csrf_token:'synthetic'};
    else if(path.endsWith('/artifacts'))data={items:[latest]};
    else if(path.endsWith('/versions'))data={items:[old,latest]};
    else if(path.includes('/artifacts/a'))data=path.includes('version=1')?old:latest;
    return Response.json({data});
  });
  const url=vi.fn(()=> 'blob:synthetic'); vi.stubGlobal('URL',class extends URL {static createObjectURL=url;static revokeObjectURL=vi.fn()});
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  render(<MemoryRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><SessionContext.Provider value={{user:{id:'u',username:'synthetic',display_name:'合成',revision:1},api:new ApiClient(),logout:async()=>{}}}><DeliverablesPage/></SessionContext.Provider></QueryClientProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button',{name:'查看与编辑 合成成果'}));
  const editor=await screen.findByLabelText('成果正文');
  fireEvent.change(editor,{target:{value:'尚未保存的编辑'}});
  fireEvent.click(screen.getByRole('button',{name:'保存为新版本'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('版本已变化');
  expect(editor).toHaveValue('尚未保存的编辑');
  fireEvent.click(screen.getByRole('button',{name:'关闭'}));
  expect(screen.getByText('尚有未保存的修改')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'继续编辑'}));
  fireEvent.change(screen.getByLabelText('成果正文'),{target:{value:'用户第二版'}});
  fireEvent.change(screen.getByLabelText('查看版本'),{target:{value:'1'}});
  await vi.waitFor(()=>expect(screen.getByLabelText('成果正文')).toHaveValue('模型第一版'));
  fireEvent.click(screen.getByRole('button',{name:'下载此版本 Markdown'}));
  expect(screen.getByText('确认导出历史或过时版本')).toBeInTheDocument();
  expect(calls.some(c=>c.path.endsWith('/export'))).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'确认下载所选版本'}));
  await vi.waitFor(()=>expect(url).toHaveBeenCalled());
  expect(calls.find(c=>c.path.endsWith('/export'))?.body).toMatchObject({version:1,expected_revision:2,confirm_historical:true});
});
it('下载后保留服务端所选版本的保存入口，切换版本时撤回旧入口',async()=>{
  const artifact={id:'a',workspace_id:'ws',title:'合成成果',body:'用户第二版',version:2,current_version:2,revision:2,author_kind:'user',historical:false,retention:'temporary',validity:'current',sources:[],unknowns:[],verification_note:'合成提示'};
  const old={...artifact,version:1,body:'模型第一版',historical:true};
  vi.stubGlobal('fetch',async(path:string)=>{
    if(path.endsWith('/export')){
      const response=new Response('服务端导出的第二版与来源说明',{headers:{'Content-Type':'text/markdown'}});
      // Node Response 与 jsdom FileReader 分属不同环境，模拟浏览器同环境 Blob。
      response.blob=async()=>new Blob([await response.text()],{type:'text/markdown'});
      return response;
    }
    let data:unknown={items:[]};
    if(path.endsWith('/auth/csrf'))data={csrf_token:'synthetic'};
    else if(path.endsWith('/artifacts'))data={items:[artifact]};
    else if(path.endsWith('/versions'))data={items:[old,artifact]};
    else if(path.includes('/artifacts/a'))data=path.includes('version=1')?old:artifact;
    return Response.json({data});
  });
  const create=vi.fn((_blob:Blob)=> 'blob:exported-v2'),revoke=vi.fn();
  const writeText=vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator',{...navigator,clipboard:{writeText}});
  vi.stubGlobal('URL',class extends URL{static createObjectURL=create;static revokeObjectURL=revoke});
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  render(<MemoryRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><SessionContext.Provider value={{user:{id:'u',username:'synthetic',display_name:'合成',revision:1},api:new ApiClient(),logout:async()=>{}}}><DeliverablesPage/></SessionContext.Provider></QueryClientProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button',{name:'查看与编辑 合成成果'}));
  await screen.findByLabelText('成果正文');
  fireEvent.click(screen.getByRole('button',{name:'下载此版本 Markdown'}));
  const link=await screen.findByRole('link',{name:'保存 合成成果-v2.md'});
  expect(link).toHaveAttribute('href','blob:exported-v2');
  expect(link).toHaveAttribute('download','合成成果-v2.md');
  const exported=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsText(create.mock.calls[0][0])});
  expect(exported).toBe('服务端导出的第二版与来源说明');
  fireEvent.click(screen.getByRole('button',{name:'复制导出内容'}));
  await vi.waitFor(()=>expect(writeText).toHaveBeenCalledWith('服务端导出的第二版与来源说明'));
  expect(await screen.findByText('已复制所选版本及来源说明')).toBeInTheDocument();
  expect(screen.queryByText('下载成功')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('查看版本'),{target:{value:'1'}});
  await vi.waitFor(()=>expect(screen.queryByRole('link',{name:'保存 合成成果-v2.md'})).not.toBeInTheDocument());
  expect(revoke).toHaveBeenCalledWith('blob:exported-v2');
});
