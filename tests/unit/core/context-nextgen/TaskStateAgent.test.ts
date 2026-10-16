import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent, Connector, Vendor, TaskStatePluginNextGen, ContentType, MessageRole, StreamEventType } from '../../../../src/index.js';
import type { LLMResponse, TextGenerateOptions, StreamEvent, AgentConfig } from '../../../../src/index.js';
const scope = { ownerId: 'host', namespace: 'managed-task' };
const agents: Agent[]=[];
afterEach(()=>{agents.splice(0).forEach(a=>a.destroy());Connector.remove('task-fixture');vi.restoreAllMocks();});
function fixture(extra: Partial<AgentConfig>={}){
  const packets:TextGenerateOptions[]=[];
  const response=(text='OK'):LLMResponse=>({id:'r',object:'response',model:'gpt-4o-mini',created_at:1,status:'completed',output_text:text,output:[{type:'message',role:MessageRole.ASSISTANT,content:[{type:ContentType.OUTPUT_TEXT,text}]}],usage:{input_tokens:10,output_tokens:3,total_tokens:13}});
  const provider={name:'fixture',capabilities:{text:true,images:false,audio:false,videos:false},validateConfig:async()=>true,listModels:async()=>[],getModelCapabilities:()=>({supportsTools:true,supportsVision:false,supportsJSON:true,supportsJSONSchema:false,maxTokens:128000,maxOutputTokens:1024}),
    generate:vi.fn(async(options:TextGenerateOptions)=>{packets.push(structuredClone(options));return response();}),
    streamGenerate:vi.fn(async function*(options:TextGenerateOptions):AsyncGenerator<StreamEvent>{packets.push(structuredClone(options));yield{type:StreamEventType.OUTPUT_TEXT_DELTA,response_id:'r',item_id:'i',output_index:0,content_index:0,sequence_number:0,delta:'OK'};yield{type:StreamEventType.RESPONSE_COMPLETE,response_id:'r',status:'completed',usage:{input_tokens:10,output_tokens:3,total_tokens:13},iterations:1};})};
  Connector.create({name:'task-fixture',vendor:Vendor.OpenAI,auth:{type:'none'},options:{provider}});
  const agent=Agent.create({connector:'task-fixture',model:'gpt-4o-mini',userId:'host',thinking:{enabled:false},emptyResponseRetry:{enabled:false},context:{model:'gpt-4o-mini',features:{workingMemory:false,inContextMemory:false,taskState:true},plugins:{taskState:{scope,taskId:'task'}}},...extra});agents.push(agent);
  const task=agent.context.getPlugin<TaskStatePluginNextGen>('task_state')!;task.updateHost({notes:[{id:'constraint',category:'constraint',text:'HOST_CONSTRAINT_04',source:{label:'Confirmed user'}}]},0);return{agent,task,packets,provider,response};
}
describe('Stage 04 actual managed Agent dispatch',()=>{
  for(const mode of ['run','stream'] as const){
    it(`${mode} includes task state in every dispatch without changing the shared tool manager`,async()=>{const{agent,packets,task}=fixture();if(mode==='run')await agent.run('continue');else for await(const _ of agent.stream('continue')){/*drain*/}expect(packets).toHaveLength(1);expect(JSON.stringify(packets[0]!.input)).toContain('HOST_CONSTRAINT_04');expect(agent.tools).toBe(agent.context.tools);expect(task.revision).toBe(1);});
    for(const change of ['strip','modify','state-update','request-listener'] as const)it(`${mode} rejects ${change} before provider dispatch`,async()=>{
      const{agent,provider,task}=fixture({hooks:{'before:llm':async context=>{if(change==='strip')context.options.input='stripped';if(change==='modify')context.options.input=JSON.parse(JSON.stringify(context.options.input).replace('HOST_CONSTRAINT_04','FORGED'));if(change==='state-update')task.updateHost({notes:[{id:'new',category:'constraint',text:'NEW',source:{label:'Host correction'}}]},task.revision);return{};}}});
      if(change==='request-listener')agent.on('llm:request',e=>{if(e.options)e.options.input='stripped';else task.updateHost({notes:[{id:'late-listener',category:'constraint',text:'Changed by host listener',source:{label:'Host'}}]},task.revision);});
      const run=async()=>{if(mode==='run')await agent.run('continue');else for await(const _ of agent.stream('continue')){/*drain*/}};await expect(run()).rejects.toThrow('Protected task state');expect(provider.generate).not.toHaveBeenCalled();expect(provider.streamGenerate).not.toHaveBeenCalled();expect(task.getState().notes[0]?.text).toBe('HOST_CONSTRAINT_04');
    });
  }
  it('managed structured-output repair retains task state and does not change task authority',async()=>{const{agent,provider,response,packets,task}=fixture();provider.generate.mockImplementation(async options=>{packets.push(structuredClone(options));return response(packets.length===1?'invalid':'{"value":"ok"}');});const result=await agent.run('Return JSON',{responseFormat:{type:'json_schema',name:'reply',strict:true,schema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}});expect(result.output_parsed).toEqual({value:'ok'});expect(packets).toHaveLength(2);expect(packets.every(p=>JSON.stringify([p.input,p.instructions]).includes('HOST_CONSTRAINT_04'))).toBe(true);expect(task.revision).toBe(1);});
  it('direct calls remain stateless and do not silently acquire task context',async()=>{const{agent,packets}=fixture();await agent.runDirect('direct');expect(JSON.stringify(packets[0]!.input)).not.toContain('HOST_CONSTRAINT_04');});
});

