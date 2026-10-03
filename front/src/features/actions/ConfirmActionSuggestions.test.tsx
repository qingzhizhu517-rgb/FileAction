import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router';
import {SessionContext} from '../../app/session';
import {ApiClient} from '../../shared/api';
import {ConfirmActionSuggestions} from './ConfirmActionSuggestions';
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
it('已核验建议展示后仍需显式确认，POST不接受客户端建议正文',async()=>{
  const posts:unknown[]=[];
  vi.stubGlobal('fetch',async(path:string,options:RequestInit={})=>{
    if(path.endsWith('/auth/csrf'))return Response.json({data:{csrf_token:'synthetic'}});
    if(options.method==='POST'){posts.push(JSON.parse(String(options.body)));return Response.json({data:{id:'a'}})}
    return Response.json({data:{items:[{proposal_id:'r:p',text:'合成准备建议',evidence:[]}]}});
  });
  render(<MemoryRouter><QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><SessionContext.Provider value={{user:{id:'u',username:'synthetic',display_name:'合成',revision:1},api:new ApiClient(),logout:async()=>{}}}><ConfirmActionSuggestions workspaceId='w' runId='r'/></SessionContext.Provider></QueryClientProvider></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button',{name:'确认此建议为行动 1'}));
  expect(posts).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:'确认创建此行动'}));
  expect(await screen.findByText('已确认创建')).toBeInTheDocument();
  expect(posts).toEqual([{workspace_id:'w',proposal_id:'r:p',confirmed:true}]);
});
