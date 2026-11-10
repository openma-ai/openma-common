import assert from 'node:assert/strict';
import {createManagedAcpSupervisorHarness,createManagedHarnessHttpControlChannel} from '@openma/common/managed-runtime';
const status=Number(process.argv[2]);
const scope={workspaceId:'w',environmentId:'e',sessionId:'s',workId:'work'};
let page=0,posts=0,sends=0;
const harness=createManagedAcpSupervisorHarness({
 connect:async()=>createManagedHarnessHttpControlChannel({scope,harness:{id:'a',version:'1'},workspacePath:'/workspace',apiBaseUrl:'https://fixture.invalid',sessionsToken:'fixture',pollIntervalMs:5,
 fetch:async (_url,init)=>{
   if(init?.method==='POST'){
     posts++;return new Response('{}',{status});
   }
   return new Response(JSON.stringify({id:'s',environment_id:'e'}));
 },
 eventReader:{async read({signal}){
   if(++page===1)return {events:[{id:'first',type:'user.message',processed_at:null,content:[{type:'text',text:'first'}]},{id:'second',type:'user.define_outcome',processed_at:null,description:'second'}],cursor:'one',hasMore:false};
   await new Promise(r=>{if(signal.aborted)r();else signal.addEventListener('abort',r,{once:true});});
   return {events:[],cursor:'one',hasMore:false};
 }},onConsumed:async()=>{}}),
 acpRuntime:{start:async()=>({acpSessionId:'a',isAlive:()=>true,async dispose(){},async *prompt(_text,o){sends++;await o?.onDispatched?.();yield {sessionUpdate:'agent_message_chunk',content:{type:'text',text:'hello'}};await new Promise(r=>setTimeout(r,100));}})},
 sessionPreparation:{prepare:async()=>({agent:{command:'fake'}})},
 sessionState:{beforeStart:async command=>({command}),onReady:async()=>{},checkpoint:async()=>{},release:async()=>{}},drainDeadlineMs:0,abortGraceMs:0,
});
const run=await harness.start({scope,harness:{id:'a',version:'1'},workspacePath:'/workspace',outputPath:null,checkpoint:async()=>{},signal:new AbortController().signal});
try { await assert.rejects(run.completed,error=>{assert.equal(error.status,status);console.log('HANDLED',status);return true;}); }
finally { await run.stop(); }
await new Promise(r=>setTimeout(r,150));
assert.equal(posts,1);assert.equal(sends,1);
console.log('POSTS',posts);console.log('SENDS',sends);
