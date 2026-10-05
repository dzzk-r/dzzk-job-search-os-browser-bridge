import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs, constants as fsc } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

const MAX_READ = 60000;
const MAX_WRITE = 1024 * 1024;
const MAX_PROCS = 8;
const sha256 = b => createHash('sha256').update(b).digest('hex');
const inside = (path, root) => path === root || path.startsWith(root + sep);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function realRoot(path) {
  const real = await fs.realpath(path);
  const st = await fs.stat(real);
  if (!st.isDirectory()) throw new Error('Allowed root is not a directory.');
  return real;
}

export async function createLocalExecutor(options = {}) {
  const configured = options.allowedRoots ?? [join(homedir(), 'WORK')];
  const roots = await Promise.all(configured.map(realRoot));
  const stateDir = resolve(options.stateDir ?? join(homedir(), '.local', 'state', 'dzzk-local-executor'));
  await fs.mkdir(stateDir, {recursive:true, mode:0o700});
  await fs.chmod(stateDir, 0o700).catch(()=>{});
  const processes = new Map();

  const rootFor = path => roots.find(root => inside(path, root));
  async function existing(path, kind = 'path') {
    const requested = resolve(String(path));
    const real = await fs.realpath(requested);
    if (!rootFor(real)) throw new Error(kind + ' is outside allowed roots.');
    return real;
  }
  async function writeTarget(path) {
    const requested = resolve(String(path));
    let parent = dirname(requested);
    let realParent;
    while (true) {
      try { realParent = await fs.realpath(parent); break; }
      catch (e) { if (e.code !== 'ENOENT') throw e; const next = dirname(parent); if (next === parent) throw e; parent = next; }
    }
    const root = rootFor(realParent);
    if (!root) throw new Error('Write target is outside allowed roots.');
    const rel = requested.slice(parent.length).replace(/^\/+/, '');
    const candidate = resolve(realParent, rel);
    if (!inside(candidate, root)) throw new Error('Write target is outside allowed roots.');
    try {
      const st = await fs.lstat(requested);
      if (st.isSymbolicLink()) throw new Error('Refusing to write through a symlink.');
      const real = await fs.realpath(requested);
      if (!inside(real, root)) throw new Error('Write target is outside allowed roots.');
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return candidate;
  }
  const proc = id => {
    const item = processes.get(String(id));
    if (!item) throw new Error('Unknown local processId.');
    return item;
  };
  const runningCount = () => [...processes.values()].filter(p => p.exitCode === null).length;

  async function status() {
    return {allowedRoots:[...roots], stateDir, running:runningCount(), tracked:processes.size, execMode:'trusted-shell'};
  }
  async function listDir({path, limit = 200}) {
    const dir = await existing(path, 'Directory');
    const st = await fs.stat(dir); if (!st.isDirectory()) throw new Error('Path is not a directory.');
    limit = Math.min(Math.max(Number(limit)||200,1),500);
    const entries = await fs.readdir(dir,{withFileTypes:true});
    const out = [];
    for (const e of entries.slice(0,limit)) {
      const full = join(dir,e.name); let size = null;
      if (e.isFile()) { try { size=(await fs.stat(full)).size; } catch {} }
      out.push({name:e.name,type:e.isDirectory()?'directory':e.isFile()?'file':e.isSymbolicLink()?'symlink':'other',size});
    }
    return {path:dir,entries:out,truncated:entries.length>limit};
  }
  async function readFile({path, offset = 0, maxChars = 30000}) {
    const file = await existing(path, 'File');
    const st = await fs.stat(file); if (!st.isFile()) throw new Error('Path is not a regular file.');
    offset = Math.max(0,Number(offset)||0);
    maxChars = Math.min(Math.max(Number(maxChars)||30000,1),MAX_READ);
    const text = await fs.readFile(file,'utf8');
    return {path:file,text:text.slice(offset,offset+maxChars),offset,nextOffset:Math.min(text.length,offset+maxChars),truncated:offset+maxChars<text.length,sha256:sha256(Buffer.from(text))};
  }
  async function writeFile({path, text, expectedSha256}) {
    if (typeof text !== 'string') throw new Error('text must be a string.');
    const bytes = Buffer.from(text);
    if (bytes.length > MAX_WRITE) throw new Error('Write exceeds 1 MiB.');
    const target = await writeTarget(path);
    let current = null;
    try {
      current = await fs.readFile(target);
      if (typeof expectedSha256 !== 'string' || expectedSha256 !== sha256(current)) throw new Error('Existing file changed or expectedSha256 is missing.');
    } catch (e) { if (e.code !== 'ENOENT') throw e; if (expectedSha256 != null) throw new Error('expectedSha256 supplied for a new file.'); }
    await fs.mkdir(dirname(target),{recursive:true});
    const tmp = join(dirname(target),'.'+randomUUID()+'.tmp');
    try {
      await fs.writeFile(tmp,bytes,{mode:0o600,flag:'wx'});
      await fs.rename(tmp,target);
    } finally { await fs.rm(tmp,{force:true}).catch(()=>{}); }
    return {path:target,bytes:bytes.length,sha256:sha256(bytes),created:current===null};
  }
  async function execStart({cwd, command}, trace = null) {
    if (typeof command !== 'string' || !command.trim() || command.length > 4000) throw new Error('command must contain 1-4000 characters.');
    if (runningCount() >= MAX_PROCS) throw new Error('Too many local processes.');
    const realCwd = await existing(cwd, 'cwd');
    const st = await fs.stat(realCwd); if (!st.isDirectory()) throw new Error('cwd is not a directory.');
    const id = randomUUID(), logPath = join(stateDir,id+'.log');
    const fd = await fs.open(logPath,'wx',0o600);
    const env={...process.env};
    if (trace?.correlation_id) env.EDH_CORRELATION_ID=trace.correlation_id;
    if (trace?.span_id) env.EDH_PARENT_SPAN_ID=trace.span_id;
    if (trace?.run_id) env.EDH_MCP_RUN_ID=trace.run_id;
    if (trace?.tool) env.EDH_MCP_TOOL=trace.tool;
    const child = spawn('/bin/zsh',['-lc',command],{cwd:realCwd,detached:true,stdio:['ignore',fd.fd,fd.fd],env});
    const item = {id,pid:child.pid,cwd:realCwd,command,logPath,child,exitCode:null,signal:null,stopping:false,startedAt:new Date().toISOString(),trace:trace?{correlation_id:trace.correlation_id,span_id:trace.span_id,run_id:trace.run_id,tool:trace.tool}:null};
    processes.set(id,item);
    child.once('exit',(code,signal)=>{item.exitCode=code;item.signal=signal;void fd.close().catch(()=>{});});
    child.once('error',()=>{void fd.close().catch(()=>{});});
    child.unref();
    return {processId:id,pid:child.pid,cwd:realCwd,startedAt:item.startedAt,correlationId:item.trace?.correlation_id??null,parentSpanId:item.trace?.span_id??null};
  }
  async function processOutput({processId, offset = 0, maxBytes = 30000}) {
    const item = proc(processId);
    offset = Math.max(0,Number(offset)||0);
    maxBytes = Math.min(Math.max(Number(maxBytes)||30000,1),MAX_READ);
    let data = Buffer.alloc(0);
    try {
      const fh=await fs.open(item.logPath,'r');
      try { const st=await fh.stat(); const n=Math.max(0,Math.min(maxBytes,st.size-offset)); data=Buffer.alloc(n); if(n) await fh.read(data,0,n,offset); }
      finally { await fh.close(); }
    } catch {}
    return {processId:item.id,pid:item.pid,output:data.toString('utf8'),offset,nextOffset:offset+data.length,running:item.exitCode===null && !item.stopping,exitCode:item.exitCode,signal:item.signal};
  }
  async function processStop({processId}) {
    const item = proc(processId);
    if (item.exitCode !== null) return {processId:item.id,stopped:false,exitCode:item.exitCode};
    item.stopping = true;
    try { process.kill(-item.pid,'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
    for (let i=0;i<10 && item.exitCode===null;i++) await sleep(100);
    if (item.exitCode===null) { try { process.kill(-item.pid,'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
    for (let i=0;i<10 && item.exitCode===null;i++) await sleep(50);
    return {processId:item.id,stopped:true,exitCode:item.exitCode,signal:item.signal};
  }
  async function close() {
    for (const item of processes.values()) if (item.exitCode===null) await processStop({processId:item.id}).catch(()=>{});
  }
  return {status,listDir,readFile,writeFile,execStart,processOutput,processStop,close};
}
