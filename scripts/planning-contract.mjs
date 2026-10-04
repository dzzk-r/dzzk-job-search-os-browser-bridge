#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function validateAgainstSchema(schema,value,path='$') {
  const matchesType=(v,type)=>{
    if(type==='null') return v===null;
    if(type==='array') return Array.isArray(v);
    if(type==='object') return v!==null && typeof v==='object' && !Array.isArray(v);
    if(type==='integer') return Number.isInteger(v);
    return typeof v===type;
  };
  if(schema.const!==undefined && value!==schema.const) throw new Error(path+': expected const '+JSON.stringify(schema.const));
  if(schema.enum && !schema.enum.includes(value)) throw new Error(path+': value not in enum');
  if(schema.type) {
    const types=Array.isArray(schema.type)?schema.type:[schema.type];
    if(!types.some(t=>matchesType(value,t))) throw new Error(path+': invalid type');
  }
  if(typeof value==='string' && schema.minLength!==undefined && value.length<schema.minLength) throw new Error(path+': too short');
  if(typeof value==='number' && schema.minimum!==undefined && value<schema.minimum) throw new Error(path+': below minimum');
  if(Array.isArray(value)) {
    if(schema.minItems!==undefined && value.length<schema.minItems) throw new Error(path+': too few items');
    if(schema.items) value.forEach((v,i)=>validateAgainstSchema(schema.items,v,path+'['+i+']'));
  }
  if(value!==null && typeof value==='object' && !Array.isArray(value)) {
    for(const key of schema.required||[]) if(!(key in value)) throw new Error(path+'.'+key+': required');
    if(schema.additionalProperties===false && schema.properties) {
      for(const key of Object.keys(value)) if(!(key in schema.properties)) throw new Error(path+'.'+key+': additional property');
    }
    for(const [key,sub] of Object.entries(schema.properties||{})) if(key in value) validateAgainstSchema(sub,value[key],path+'.'+key);
  }
  return value;
}

export async function loadPlanningSchema(kind) {
  const names={
    task:'task-envelope.schema.json',
    escalation:'escalation-packet.schema.json'
  };
  if(!names[kind]) throw new Error('kind must be task or escalation');
  return JSON.parse(await readFile(new URL('../schemas/'+names[kind],import.meta.url),'utf8'));
}

export async function validatePlanningDocument(kind,value) {
  return validateAgainstSchema(await loadPlanningSchema(kind),value);
}

async function main() {
  const [kind,file]=process.argv.slice(2);
  if(!kind||!file) throw new Error('usage: node scripts/planning-contract.mjs <task|escalation> <file.json>');
  const value=JSON.parse(await readFile(file,'utf8'));
  await validatePlanningDocument(kind,value);
  process.stdout.write(JSON.stringify({ok:true,kind,file})+'\n');
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
