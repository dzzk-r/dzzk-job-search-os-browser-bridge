import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUsageTelemetry} from '../scripts/usage-telemetry.mjs';

test('normalizes llama.cpp reported tokens cache and throughput without estimating',()=>{
  const telemetry=normalizeUsageTelemetry({
    model:'qwen3.8-27b',
    usage:{prompt_tokens:5132,completion_tokens:879,total_tokens:6011,prompt_tokens_details:{cached_tokens:243}},
    timings:{predicted_per_second:17.5018}
  },{provider:'llamacpp'});
  assert.deepEqual(telemetry.input_tokens,{value:5132,quality:'exact',source:'provider_reported'});
  assert.deepEqual(telemetry.output_tokens,{value:879,quality:'exact',source:'provider_reported'});
  assert.equal(telemetry.cache_read_tokens.value,243);
  assert.equal(telemetry.output_tokens_per_second.value,17.5018);
  assert.equal(telemetry.cost.status,'not_metered');
  assert.equal(telemetry.cost.value_usd,null);
});

test('uses an explicitly labeled local heuristic only when token counts are absent',()=>{
  const telemetry=normalizeUsageTelemetry({model:'cloud-model'},{provider:'cloud-provider',inputText:'abcdefgh',outputText:'abcd'});
  assert.equal(telemetry.input_tokens.value,2);
  assert.equal(telemetry.input_tokens.quality,'estimated');
  assert.equal(telemetry.input_tokens.estimator,'utf8-bytes-per-token-v1');
  assert.equal(telemetry.output_tokens.value,1);
  assert.equal(telemetry.total_tokens.quality,'estimated');
  assert.equal(telemetry.cost.status,'not_available');
});

test('preserves provider-reported cloud cost when available',()=>{
  const telemetry=normalizeUsageTelemetry({usage:{input_tokens:1000,output_tokens:200,cost:0.0042}},{provider:'cloud-provider',model:'cloud-model'});
  assert.equal(telemetry.cost.value_usd,0.0042);
  assert.equal(telemetry.cost.quality,'exact');
  assert.equal(telemetry.cost.source,'provider_reported');
});


test('derives cloud cost only from exact counts plus explicit pricing metadata',()=>{
  const telemetry=normalizeUsageTelemetry({
    usage:{input_tokens:1000000,output_tokens:500000,input_tokens_details:{cached_tokens:200000}}
  },{
    provider:'cloud-provider',model:'cloud-model',
    pricing:{input_per_million:2,output_per_million:8,cache_read_per_million:0.5,source:'adapter-price-card-v1',as_of:'2026-10-08'}
  });
  assert.equal(telemetry.cost.value_usd,5.7);
  assert.equal(telemetry.cost.quality,'derived');
  assert.equal(telemetry.cost.pricing_source,'adapter-price-card-v1');
  assert.equal(telemetry.cost.pricing_as_of,'2026-10-08');
});
