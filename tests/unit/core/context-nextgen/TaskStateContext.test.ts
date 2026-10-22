import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentContextNextGen, TaskStatePluginNextGen, InMemoryEvidenceStorage, ObservationMaskingStrategy, StructuredSummaryStrategy, FileContextStorage, ContentType, MessageRole, BasePluginNextGen } from '../../../../src/index.js';
import type { ContextSummaryGenerator, Message } from '../../../../src/index.js';
const scope = { ownerId: 'owner', namespace: 'task-context' };
const contexts: AgentContextNextGen[] = [];
const msg = (text: string, role = MessageRole.USER): Message => ({ type: 'message', role, content: [{ type: role === MessageRole.ASSISTANT ? ContentType.OUTPUT_TEXT : ContentType.INPUT_TEXT, text }] });
function context(extra = {}, config = {}) {
  const ctx = AgentContextNextGen.create({ model: 'gpt-4o-mini', userId: scope.ownerId, maxContextTokens: 4000, responseReserve: 128,
    features: { workingMemory: false, inContextMemory: false, taskState: true }, plugins: { taskState: { scope, taskId: 'task', ...config } }, ...extra }); contexts.push(ctx);
  const task = ctx.getPlugin<TaskStatePluginNextGen>('task_state')!; return { ctx, task };
}
const notes = [{ id: 'hard-limit', category: 'constraint' as const, text: 'HARD_LIMIT_04: spend at most 40 EUR; never repeat job J42.', source: { label: 'Confirmed user correction' } }];
afterEach(() => { contexts.splice(0).forEach(c => c.destroy()); vi.useRealTimers(); vi.restoreAllMocks(); });
const summarize: ContextSummaryGenerator = async req => ({ summary: { completedWork: [{ text: 'Read old data.', sourceIds: [req.reference.id] }], activeWork: [], constraints: [], decisions: [], uncertainties: [], artifacts: [], actionReceipts: [] } });

