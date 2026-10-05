import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {appendKnowledgeEvent,buildKnowledgeContext,putKnowledgeRecord,queryKnowledge,recentKnowledgeEvents} from '../scripts/knowledge.mjs';

test('knowledge plane stores records, appends events and retrieves relevant context',async()=>{
  const root=await mkdtemp(join(tmpdir(),'edh-knowledge-'));
  try{
    await putKnowledgeRecord({
      id:'ct03.test',kind:'decision',title:'Desktop stdio MCP',
      summary:'Use stdio for local plugin',tags:['ct-03','stdio'],
      entities:['ChatGPT Desktop'],evidence:[]
    },{root});
    await putKnowledgeRecord({
      id:'other.test',kind:'lesson',title:'Unrelated item',
      summary:'Something else',tags:['other'],entities:[],evidence:[]
    },{root});
    await appendKnowledgeEvent({type:'TEST',subject:'ct03',message:'stdio path passed'},{root});
    const hits=await queryKnowledge('ChatGPT Desktop stdio',{root});
    assert.equal(hits[0].record.id,'ct03.test');
    const events=await recentKnowledgeEvents({root});
    assert.equal(events.at(-1).message,'stdio path passed');
    const ctx=await buildKnowledgeContext('ct-03 stdio',{root,limit:1,eventLimit:1});
    assert.equal(ctx.records[0].id,'ct03.test');
    assert.equal(ctx.recent_events.length,1);
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});


test('knowledge retrieval respects repository and task provenance',async()=>{
  const root=await mkdtemp(join(tmpdir(),'edh-knowledge-context-'));
  try{
    const base={kind:'lesson',title:'Shared title',summary:'same searchable stdio fact',tags:['stdio'],entities:[],evidence:[]};
    await putKnowledgeRecord({...base,id:'ct03.scoped',context:{scope:'task',repo:{name:'execution-delivery-harness',worktree:null,branch:null,head:null},task_ids:['CT-03'],plan_id:null,run_id:null,source_artifacts:[]}},{root});
    await putKnowledgeRecord({...base,id:'other.scoped',context:{scope:'task',repo:{name:'execution-delivery-harness',worktree:null,branch:null,head:null},task_ids:['OTHER-01'],plan_id:null,run_id:null,source_artifacts:[]}},{root});
    await putKnowledgeRecord({...base,id:'global.scoped',context:{scope:'global',repo:{name:'other-repo',worktree:null,branch:null,head:null},task_ids:[],plan_id:null,run_id:null,source_artifacts:[]}},{root});
    const hits=await queryKnowledge('stdio',{root,repoName:'execution-delivery-harness',taskIds:['CT-03']});
    assert.deepEqual(hits.map(x=>x.record.id).sort(),['ct03.scoped','global.scoped']);
  }finally{
    await rm(root,{recursive:true,force:true});
  }
});
