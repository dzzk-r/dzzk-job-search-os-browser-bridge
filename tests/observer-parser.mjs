import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('Observer parser survives malformed OpenCode tool input', () => {
  const code = String.raw`
import importlib.util, json, tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('observer', 'scripts/run-observer.py')
mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
with tempfile.TemporaryDirectory() as td:
    root=Path(td)
    (root/'event-context.json').write_text(json.dumps({'correlation_id':'corr:test','oc_span_id':'oc:test'}))
    event={'type':'tool_use','timestamp':1,'part':{'tool':'edit','state':{'status':'error','input':'{truncated-json'}}}
    (root/'events.log').write_text(json.dumps(event)+'\n')
    out,last,count=mod.parse_opencode(root/'events.log')
    assert count == 1
    assert len(out) == 1
    assert out[0]['source'] == 'OC'
    assert 'edit error' in out[0]['message']
    assert out[0]['correlation']['correlation_id'] == 'corr:test'
print('ok')
`;
  const result = spawnSync('python3', ['-c', code], {cwd:new URL('..', import.meta.url), encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /ok/);
});


test('project trajectory reconstructs Git age, velocity and daily TODO readiness checkpoints', () => {
  const code=String.raw`
import importlib.util, json
from pathlib import Path
spec=importlib.util.spec_from_file_location('observer','scripts/run-observer.py')
mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
t=mod.project_trajectory(Path('.'))
assert t['commit_count'] >= 1
assert t['started_at']
assert t['age_seconds'] >= 0
assert isinstance(t['commits_last_24h'], int)
assert isinstance(t['readiness_trajectory'], list)
assert t['readiness_trajectory']
assert all('average_percent' in x and 'task_count' in x and 'complete_count' in x for x in t['readiness_trajectory'])
print(json.dumps({'commits':t['commit_count'],'points':len(t['readiness_trajectory'])}))
`;
  const result=spawnSync('python3',['-c',code],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
  assert.match(result.stdout,/"commits"/);
});
