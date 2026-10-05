import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile as fsWriteFile, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalExecutor } from '../server/local-executor.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(),'dzzk-local-root-'));
  const state = await mkdtemp(join(tmpdir(),'dzzk-local-state-'));
  const outside = await mkdtemp(join(tmpdir(),'dzzk-local-outside-'));
  const exec = await createLocalExecutor({allowedRoots:[root],stateDir:state});
  return {root,state,outside,exec,async close(){await exec.close();await rm(root,{recursive:true,force:true});await rm(state,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}};
}

test('root escape and symlink escape are rejected', async () => {
  const f=await fixture();
  try {
    await fsWriteFile(join(f.outside,'secret.txt'),'secret');
    await symlink(f.outside,join(f.root,'escape'));
    await assert.rejects(f.exec.readFile({path:join(f.outside,'secret.txt')}),/outside allowed roots/);
    await assert.rejects(f.exec.readFile({path:join(f.root,'escape','secret.txt')}),/outside allowed roots/);
    await assert.rejects(f.exec.writeFile({path:join(f.root,'escape','new.txt'),text:'x'}),/outside allowed roots|symlink/);
  } finally { await f.close(); }
});

test('write requires optimistic hash for replacement', async () => {
  const f=await fixture();
  try {
    const path=join(f.root,'a.txt');
    const created=await f.exec.writeFile({path,text:'one'});
    assert.equal(created.created,true);
    await assert.rejects(f.exec.writeFile({path,text:'two'}),/expectedSha256/);
    await assert.rejects(f.exec.writeFile({path,text:'two',expectedSha256:'bad'}),/expectedSha256/);
    const changed=await f.exec.writeFile({path,text:'two',expectedSha256:created.sha256});
    assert.equal(changed.created,false);
    assert.equal(await readFile(path,'utf8'),'two');
  } finally { await f.close(); }
});

test('exec output is captured and unknown process cannot be stopped', async () => {
  const f=await fixture();
  try {
    const p=await f.exec.execStart({cwd:f.root,command:"printf 'hello\\n'"});
    let out={running:true}, offset=0;
    for(let i=0;i<30 && out.running;i++) {
      await new Promise(r=>setTimeout(r,25));
      out=await f.exec.processOutput({processId:p.processId,offset});
      offset=out.nextOffset;
    }
    const all=await f.exec.processOutput({processId:p.processId,offset:0});
    assert.match(all.output,/hello/);
    assert.equal(all.running,false);
    assert.equal(all.exitCode,0);
    await assert.rejects(f.exec.processStop({processId:'not-owned'}),/Unknown local processId/);
  } finally { await f.close(); }
});

test('stop only addresses an owned process id', async () => {
  const f=await fixture();
  try {
    const p=await f.exec.execStart({cwd:f.root,command:'sleep 20'});
    const stopped=await f.exec.processStop({processId:p.processId});
    assert.equal(stopped.stopped,true);
    const out=await f.exec.processOutput({processId:p.processId});
    assert.equal(out.running,false);
  } finally { await f.close(); }
});


test('execStart propagates Harness correlation metadata through environment', async () => {
  const f=await fixture();
  try {
    const trace={correlation_id:'corr:test-root',span_id:'mcp:corr:test-root:tool:local_exec_start',run_id:'mcp:corr:test-root',tool:'local_exec_start'};
    const p=await f.exec.execStart({cwd:f.root,command:`printf '%s|%s|%s|%s' "$EDH_CORRELATION_ID" "$EDH_PARENT_SPAN_ID" "$EDH_MCP_RUN_ID" "$EDH_MCP_TOOL"`},trace);
    let out={running:true};
    for(let i=0;i<40 && out.running;i++){ await new Promise(r=>setTimeout(r,25)); out=await f.exec.processOutput({processId:p.processId,offset:0}); }
    assert.equal(out.output,'corr:test-root|mcp:corr:test-root:tool:local_exec_start|mcp:corr:test-root|local_exec_start');
    assert.equal(p.correlationId,'corr:test-root');
    assert.equal(p.parentSpanId,'mcp:corr:test-root:tool:local_exec_start');
  } finally { await f.close(); }
});
