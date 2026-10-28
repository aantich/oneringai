import assert from 'node:assert/strict';import{createRequire}from'node:module';import{build}from'esbuild';
const require=createRequire(import.meta.url);let checks=0;
for(const api of [await import('@everworker/oneringai'),require('@everworker/oneringai'),await import('@everworker/oneringai/shared'),require('@everworker/oneringai/shared')]){
 const before=JSON.stringify(api.MODEL_REGISTRY), r=api.getRealtimeModelCapabilities({vendor:api.Vendor.OpenAI,model:'gpt-realtime-2',transport:'webrtc'});
 assert.equal(r.reasoning.allowedEfforts.length,5);checks++;assert.equal(Object.isFrozen(r.reasoning.allowedEfforts),true);checks++;
 assert.equal(api.getRealtimeModelCapabilities({vendor:api.Vendor.OpenAI,model:'gpt-realtime-2.1',transport:'websocket'}).reasoning.allowedEfforts,null);checks++;
 assert.equal(api.getTranscriptionCapabilities({vendor:api.Vendor.OpenAI,model:'gpt-transcribe',mode:'conversation-input',conversationModel:'gpt-realtime-2',transport:'websocket'}).support,'unknown');checks++;
 assert.equal(JSON.stringify(api.MODEL_REGISTRY),before);checks++;
 assert.equal(api.assessModelParameters({vendor:api.Vendor.OpenAI,model:'gpt-6-sol',endpoint:'responses',reasoningEffort:'none'}).temperature.support,'supported');checks++;
 assert.equal(api.assessModelParameters({vendor:api.Vendor.OpenAI,model:'gpt-6-sol',endpoint:'responses'}).temperature.support,'unsupported');checks++;
 assert.equal(api.assessModelParameters({vendor:api.Vendor.Custom,model:'gpt-6-sol',endpoint:'custom'}).temperature.support,'unknown');checks++;
 assert.equal(api.openAISamplingConstraint,undefined);checks++;
 assert.equal(api.getVendorPresentation(api.Vendor.Google).displayName,'Google');checks++;
 assert.equal(api.getVendorPresentation('unknown'),undefined);checks++;
 assert.equal(Object.keys(api.VENDOR_PRESENTATIONS).length,api.VENDORS.length);checks++;
 assert.equal(Object.isFrozen(api.VENDOR_PRESENTATIONS.openai),true);checks++;
}
await build({entryPoints:['dist/shared/index.js'],bundle:true,write:false,platform:'browser',format:'esm'});checks++;
console.log(JSON.stringify({passed:true,checks,entries:4,browser:true}));
