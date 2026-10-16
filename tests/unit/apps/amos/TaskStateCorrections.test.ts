import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent, AgentContextNextGen, TaskStatePluginNextGen, Connector, Vendor, simpleTokenEstimator } from '@everworker/oneringai';
import type { ITextProvider, TaskStateNoteInput, ToolExecutionOutcome } from '@everworker/oneringai';
import { AgentRunner } from '../../../../apps/amos/src/agent/AgentRunner.js';
import { ContextCommand } from '../../../../apps/amos/src/commands/commands/ContextCommand.js';
import { DEFAULT_CONFIG } from '../../../../apps/amos/src/config/types.js';
import type { CommandContext } from '../../../../apps/amos/src/config/types.js';
const scope={ownerId:'host',namespace:'amos-corrections'};
const note=(id:string):TaskStateNoteInput=>({id,category:'constraint',text:'Confirmed constraint',source:{label:'Host'}});
afterEach(()=>{vi.restoreAllMocks();Connector.remove('amos-task-corrections');});
function harness(limits={}){
  const context=AgentContextNextGen.create({model:'gpt-4o-mini',userId:scope.ownerId,features:{workingMemory:false,inContextMemory:false,taskState:true},plugins:{taskState:{scope,taskId:'task',...limits}}});let busy=false;
  vi.spyOn(Agent,'create').mockReturnValue({context,isRunning:()=>busy,destroy:()=>context.destroy()} as unknown as Agent);const runner=new AgentRunner(structuredClone(DEFAULT_CONFIG),[]);
  const command=new ContextCommand();const app={getAgent:()=>runner} as unknown as CommandContext['app'];const invoke=(args:string[])=>command.execute({app,args,rawInput:'/context '+args.join(' ')});
  return{context,runner,task:context.getPlugin<TaskStatePluginNextGen>('task_state')!,invoke,setBusy:(value:boolean)=>{busy=value;}};
}
describe('AMOS correction: explicit bounded host recovery',()=>{
  it('reclaims resolved records at 100 entries, adds and corrects, then checkpoints/reloads through the real runner',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'amos-recovery-'));let calls=0;const provider:ITextProvider={name:'fixture',capabilities:{text:true,images:false,audio:false,videos:false},validateConfig:async()=>true,listModels:async()=>[],getModelCapabilities:()=>({supportsTools:true,supportsVision:false,supportsJSON:true,supportsJSONSchema:true,maxTokens:128000,maxOutputTokens:1024}),generate:async()=>{calls++;throw Error('No model call expected');},async*streamGenerate(){calls++;throw Error('No model call expected');}};
    Connector.create({name:'amos-task-corrections',vendor:Vendor.OpenAI,auth:{type:'none'},options:{provider}});const config=structuredClone(DEFAULT_CONFIG);config.session.autoSave=false;config.taskState={enabled:true,taskId:'task',ownerId:scope.ownerId,namespace:scope.namespace};const runner=new AgentRunner(config,[],directory);const command=new ContextCommand();const app={getAgent:()=>runner} as unknown as CommandContext['app'];const invoke=(args:string[])=>command.execute({app,args,rawInput:'/context '+args.join(' ')});
    try{await runner.initialize('amos-task-corrections','gpt-4o-mini');runner.updateTaskState({notes:Array.from({length:100},(_,i)=>note(`n-${i}`))},0);expect((await invoke(['task','add','1','constraint','new','New'])).message).toContain('resolve-prune');expect((await invoke(['task','resolve','1','n-0'])).success).toBe(true);expect((await invoke(['task','prune','2','n-0'])).success).toBe(true);expect((await invoke(['task','add','3','constraint','new','New'])).success).toBe(true);expect((await invoke(['task','resolve-prune','4','n-1'])).success).toBe(true);expect((await invoke(['task','correct','5','new','correction','Corrected'])).success).toBe(true);expect(runner.getTaskState()?.notes).toHaveLength(100);const before=runner.getTaskState();const id=await runner.saveSession();await runner.loadSession(id);expect(runner.getTaskState()).toEqual(before);expect(calls).toBe(0);}finally{runner.destroy();await rm(directory,{recursive:true,force:true});}
  });
  it.each(['tokens','bytes'] as const)('%s boundary supports atomic host resolve-prune through the adapter',async limit=>{
    const seed=new TaskStatePluginNextGen({scope,taskId:'task'});seed.updateHost({notes:[note('active')]},0);const limits=limit==='tokens'?{maxPromptTokens:simpleTokenEstimator.estimateTokens(await seed.getContent())}:{maxSnapshotBytes:Buffer.byteLength(JSON.stringify(seed.getState()))};seed.destroy();const h=harness(limits);
    try{await h.runner.initialize('main','gpt-4o-mini');h.runner.updateTaskState({notes:[note('active')]},0);expect((await h.invoke(['task','resolve','1','active'])).success).toBe(false);expect((await h.invoke(['task','resolve-prune','1','active'])).success).toBe(true);expect(h.runner.getTaskState()?.notes).toEqual([]);}finally{h.runner.destroy();}
  });
  it('requires terminal host proof before pruning an unknown action',async()=>{
    const h=harness();try{await h.runner.initialize('main','gpt-4o-mini');const observed:ToolExecutionOutcome={executionId:'exec',toolName:'write',status:'cancelled',startedAt:1,durationMs:1,executionStarted:true,completion:'unknown',cancellation:'requested'};h.task.recordAction(observed,0);
      expect((await h.invoke(['task','prune-action','1','exec'])).success).toBe(false);expect((await h.invoke(['task','confirm-prune','1','exec','waiting_external','Still pending'])).success).toBe(false);expect(h.task.revision).toBe(1);expect((await h.invoke(['task','confirm-prune','1','exec','completed','Host verified delivered status'])).success).toBe(true);expect(h.task.getState().actions).toEqual([]);
    }finally{h.runner.destroy();}
  });
  it('prunes an already host-confirmed terminal action without adding a confirmation',async()=>{const h=harness();try{await h.runner.initialize('main','gpt-4o-mini');h.task.recordAction({executionId:'exec',toolName:'write',status:'succeeded',startedAt:1,durationMs:1,executionStarted:true,completion:'settled',cancellation:'none'},0);h.task.confirmAction('exec','completed',{label:'Host checked'},1);expect((await h.invoke(['task','prune-action','2','exec'])).success).toBe(true);expect(h.task.getState().actions).toEqual([]);}finally{h.runner.destroy();}});
  it.each(['busy','stale','active','missing','malformed'] as const)('rejects %s host pruning without mutation',async failure=>{const h=harness();try{await h.runner.initialize('main','gpt-4o-mini');h.runner.updateTaskState({notes:[note('active')]},0);const before=h.task.getState();if(failure==='busy')h.setBusy(true);const args=failure==='stale'?['task','resolve-prune','0','active']:failure==='active'?['task','prune','1','active']:failure==='missing'?['task','resolve-prune','1','missing']:failure==='malformed'?['task','prune','1']:['task','resolve-prune','1','active'];const result=await h.invoke(args);expect(result.success).toBe(false);expect(h.task.getState()).toEqual(before);}finally{h.runner.destroy();}});
});
