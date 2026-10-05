import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCorrelationContext} from '../scripts/run-task-envelope.mjs';

test('task envelope reuses upstream MCP correlation when present',()=>{
  const ctx=resolveCorrelationContext({
    EDH_CORRELATION_ID:'corr:upstream',
    EDH_PARENT_SPAN_ID:'mcp:corr:upstream:tool:local_exec_start',
    EDH_MCP_RUN_ID:'mcp:corr:upstream',
    EDH_MCP_TOOL:'local_exec_start'
  });
  assert.equal(ctx.correlationId,'corr:upstream');
  assert.equal(ctx.upstreamParentSpan,'mcp:corr:upstream:tool:local_exec_start');
  assert.equal(ctx.upstreamRunId,'mcp:corr:upstream');
  assert.equal(ctx.upstreamTool,'local_exec_start');
});

test('task envelope allocates a new correlation when no upstream trace exists',()=>{
  const ctx=resolveCorrelationContext({});
  assert.match(ctx.correlationId,/^corr:/);
  assert.equal(ctx.upstreamParentSpan,null);
});
