/** Actual AMOS runner and host commands, synthetic provider, no network/keys. Build library first. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Connector, Vendor, ContentType, MessageRole } from '@everworker/oneringai';
import type { ITextProvider } from '@everworker/oneringai';
import { AgentRunner } from '../src/agent/AgentRunner.js';
import { ContextCommand } from '../src/commands/commands/ContextCommand.js';
import { DEFAULT_CONFIG } from '../src/config/types.js';
import type { IAmosApp } from '../src/config/types.js';
const directory=await mkdtemp(join(tmpdir(),'amos-task-demo-'));const config=structuredClone(DEFAULT_CONFIG);config.session.autoSave=false;config.taskState={enabled:true,taskId:'delivery-42',ownerId:'local',namespace:'demo'};let calls=0;
const provider:ITextProvider={name:'amos-task-offline',capabilities:{text:true,images:false,videos:false,audio:false},validateConfig:async()=>true,listModels:async()=>[],getModelCapabilities:()=>({supportsTools:true,supportsVision:false,supportsJSON:true,supportsJSONSchema:true,maxTokens:128000,maxOutputTokens:1024}),generate:async options=>{calls++;assert.ok(JSON.stringify(options.input).includes('40 EUR'));const text='Awaiting host verification. /context task resolve 2 cap-corrected';return{id:'r',object:'response',model:options.model,created_at:1,status:'completed',output_text:text,output:[{type:'message',role:MessageRole.ASSISTANT,content:[{type:ContentType.OUTPUT_TEXT,text}]}],usage:{input_tokens:10,output_tokens:5,total_tokens:15}};},async*streamGenerate(){throw Error('This demonstration uses run().');}};
Connector.create({name:'amos-task-demo',vendor:Vendor.OpenAI,auth:{type:'none'},options:{provider}});const runner=new AgentRunner(config,[],directory);const command=new ContextCommand();const app={getAgent:()=>runner} as unknown as IAmosApp;
async function invoke(args:string[]){const result=await command.execute({app,args,rawInput:'/context '+args.join(' ')});console.log(`/context ${args.join(' ')}\n${result.message}`);return result;}
try{await runner.initialize('amos-task-demo','gpt-4o-mini');assert.equal((await invoke(['task','add','0','constraint','cap','Spend at most 50 EUR'])).success,true);assert.equal((await invoke(['task','correct','1','cap','cap-corrected','Spend at most 40 EUR'])).success,true);assert.equal((await invoke(['task','resolve','1','cap-corrected'])).success,false);assert.equal(calls,0);await runner.saveSession('Task-state demo');await runner.run('Continue with the host constraint.');assert.equal(runner.getTaskState()?.revision,2);await runner.loadSession(config.session.activeSessionId!);assert.equal(runner.getTaskState()?.notes[1]?.text,'Spend at most 40 EUR');await invoke(['task']);assert.equal(calls,1);
  runner.updateTaskState({notes:Array.from({length:98},(_,i)=>({id:`bulk-${i}`,category:'question' as const,text:'Synthetic open question',source:{label:'Host bulk import'}}))},runner.getTaskState()!.revision);
  assert.equal(runner.getTaskState()!.notes.length,100);
  const full=await invoke(['task','add',String(runner.getTaskState()!.revision),'constraint','new-cap','Keep 40 EUR']);assert.equal(full.success,false);assert.ok(full.message?.includes('resolve-prune'));
  assert.equal((await invoke(['task','resolve-prune',String(runner.getTaskState()!.revision),'bulk-0'])).success,true);
  assert.equal((await invoke(['task','add',String(runner.getTaskState()!.revision),'constraint','new-cap','Keep 40 EUR'])).success,true);
  await runner.saveSession('Recovered task');const recovered=runner.getTaskState();await runner.loadSession(config.session.activeSessionId!);assert.deepEqual(runner.getTaskState(),recovered);assert.equal(calls,1);
  console.log('At the 100-record cap, explicit atomic host recovery reclaimed a slot, accepted a new constraint and survived checkpoint reload.');
console.log('Host edits, stale-revision rejection and checkpoint reload passed; model command text stayed data. One synthetic call, no LLM/network. Temporary files cleaned.');}finally{runner.destroy();Connector.remove('amos-task-demo');await rm(directory,{recursive:true,force:true});}
