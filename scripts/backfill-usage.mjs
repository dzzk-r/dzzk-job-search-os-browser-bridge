#!/usr/bin/env node
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {normalizeUsageTelemetry} from './usage-telemetry.mjs';

const root=process.argv[2]||'runs';
let created=0, skipped=0;
for(const name of await readdir(root,{withFileTypes:true})) {
  if(!name.isDirectory()) continue;
  const dir=join(root,name.name), source=join(dir,'planner-response.json'), target=join(dir,'usage-backfill.json');
  let raw;
  try { raw=JSON.parse(await readFile(source,'utf8')); } catch { continue; }
  try { await readFile(target,'utf8'); skipped++; continue; } catch {}
  const usage=normalizeUsageTelemetry(raw,{provider:'llamacpp',model:raw.model||null});
  if(!usage.input_tokens&&!usage.output_tokens) continue;
  const artifact={
    schema_version:'1.0',derived:true,source_artifact:'planner-response.json',
    derivation:'usage-telemetry-v1',created_at:new Date().toISOString(),usage
  };
  await writeFile(target,JSON.stringify(artifact,null,2)+'\n',{flag:'wx'});
  created++;
}
console.log(JSON.stringify({root,created,skipped}));
