import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TaskStatePluginNextGen, AgentContextNextGen, FileContextStorage, simpleTokenEstimator, ToolManager } from '../../../../src/index.js';
import type { TaskStateNoteInput, TaskStatePluginConfig, TaskStateHostDelta, ToolExecutionOutcome } from '../../../../src/index.js';
const scope={ownerId:'host',namespace:'corrections'};
const plugins:TaskStatePluginNextGen[]=[];
const make=(config:Partial<TaskStatePluginConfig>={})=>{const p=new TaskStatePluginNextGen({scope,taskId:'task',...config});plugins.push(p);return p;};
const note=(id:string,text='Cap 40',extra={}):TaskStateNoteInput=>({id,category:'constraint',text,source:{label:'Host'},...extra});
const outcome=(extra:Partial<ToolExecutionOutcome>={}):ToolExecutionOutcome=>({executionId:'exec',toolName:'submit',status:'timed_out',startedAt:1,durationMs:2,executionStarted:true,completion:'unknown',cancellation:'requested',...extra});
afterEach(()=>plugins.splice(0).forEach(p=>p.destroy()));
function restorable(p:TaskStatePluginNextGen){expect(p.validateState(p.getState())).toEqual(p.getState());const fresh=make();fresh.restoreState(p.getState());expect(fresh.getState()).toEqual(p.getState());}

describe('Stage 04 correction: pruning and ID incarnations',()=>{
  it('detaches a pruned predecessor before ID reuse and roundtrips a real checkpoint',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'task-correction-session-'));const storage=new FileContextStorage({agentId:'test',baseDirectory:dir});
    const create=()=>AgentContextNextGen.create({model:'gpt-4o-mini',userId:scope.ownerId,agentId:'test',storage,features:{workingMemory:false,inContextMemory:false,taskState:true},plugins:{taskState:{scope,taskId:'task'}}});let ctx=create();
    try{const p=ctx.getPlugin<TaskStatePluginNextGen>('task_state')!;p.updateHost({notes:[note('old'),note('new','Corrected',{supersedes:'old'})]},0);p.pruneResolved(['old'],[],1);expect(p.getState().notes[0]?.supersedes).toBe('old');p.updateHost({notes:[note('old','Unrelated new incarnation')]},2);expect(p.getState().notes[0]?.supersedes).toBeUndefined();const state=p.getState();await ctx.save('reuse');ctx.destroy();ctx=create();expect(await ctx.load('reuse')).toBe(true);expect(ctx.getPlugin<TaskStatePluginNextGen>('task_state')!.getState()).toEqual(state);}finally{ctx.destroy();await rm(dir,{recursive:true,force:true});}
  });
  it.each(['updateHost','propose','assume'] as const)('%s reuse of a pruned replacement never reactivates the older host constraint',method=>{
    const p=make();p.updateHost({notes:[note('old'),note('replacement','Corrected',{supersedes:'old'})]},0);p.updateHost({resolve:['replacement']},1);p.pruneResolved(['replacement'],[],2);
    if(method==='updateHost')p.updateHost({notes:[note('replacement','Different task data')]},3);else p[method]([note('replacement','Unconfirmed data')],3);
    expect(p.getState().notes.find(n=>n.id==='old')).toMatchObject({authority:'host',resolved:true,text:'Cap 40'});expect(p.getState().notes.find(n=>n.id==='old')?.supersededBy).toBeUndefined();restorable(p);
  });
  it('supports reuse as a new correction while preserving other chains and active host assertions',()=>{
    const p=make();p.updateHost({notes:[note('a'),note('b','B',{supersedes:'a'}),note('x'),note('y','Y',{supersedes:'x'})]},0);p.pruneResolved(['a'],[],1);p.updateHost({notes:[note('a','A2',{supersedes:'b'})]},2);
    expect(p.getState().notes.find(n=>n.id==='b')).toMatchObject({supersededBy:'a'});expect(p.getState().notes.find(n=>n.id==='b')?.supersedes).toBeUndefined();expect(p.getState().notes.find(n=>n.id==='x')?.supersededBy).toBe('y');restorable(p);
  });
  it('does not retarget historic conflicts or proposal-adoption links to reused IDs',()=>{
    const p=make();p.propose([note('proposal')],0);p.updateHost({notes:[note('adopted','Adopted',{supersedes:'proposal'}),note('conflict','Other',{conflictsWith:['proposal','adopted']})]},1);p.pruneResolved(['proposal'],[],2);p.assume([note('proposal','New assumption')],3);
    expect(p.getState().notes.find(n=>n.id==='adopted')?.supersedes).toBeUndefined();expect(p.getState().notes.find(n=>n.id==='conflict')?.conflictsWith).toEqual(['adopted']);restorable(p);
  });
  it('rolls back detached links when a later candidate record is invalid',()=>{
    const p=make();p.updateHost({notes:[note('a'),note('b','B',{supersedes:'a'})]},0);p.pruneResolved(['a'],[],1);const before=p.getState();expect(()=>p.updateHost({notes:[note('a'),note('bad','x',{supersedes:'missing'})]},2)).toThrow();expect(p.getState()).toEqual(before);
  });
});