describe('Stage 04 correction: final recount observer admission',()=>{
  for(const mode of ['run','stream'] as const)for(const mutation of ['correct','restore','owner','destroy'] as const)it(`${mode} rejects ${mutation} during the last budget event before any provider call`,async()=>{
    let phase='prepare';let changed=false;const{agent,task,provider}=fixture({hooks:{'before:llm':async c=>{phase='dispatch';c.options.instructions=(c.options.instructions??'')+' Harmless host addition forces a final recount.';return{};}}});
    agent.context.on('budget:updated',()=>{if(phase!=='dispatch'||changed)return;changed=true;if(mutation==='correct')task.updateHost({notes:[{id:'correction',category:'constraint',text:'NEW_CAP40',supersedes:'constraint',source:{label:'Host correction'}}]},task.revision);if(mutation==='restore')task.restoreState(task.getState());if(mutation==='owner')agent.context.userId=undefined;if(mutation==='destroy')agent.context.destroy();});
    const run=async()=>{if(mode==='run')await agent.run('Continue');else for await(const _ of agent.stream('Continue')){/*drain*/}};await expect(run()).rejects.toThrow();expect(changed).toBe(true);expect(provider.generate).not.toHaveBeenCalled();expect(provider.streamGenerate).not.toHaveBeenCalled();if(mutation==='correct')expect(task.getState().notes.at(-1)?.text).toBe('NEW_CAP40');
  });
  for(const mode of ['run','stream'] as const)it(`${mode} allows a read-only observer and schema/native recount without an extra preparation`,async()=>{
    const{agent,packets,task}=fixture({hooks:{'before:llm':async c=>{c.options.instructions=(c.options.instructions??'')+' Harmless addition.';c.options.response_format={type:'json_object'};c.options.native_tools=[{capability:'web_search'}];return{};}}});let events=0;agent.context.on('budget:updated',()=>{events++;expect(task.revision).toBe(1);});if(mode==='run')await agent.run('Continue');else for await(const _ of agent.stream('Continue')){/*drain*/}expect(events).toBeGreaterThanOrEqual(2);expect(packets).toHaveLength(1);expect(agent.context.lastPreparation?.revision).toBe(1);expect(JSON.stringify(packets[0]!.input)).toContain('HOST_CONSTRAINT_04');
  });
});
