import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { SessionContext } from '../../app/session';
import { ApiClient } from '../../shared/api';
import { ActionsPage } from './ActionsPage';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('只有用户明确确认才创建行动，完成仅为用户记录的状态', async () => {
  const calls: {path:string;body:any;method:string}[]=[]; let actions:any[]=[];
  vi.stubGlobal('fetch', async (path:string, options:RequestInit={}) => {
    const body=options.body ? JSON.parse(String(options.body)) : undefined;
    calls.push({path,body,method:options.method??'GET'});
    let data:unknown={items:[]};
    if(path.endsWith('/auth/csrf')) data={csrf_token:'synthetic'};
    else if(path.endsWith('/workspaces/temporary')) data={items:[{id:'ws',title:'合成工作区',revision:1,retention:'temporary'}]};
    else if(path.endsWith('/actions')&&options.method==='POST') { actions=[{id:'a',workspace_id:'ws',title:body.title,status:'confirmed',priority:'normal',revision:1,retention:'temporary',origin_kind:'user_created'}]; data=actions[0]; }
    else if(path.endsWith('/actions/a')&&options.method==='PATCH') { actions=[{...actions[0],status:body.status,revision:2}]; data=actions[0]; }
    else if(path.endsWith('/actions')) data={items:actions};
    return Response.json({data});
  });
  render(<MemoryRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><SessionContext.Provider value={{user:{id:'u',username:'synthetic',display_name:'合成',revision:1},api:new ApiClient(),logout:async()=>{}}}><ActionsPage/></SessionContext.Provider></QueryClientProvider></MemoryRouter>);
  expect(await screen.findByText('还没有确认的行动')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'新建行动'}));
  fireEvent.change(screen.getByLabelText('行动标题'),{target:{value:'合成下一步'}});
  expect(calls.filter(c=>c.method==='POST'&&c.path.endsWith('/actions'))).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:'确认创建行动'}));
  expect(await screen.findByText('合成下一步')).toBeInTheDocument();
  expect(calls.find(c=>c.method==='POST'&&c.path.endsWith('/actions'))?.body.confirmed).toBe(true);
  fireEvent.change(screen.getByLabelText('合成下一步的状态'),{target:{value:'completed'}});
  await vi.waitFor(()=>expect(calls.find(c=>c.method==='PATCH')?.body).toEqual({expected_revision:1,status:'completed'}));
});