describe('Stage 04 correction: atomic bounded host recovery',()=>{
  it('recovers at the unchanged default 8000-token cap without oversized committed state',async()=>{
    const inputs=Array.from({length:14},(_,i)=>note(`n-${i}`,'x'.repeat(2000)));const seed=make({maxPromptTokens:20000});seed.updateHost({notes:inputs},0);let low=1,high=2000,found=false;
    while(low<=high){const mid=Math.floor((low+high)/2);const s=seed.getState();s.notes[13]!.text='x'.repeat(mid);seed.restoreState(s);const size=simpleTokenEstimator.estimateTokens(await seed.getContent());if(size===8000){inputs[13]!.text='x'.repeat(mid);found=true;break;}if(size<8000)low=mid+1;else high=mid-1;}
    expect(found).toBe(true);const p=make();p.updateHost({notes:inputs},0);expect(simpleTokenEstimator.estimateTokens(await p.getContent())).toBe(8000);
    expect(()=>p.updateHost({resolve:['n-0']},1)).toThrow('capacity');expect(()=>p.pruneResolved(['n-0'],[],1)).toThrow('active');p.updateHost({resolve:['n-0'],prune:{noteIds:['n-0']}},1);expect(p.revision).toBe(2);expect(p.getState().notes).toHaveLength(13);expect(simpleTokenEstimator.estimateTokens(await p.getContent())).toBeLessThan(8000);restorable(p);
  });
  it.each(['ASCII','Unicode'] as const)('recovers an exact snapshot-byte cap with %s data and reports capacity correctly',mode=>{
    const entry=note('active',mode==='ASCII'?'Important constraint':'重要な制約'.repeat(30));const seed=make();seed.updateHost({notes:[entry]},0);const maxSnapshotBytes=Buffer.byteLength(JSON.stringify(seed.getState()));const p=make({maxSnapshotBytes});p.updateHost({notes:[entry]},0);
    try{p.updateHost({resolve:['active']},1);expect.fail('Expected capacity rejection');}catch(e){expect(e).toMatchObject({code:'TASK_STATE_CAPACITY'});}const before=p.getState();expect(()=>p.pruneResolved(['active'],[],1)).toThrow();expect(p.getState()).toEqual(before);
    p.updateHost({resolve:['active'],prune:{noteIds:['active']}},1);expect(p.getState().notes).toEqual([]);expect(Buffer.byteLength(JSON.stringify(p.getState()))).toBeLessThanOrEqual(maxSnapshotBytes);
  });
  it('recovers at a revision-digit boundary and can reclaim and add in one atomic delta',()=>{
    const seed=make();seed.updateHost({notes:[note('old')]},0);const saved=seed.getState();saved.revision=9;const maxSnapshotBytes=Buffer.byteLength(JSON.stringify(saved));const p=make({maxSnapshotBytes});p.restoreState(saved);
    expect(()=>p.updateHost({resolve:['old']},9)).toThrow();p.updateHost({resolve:['old'],prune:{noteIds:['old']}},9);expect(p.revision).toBe(10);
    const q=make({maxEntries:1});q.updateHost({notes:[note('old')]},0);q.updateHost({notes:[note('new','Corrected',{supersedes:'old'})],prune:{noteIds:['old']}},1);expect(q.getState().notes.map(n=>n.id)).toEqual(['new']);restorable(q);
  });
  it('explicitly confirms and prunes an unknown action at its exact byte cap',()=>{
    const seed=make();seed.recordAction(outcome(),0);const p=make({maxSnapshotBytes:Buffer.byteLength(JSON.stringify(seed.getState()))});p.recordAction(outcome(),0);expect(()=>p.confirmAction('exec','completed',{label:'Host verified remote status'},1)).toThrow();
    p.updateHost({confirmActions:[{executionId:'exec',status:'completed',source:{label:'Verified'}}],prune:{executionIds:['exec']}},1);expect(p.getState().actions).toEqual([]);expect(p.revision).toBe(2);
  });
  it('never repeats a submitted action to repair notebook capacity',async()=>{
    const manager=new ToolManager();let writes=0;manager.register({definition:{type:'function',function:{name:'submit',parameters:{type:'object',properties:{}}}},execute:async()=>{writes++;return{accepted:true};}});
    try{const actual=await manager.executeWithOutcome('submit',{});const seed=make();seed.recordAction(actual.outcome,0);const p=make({maxSnapshotBytes:Buffer.byteLength(JSON.stringify(seed.getState()))});p.recordAction(actual.outcome,0);p.updateHost({confirmActions:[{executionId:actual.outcome.executionId,status:'completed',source:{label:'Host checked'}}],prune:{executionIds:[actual.outcome.executionId]}},1);expect(writes).toBe(1);expect(actual.result).toEqual({accepted:true});}finally{manager.destroy();}
  });
  it.each(['active-note','unknown-action','pending-confirmation','bad-proof','bad-target','stale-revision','oversized-proof'] as const)('rejects %s recovery atomically',failure=>{
    const p=make();p.updateHost({notes:[note('active')]},0);p.recordAction(outcome(),1);const before=p.getState();let delta:TaskStateHostDelta={resolve:['active'],prune:{noteIds:['active']}};
    if(failure==='active-note')delta={prune:{noteIds:['active']}};
    if(failure==='unknown-action')delta={resolve:['active'],prune:{noteIds:['active'],executionIds:['exec']}};
    if(failure==='pending-confirmation')delta={confirmActions:[{executionId:'exec',status:'waiting_external',source:{label:'Pending'}}],prune:{executionIds:['exec']}};
    if(failure==='bad-proof')delta={confirmActions:[{executionId:'exec',status:'completed',source:{label:''}}],prune:{executionIds:['exec']}};
    if(failure==='bad-target')delta={resolve:['active'],prune:{noteIds:['active','missing']}};
    if(failure==='oversized-proof')delta={confirmActions:[{executionId:'exec',status:'completed',source:{label:'x'.repeat(401)}}],prune:{executionIds:['exec']}};
    expect(()=>p.updateHost(delta,failure==='stale-revision'?1:2)).toThrow();expect(p.getState()).toEqual(before);
  });
  it('supports empty and duplicate prune lists without changing legacy prune semantics',()=>{
    const p=make();expect(p.updateHost({prune:{}},0).revision).toBe(0);p.updateHost({notes:[note('a')]},0);p.updateHost({resolve:['a']},1);p.pruneResolved(['a','a'],[],2);expect(p.revision).toBe(3);expect(p.updateHost({confirmActions:[],prune:{noteIds:[],executionIds:[]}},3).revision).toBe(3);
  });
});
