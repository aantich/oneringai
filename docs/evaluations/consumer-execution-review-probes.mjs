import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
// Investigation fixture, not an application integration example.
// Build first. Root exports exercise Agent/routine/portable contracts; source
// helpers deliberately inspect connector internals. No real network/model calls.
const require = createRequire(new URL('../../package.json', import.meta.url));
const lib = require('@everworker/oneringai');
const { microsoftFetch } = await import(new URL('../../src/tools/microsoft/types.ts', import.meta.url));
const { createMicrosoftListFilesTool } = await import(new URL('../../src/tools/microsoft/listFiles.ts', import.meta.url));
const { createGoogleListFilesTool } = await import(new URL('../../src/tools/google/listFiles.ts', import.meta.url));
const { createGetThreadTool } = await import(new URL('../../src/tools/slack/getThread.ts', import.meta.url));
const { createSetChannelTopicTool } = await import(new URL('../../src/tools/slack/setChannelTopic.ts', import.meta.url));
const { slackPaginate } = await import(new URL('../../src/tools/slack/types.ts', import.meta.url));
const observations=[]; const resources=[];
async function observe(id, scenario) { try { const data=await scenario();observations.push({id,matched:true,...data}); } catch(error) { observations.push({id,matched:false,error:String(error),stack:error.stack});process.exitCode=1; } }
let counter=0;
function agent(extra={}) {
 const name=`consumer-review-${counter++}`;
 const calls=[];
 const provider={name:'consumer-review-fixture',capabilities:{text:true,images:false,audio:false,videos:false},getModelCapabilities:()=>({supportsTools:true,supportsVision:false,supportsJSON:true,supportsJSONSchema:true,maxTokens:16000,maxInputTokens:16000,maxOutputTokens:128}),
 generate:async options=>{calls.push(options);return {id:'r',object:'response',created_at:1,model:options.model,status:'completed',output_text:'Done',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Done'}]}],usage:{input_tokens:10,output_tokens:2,total_tokens:12}};},validateConfig:async()=>true,listModels:async()=>[]};
 lib.Connector.create({name,vendor:lib.Vendor.OpenAI,auth:{type:'none'},options:{provider}});
 const a=lib.Agent.create({connector:name,model:'fixture',context:{model:'fixture',features:{workingMemory:false,inContextMemory:false}},modelExecution:{customProviderAttempts:'single'},...extra});resources.push(a);return {a,calls,provider};
}
const routine=(tasks=1)=>lib.createRoutineDefinition({name:'Consumer characterization',description:'Synthetic task with no external side effects',tasks:Array.from({length:tasks},(_,i)=>({name:`Task ${i+1}`,description:'Create a required artifact',expectedOutput:'Required artifact'}))});
function connector(body, capture=[]) {return {name:'synthetic-service',displayName:'Synthetic service',config:{auth:{type:'none'}},fetch:async (...args)=>{capture.push(args);return new Response(JSON.stringify(typeof body==='function'?body(args):body),{status:200,headers:{'content-type':'application/json'}});}};}
await observe('P01',async()=>{
 const {a}=agent({loopPolicy:{maxRecoveryAttempts:0,completion:()=>({complete:false,reason:'Required artifact does not exist'})}});
 const direct=await a.run('Create artifact');assert.equal(direct.loop.completion.complete,false);
 const execution=await lib.executeRoutine({agent:a,definition:routine()});assert.equal(execution.status,'completed');
 return {kind:'gap',managedVerdict:direct.loop.completion,routineStatus:execution.status,taskStatus:execution.plan.tasks[0].status};
});
await observe('P02',async()=>{
 const {a}=agent();const ids=[],forwarded=[];const original=a.run.bind(a);
 a.run=async(input,options)=>{forwarded.push(!!options?.modelTask);const r=await original(input,options);ids.push(a.getModelUsage().id);return r;};
 const result=await lib.executeRoutine({agent:a,definition:routine(2)});assert.equal(result.status,'completed');assert.equal(new Set(ids).size,2);assert.deepEqual(forwarded,[false,false]);
 return {kind:'gap',routineStatus:result.status,distinctModelTasks:2,sharedTaskForwarded:forwarded};
});
await observe('P03',async()=>{
 const negative={definition:{type:'function',function:{name:'business_decision',description:'Return a valid declined decision',parameters:{type:'object',properties:{}}}},execute:async()=>({success:false,decision:'declined',reason:'No approval'})};
 const {a}=agent({tools:[negative]});const local=await a.tools.executeWithOutcome('business_decision',{});assert.equal(local.outcome.status,'succeeded');
 const pkg=lib.exportAgentPackage(a,{packageId:'consumer-negative',toolPlacement:()=> 'remote'});const server=new lib.AgentPackageToolServer(a,pkg);
 try {const remote=await server.execute({protocolVersion:lib.AGENT_PACKAGE_PROTOCOL_VERSION,packageId:pkg.packageId,requestId:'negative-1',toolName:'business_decision',arguments:{}});assert.equal(remote.ok,false);assert.equal(remote.error.code,'tool_failed');return {kind:'gap',localStatus:local.outcome.status,raw:local.result,remote};}finally{await server.close();}
});
await observe('P04',async()=>{
 const {a}=agent({tools:[{definition:{type:'function',function:{name:'read_fact',description:'Read fact',parameters:{type:'object',properties:{}}}},output:{effect:'read'},execute:async()=>({id:'fact-1'})}]});let settled;a.tools.on('tool:outcome',x=>{settled=x;});
 const pkg=lib.exportAgentPackage(a,{packageId:'consumer-positive',toolPlacement:()=> 'remote'});const server=new lib.AgentPackageToolServer(a,pkg);
 try {const remote=await server.execute({protocolVersion:lib.AGENT_PACKAGE_PROTOCOL_VERSION,packageId:pkg.packageId,requestId:'positive-1',toolName:'read_fact',arguments:{}});assert.equal(remote.ok,true);assert.equal(settled.status,'succeeded');assert.equal(remote.outcome,undefined);const descriptor=pkg.agent.tools.find(x=>x.definition.function.name==='read_fact');assert.equal(descriptor.output,undefined);return {kind:'gap',serverOutcome:{executionId:settled.executionId,callId:settled.callId,status:settled.status},wireKeys:Object.keys(remote),descriptorKeys:Object.keys(descriptor)};}finally{await server.close();}
});
await observe('P05',async()=>{
 const calls=[];const ctl=new AbortController();ctl.abort(new Error('Host cancellation'));
 await microsoftFetch(connector({ok:true},calls),'/me/drive',{signal:ctl.signal});assert.equal(calls.length,1);assert.equal(calls[0][1].signal,undefined);
 return {kind:'gap',preAborted:true,requestsDispatched:calls.length,forwardedSignal:false};
});
await observe('P06',async()=>{
 let running=false,cancelCalls=0,lateCompleted=false;
 const worker={isDestroyed:false,isRunning:()=>running,run:async()=>{running=true;await new Promise(r=>setTimeout(r,25));running=false;lateCompleted=true;return {status:'completed',output_text:'Late result'};},cancel:()=>{cancelCalls++;},destroy:()=>{}};
 const tools=lib.buildOrchestrationTools({workspace:{getAllEntries:()=>[],getLog:()=>[]},agents:new Map([['worker',worker]]),agentTypes:new Map(),lastTurnTimestamps:new Map(),createWorkerAgent:()=>worker,delegationState:lib.createDelegationState()});
 const result=await tools.find(t=>t.definition.function.name==='assign_turn').execute({agent:'worker',instruction:'Synthetic work',timeout:.001});const stillRunning=running;assert.equal(result.success,false);assert.equal(stillRunning,true);assert.equal(cancelCalls,0);await new Promise(r=>setTimeout(r,35));assert.equal(lateCompleted,true);
 return {kind:'gap',result,workerRunningAfterTimeout:stillRunning,cancelCalls,lateCompleted};
});
await observe('P07',async()=>{
 const body={value:[{id:'ms-file',name:'one',size:0,folder:{}}],'@odata.nextLink':'https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=opaque'};
 const tool=createMicrosoftListFilesTool(connector(body));const r=await tool.execute({});assert.equal(r.hasMore,true);assert.equal(r.nextLink,undefined);assert.equal(r.cursor,undefined);
 return {kind:'gap',result:r,argumentNames:Object.keys(tool.definition.function.parameters.properties),effect:tool.output?.effect??'unknown'};
});
await observe('P08',async()=>{
 const tool=createGoogleListFilesTool(connector({files:[{id:'google-file',name:'one',mimeType:'text/plain'}],nextPageToken:'provider-next',incompleteSearch:true}));const r=await tool.execute({});assert.equal(r.hasMore,true);assert.equal(r.nextPageToken,undefined);assert.equal(r.incompleteSearch,undefined);
 return {kind:'gap',result:r,argumentNames:Object.keys(tool.definition.function.parameters.properties),providerIncompleteSearchLost:true,effect:tool.output?.effect??'unknown'};
});
await observe('P09',async()=>{
 const tool=createGetThreadTool(connector({ok:true,messages:[{ts:'1.0',text:'Parent'},{ts:'2.0',text:'Reply'}],has_more:true,response_metadata:{next_cursor:'thread-next'}}));const r=await tool.execute({channel:'C1',ts:'1.0'});assert.equal(r.cursor,undefined);assert.equal(r.hasMore,undefined);
 return {kind:'gap',result:r,argumentNames:Object.keys(tool.definition.function.parameters.properties)};
});
await observe('P10',async()=>{
 let pages=0;const c=connector(()=>({ok:true,items:[++pages],response_metadata:{next_cursor:`page-${pages}`}}));
 const r=await slackPaginate(c,'/synthetic',{},x=>x.items);assert.equal(pages,10);assert.equal(r.hasMore,true);assert.equal(r.cursor,undefined);
 return {kind:'gap',pagesFetched:pages,result:r};
});
await observe('P11',async()=>{
 const r=await slackPaginate(connector({ok:true,items:[1,2,3],response_metadata:{next_cursor:''}}),'/synthetic',{},x=>x.items,{limit:3});assert.equal(r.hasMore,true);
 return {kind:'gap',providerHasNoNextPage:true,result:r};
});
await observe('P12',async()=>{
 const calls=[];const tool=createSetChannelTopicTool(connector({ok:true,channel:{topic:{value:'T'.repeat(250)}}},calls));const text='T'.repeat(270);const r=await tool.execute({channel:'C1',topic:text});const sent=JSON.parse(calls[0][1].body).topic;assert.equal(sent.length,250);assert.equal(r.success,true);
 return {kind:'gap-with-provider-constraint',requestedChars:text.length,sentChars:sent.length,result:r,reportedTruncation:!!r.truncated};
});

await observe('P13',async()=>{
 const {a,provider}=agent();const generate=provider.generate;
 provider.generate=async options=>{const response=await generate(options);if(options.instructions==='You are a task completion evaluator. Return only JSON.') {const text=JSON.stringify({isComplete:false,completionScore:100,explanation:'Artifact is missing despite high answer-quality score'});return {...response,output_text:text,output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]};}return response;};
 const definition=lib.createRoutineDefinition({name:'Reflection characterization',description:'Synthetic',tasks:[{name:'Check',description:'Create required artifact',validation:{skipReflection:false,completionCriteria:['Artifact exists'],minCompletionScore:80}}]});
 const result=await lib.executeRoutine({agent:a,definition});assert.equal(result.status,'completed');return {kind:'additional-gap',validatorBoolean:false,validatorScore:100,routineStatus:result.status,explanation:result.plan.tasks[0].result.validationExplanation};
});
await observe('P14',async()=>{
 const c=connector({});c.fetch=async()=>new Response(JSON.stringify({error:{code:'AccessDenied',message:'Synthetic denied read'}}),{status:403});
 const base=createMicrosoftListFilesTool(c);const tool={...base,permission:{...base.permission,scope:'always'}};const {a}=agent({tools:[tool]});const report=await a.tools.executeWithOutcome('list_files',{});assert.equal(report.result.success,false);assert.equal(report.outcome.status,'succeeded');
 return {kind:'gap',toolReturned:report.result,outcomeStatus:report.outcome.status};
});
await observe('P15',async()=>{
 let pages=0;const c=connector(()=>++pages===1?{ok:true,items:[1,2,3,4],response_metadata:{next_cursor:'p2'}}:{ok:true,items:[5,6],response_metadata:{next_cursor:''}});
 const result=await slackPaginate(c,'/synthetic',{},x=>x.items,{limit:5});assert.deepEqual(result.items,[1,2,3,4,5]);assert.equal(result.cursor,undefined);
 return {kind:'additional-gap',pagesFetched:pages,providerItemsFetched:6,result,discardedItems:[6]};
});
await observe('P16',async()=>{
 const {a,calls}=agent({loopPolicy:{maxRecoveryAttempts:0,completion:()=>({complete:false,reason:'No artifact'})}});const inspection=a.inspectCapabilities();assert.equal(inspection.runtime,'managed-agent');assert.equal(inspection.loop.hostCompletionCheck,true);assert.equal(!!inspection.context.features.evidence,false);assert.equal(calls.length,0);
 return {kind:'existing-support-control',runtime:inspection.runtime,hostCompletionConfigured:inspection.loop.hostCompletionCheck,evidenceEnabled:!!inspection.context.features.evidence,inspectionMakesModelCalls:false,notice:inspection.notices[0]};
});


await observe('P17',async()=>{
 let extended=false;const descriptor={definition:{type:'function',function:{name:'wire_control',description:'Probe extension compatibility',parameters:{type:'object',properties:{}}}},placement:'remote'};
 const tool=lib.createRemoteTool('extension-control',descriptor,{execute:async request=>({protocolVersion:request.protocolVersion,packageId:request.packageId,requestId:request.requestId,ok:true,result:{id:'ok'},...(extended?{outcome:{status:'succeeded'}}:{})})});
 assert.deepEqual(await tool.execute({}),{id:'ok'});extended=true;await assert.rejects(tool.execute({}),/unsupported field 'outcome'/);
 return {kind:'compatibility-control',protocolVersion:lib.AGENT_PACKAGE_PROTOCOL_VERSION,legacyResponseAccepted:true,optionalOutcomeFieldRejected:true};
});

for(const resource of resources.reverse())resource.destroy();lib.Connector.clear();
const report={protocol:'consumer-composition-characterization-v1',recordedAt:new Date().toISOString(),scope:'Deterministic local fixtures; gaps are expected observations, not corrected behavior. No real LLM/provider/network requests.',observations};
await writeFile(process.env.CONSUMER_REVIEW_REPORT_PATH ?? '/tmp/oneringai-consumer-review-probes.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({matched:observations.filter(x=>x.matched).length,total:observations.length,errors:observations.filter(x=>!x.matched)}));
