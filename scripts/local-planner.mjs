#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validatePlanningDocument } from './planning-contract.mjs';

const SYSTEM_PROMPT = `You are the local planner inside Execution Delivery Harness.
Choose exactly one next bounded worker task from the supplied goal, evidence and constraints.
Do not widen permissions or invent files/tools. Scope, identity, budget, provenance and execution profile are enforced by the Harness and are not yours to change.
Return JSON only with exactly these keys:
goal: string
acceptance: array of {id, description, evidence_required}
risk_class: one of low, medium, high, requires_user_decision
escalation_conditions: non-empty array of strings
Make the task small enough for one bounded worker run. Acceptance must state concrete observable evidence, never shell commands or executable instructions. Harness-owned verification decides how evidence is produced and checked.
Escalate through conditions instead of assuming missing facts.`;

function assertRequest(request) {
  const required=['plan_id','task_id','goal','evidence','scope','constraints','budget','artifacts','source','execution_profile'];
  for(const key of required) if(!(key in request)) throw new Error('request.'+key+': required');
  if(!Array.isArray(request.evidence)) throw new Error('request.evidence: array required');
  if(!request.scope || !Array.isArray(request.scope.reads) || !Array.isArray(request.scope.writes) || !Array.isArray(request.scope.tools)) {
    throw new Error('request.scope: reads/writes/tools arrays required');
  }
}

export function assembleTaskEnvelope(request,proposal) {
  assertRequest(request);
  const allowed=new Set(['goal','acceptance','risk_class','escalation_conditions']);
  for(const key of Object.keys(proposal)) if(!allowed.has(key)) throw new Error('proposal.'+key+': planner may not set this field');
  return {
    schema_version:'1.0',
    task_id:request.task_id,
    plan_id:request.plan_id,
    parent_task_id:request.parent_task_id??null,
    goal:proposal.goal,
    evidence:request.evidence,
    scope:request.scope,
    constraints:request.constraints,
    non_goals:request.non_goals||[],
    acceptance:proposal.acceptance,
    risk_class:proposal.risk_class,
    budget:request.budget,
    escalation_conditions:proposal.escalation_conditions,
    artifacts:request.artifacts,
    source:request.source,
    execution_profile:request.execution_profile
  };
}

function parseJsonContent(content) {
  let text=String(content||'').trim();
  if(text.startsWith('```')) text=text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  return JSON.parse(text);
}

export async function planOneTask(request,{endpoint='http://127.0.0.1:8080/v1',model='qwen3.8-27b',timeoutMs=120000}={}) {
  assertRequest(request);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try {
    const response=await fetch(endpoint.replace(/\/$/,'')+'/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      signal:controller.signal,
      body:JSON.stringify({
        model,
        temperature:0,
        max_tokens:1200,
        messages:[
          {role:'system',content:SYSTEM_PROMPT},
          {role:'user',content:JSON.stringify({
            goal:request.goal,
            evidence:request.evidence,
            scope:request.scope,
            constraints:request.constraints,
            non_goals:request.non_goals||[]
          })}
        ]
      })
    });
    if(!response.ok) throw new Error('planner HTTP '+response.status);
    const raw=await response.json();
    const proposal=parseJsonContent(raw?.choices?.[0]?.message?.content);
    const envelope=assembleTaskEnvelope(request,proposal);
    await validatePlanningDocument('task',envelope);
    return {envelope,raw};
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args=process.argv.slice(2);
  const requestIndex=args.indexOf('--request');
  const outputIndex=args.indexOf('--output');
  if(requestIndex<0||!args[requestIndex+1]||outputIndex<0||!args[outputIndex+1]) {
    throw new Error('usage: node scripts/local-planner.mjs --request request.json --output run-dir');
  }
  const requestPath=resolve(args[requestIndex+1]);
  const output=resolve(args[outputIndex+1]);
  const request=JSON.parse(await readFile(requestPath,'utf8'));
  await mkdir(output,{recursive:true});
  const started=Date.now();
  await writeFile(output+'/planning-request.json',JSON.stringify(request,null,2)+'\n');
  try {
    const {envelope,raw}=await planOneTask(request);
    await writeFile(output+'/planner-response.json',JSON.stringify(raw,null,2)+'\n');
    await writeFile(output+'/task.json',JSON.stringify(envelope,null,2)+'\n');
    const report={status:'task_ready',plan_id:envelope.plan_id,task_id:envelope.task_id,seconds:(Date.now()-started)/1000};
    await writeFile(output+'/planner-report.json',JSON.stringify(report,null,2)+'\n');
    process.stdout.write(JSON.stringify(report)+'\n');
  } catch(error) {
    const report={status:'failed',error_type:error.name,error:String(error.message||error),seconds:(Date.now()-started)/1000};
    await writeFile(output+'/planner-report.json',JSON.stringify(report,null,2)+'\n');
    console.error(JSON.stringify(report));
    process.exitCode=1;
  }
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
