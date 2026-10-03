export type ActionStatus='confirmed'|'in_progress'|'draft_ready'|'paused'|'completed';
export type ActionItem={id:string;workspace_id:string;title:string;description?:string;status:ActionStatus;priority:'low'|'normal'|'high';due_at?:string|null;revision:number;retention:'temporary'|'retained';origin_kind:string;source?:{run_id:string;candidate_id:string}|null};
export type ActionProposal={proposal_id:string;text:string;evidence:unknown[]};
export const actionStatusLabels:Record<ActionStatus,string>={confirmed:'已确认',in_progress:'进行中',draft_ready:'草稿就绪',paused:'已暂停',completed:'用户标记完成'};