describe('Stage 04 protected task-state context integration', () => {
  it('keeps defaults and disabled legacy context content/tools unchanged', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-21T10:00:00Z'));
    const a = AgentContextNextGen.create({ model: 'gpt-4o-mini' }); const b = AgentContextNextGen.create({ model: 'gpt-4o-mini', features: { taskState: false }, plugins: { taskState: { scope, taskId: 'ignored' } } }); contexts.push(a,b);
    const x = await a.prepare(), y = await b.prepare(); expect(x.input).toEqual(y.input); expect(x.tools).toEqual(y.tools); expect(b.getPlugin('task_state')).toBeNull(); expect(JSON.stringify(y)).not.toContain('Task state');
  });
  it('requires host configuration when explicitly enabled', () => expect(() => AgentContextNextGen.create({ model: 'gpt-4o-mini', features: { taskState: true } })).toThrow('taskId'));
  it('counts exact protected state in the real prompt, exposes it through the existing snapshot, and supplies no tools', async () => {
    const {ctx,task} = context(); task.updateHost({ notes }, 0); const prepared = await ctx.prepare();
    expect(JSON.stringify(prepared.input)).toContain('HARD_LIMIT_04'); expect(prepared.budget.breakdown.pluginContents.task_state).toBeGreaterThan(0); expect(prepared.tools).toEqual([]);
    const snapshot = await ctx.getSnapshot(); expect(snapshot.plugins.find(p => p.name === 'task_state')).toMatchObject({ compactable: false });
  });
  for (const mode of ['algorithmic', 'mask', 'summary'] as const) it(`${mode} removes old observations but preserves exact protected host notes/actions`, async () => {
    const storage = new InMemoryEvidenceStorage({scope}); const strategy = mode === 'mask' ? new ObservationMaskingStrategy({preserveRecentTurns:0,preserveRecentMessages:0,minObservationTokens:1,maxSourceTokens:50000}) : mode === 'summary' ? new StructuredSummaryStrategy({preserveRecentTurns:0,preserveRecentMessages:0,minObservationTokens:1,maxSourceTokens:50000}) : undefined;
    const {ctx,task}=context({ criticalCompactionThreshold:0.8, compactionStrategy:strategy, features:{workingMemory:mode==='algorithmic',inContextMemory:false,evidence:true,taskState:true}, plugins:{ evidence:{storage},taskState:{scope,taskId:'task'} } }); task.updateHost({notes},0);
    task.recordAction({executionId:'pending',toolName:'submit',status:'timed_out',startedAt:1,durationMs:2,executionStarted:true,completion:'unknown',cancellation:'requested'},1); const before=task.getState();
    const reference=await storage.put({version:1,recordedAt:1,source:{toolName:'lookup',executionId:'read',callId:'call',arguments:{},principal:{userId:scope.ownerId},effect:'read',status:'succeeded',completion:'settled',startedAt:1,durationMs:1},result:{data:'Old source contents. '.repeat(1800)}});
    ctx.addInputItems([msg('Historical work'),{type:'message',role:MessageRole.ASSISTANT,content:[{type:ContentType.TOOL_USE,id:'call',name:'lookup',arguments:'{}'}]},{type:'message',role:MessageRole.USER,content:[{type:ContentType.TOOL_RESULT,tool_use_id:'call',content:{data:'Old source contents. '.repeat(1800)},evidence:{version:1,executionId:'read',status:'stored',reference}}]},msg('Finished read',MessageRole.ASSISTANT)]);
    ctx.addUserMessage('Continue'); const prepared=await ctx.prepare({summarize}); expect(prepared.compacted).toBe(true); expect(task.getState()).toEqual(before); expect(JSON.stringify(prepared.input)).toContain('HARD_LIMIT_04'); expect(JSON.stringify(prepared.input)).toContain('pending'); expect(JSON.stringify(prepared.input)).not.toContain('Old source contents. Old source contents.');
  });
  it('preserves the task view across explicit rollover and rejects a task mutation during an asynchronous rollover', async () => {
    const {ctx,task}=context(); task.updateHost({notes},0);
    for(let i=0;i<4;i++){ctx.addUserMessage(`u${i}`);ctx.addAssistantResponse([msg(`a${i}`,MessageRole.ASSISTANT)]);}
    await ctx.rollover({preserveRecentTurns:1,summarize:async()=> 'Older work summarized'}); expect(JSON.stringify((await ctx.prepare()).input)).toContain('HARD_LIMIT_04');
    await expect(ctx.rollover({preserveRecentTurns:0,summarize:async()=>{task.updateHost({notes:[{...notes[0]!,id:'correction',text:'HARD_LIMIT_05',supersedes:'hard-limit'}]},1);return 'stale';}})).rejects.toThrow('changed'); expect(task.getState().notes).toHaveLength(2);
  });
  it('fails before dispatch when protected state alone cannot fit; never silently evicts it', async () => {
    const {ctx,task}=context({maxContextTokens:500,responseReserve:128}); task.updateHost({notes:[{...notes[0]!,text:'hard constraint '.repeat(120)}]},0); const before=task.getState(); await expect(ctx.prepare()).rejects.toThrow('overflow'); expect(task.getState()).toEqual(before);
  });
  it.each(['update','restore','strip','user-relocation'] as const)('rejects %s after preparation at final managed validation', async mutation => {
    const {ctx,task}=context(); task.updateHost({notes},0); const p=await ctx.prepare(); let input=p.input;
    if(mutation==='update')task.updateHost({notes:[{...notes[0]!,id:'extra'}]},1); if(mutation==='restore')task.restoreState(task.getState()); if(mutation==='strip') input=[msg('Removed state')]; if(mutation==='user-relocation') input=p.input.map(item=>item.type==='message'?{...item,role:MessageRole.USER}:item);
    expect(()=>ctx.validateRequestBudget({model:'gpt-4o-mini',input})).toThrow('Protected task state');
  });
  it('rebuilds once when task state changes during asynchronous plugin materialization', async () => {
    const {ctx,task}=context(); let calls=0; class Other extends BasePluginNextGen{readonly name='other';getInstructions(){return '';}async getContent(){if(++calls===1)task.updateHost({notes},0);return 'other';}getContents(){return null;}getState(){return null;}restoreState(){}}
    ctx.registerPlugin(new Other()); const prepared=await ctx.prepare(); expect(JSON.stringify(prepared.input)).toContain('HARD_LIMIT_04'); expect(()=>ctx.validateRequestBudget({model:'gpt-4o-mini',input:prepared.input})).not.toThrow(); expect(calls).toBeGreaterThanOrEqual(2);
  });
  it('does not treat a third-party plugin with the same name as the built-in contract', async () => {
    const ctx=AgentContextNextGen.create({model:'gpt-4o-mini',features:{workingMemory:false,inContextMemory:false}});contexts.push(ctx); class Legacy extends BasePluginNextGen{readonly name='task_state';getInstructions(){return 'legacy';}async getContent(){return 'custom legacy data';}getContents(){return {legacy:true};}getState(){return {legacy:true};}restoreState(){}}
    ctx.registerPlugin(new Legacy()); const p=await ctx.prepare(); expect(()=>ctx.validateRequestBudget({model:'gpt-4o-mini',input:p.input})).not.toThrow();ctx.restoreState(ctx.getState());
  });
  it.each(['foreign-owner','foreign-task','future-version','null-state'] as const)('preflights %s before replacing conversation', failure => {
    const {ctx,task}=context(); task.updateHost({notes},0);ctx.addInputItems([msg('Current conversation')]); const original=ctx.getState();const bad=structuredClone(original);bad.conversation=[msg('REPLACED')];
    const saved=bad.pluginStates.task_state as ReturnType<typeof task.getState>; if(failure==='foreign-owner')saved.scope.ownerId='other';if(failure==='foreign-task')saved.taskId='other';if(failure==='future-version')(saved as {version:number}).version=2;if(failure==='null-state')bad.pluginStates.task_state=null;
    expect(()=>ctx.restoreState(bad)).toThrow();expect(ctx.getConversation()).toEqual(original.conversation);expect(task.getState()).toEqual(original.pluginStates.task_state);
  });
  it('clears task notes when loading legacy state without task records', () => {const {ctx,task}=context();task.updateHost({notes},0); const legacy=ctx.getState();delete legacy.pluginStates.task_state;ctx.restoreState(legacy);expect(task.getState().notes).toEqual([]);});
  it('roundtrips pending actions and corrections through real FileContextStorage and rejects switching task scope', async () => {
    const dir=await mkdtemp(join(tmpdir(),'stage04-session-')); const storage=new FileContextStorage({agentId:'test',baseDirectory:dir});
    try{const {ctx,task}=context({storage,agentId:'test'}); task.updateHost({notes},0);task.recordAction({executionId:'pending',toolName:'submit',status:'succeeded',startedAt:1,durationMs:1,executionStarted:true,completion:'settled',cancellation:'none'},1);task.confirmAction('pending','waiting_external',{label:'Accepted; awaiting remote verification'},2);ctx.addInputItems([msg('Saved conversation')]);await ctx.save('saved');const fresh=context({storage,agentId:'test'});expect(await fresh.ctx.load('saved')).toBe(true);expect(fresh.task.getState()).toEqual(task.getState());const other=context({storage,agentId:'test'},{taskId:'other'});await expect(other.ctx.load('saved')).rejects.toThrow('scope');expect(other.ctx.getConversation()).toEqual([]);}finally{await rm(dir,{recursive:true,force:true});}
  });
});
