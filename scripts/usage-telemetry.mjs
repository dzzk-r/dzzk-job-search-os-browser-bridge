function finiteNumber(value) {
  if(value===null||value===undefined||value==='') return null;
  const n=Number(value);
  return Number.isFinite(n)&&n>=0?n:null;
}

function firstNumber(...values) {
  for(const value of values) {
    const n=finiteNumber(value);
    if(n!==null) return n;
  }
  return null;
}

function exactMetric(value,source='provider_reported') {
  const n=finiteNumber(value);
  return n===null?null:{value:n,quality:'exact',source};
}

function estimatedTokens(text) {
  if(typeof text!=='string'||!text.length) return null;
  // Deliberately cheap/model-independent fallback. It is never billing truth.
  return {
    value:Math.max(1,Math.ceil(Buffer.byteLength(text,'utf8')/4)),
    quality:'estimated',
    source:'local_estimator',
    estimator:'utf8-bytes-per-token-v1'
  };
}

function normalizeCost(raw,provider,{input=null,output=null,cacheRead=null,cacheWrite=null,pricing=null}={}) {
  const usage=raw?.usage||{};
  const reported=firstNumber(usage.cost,usage.cost_usd,raw?.cost,raw?.cost_usd);
  if(reported!==null) return {value_usd:reported,quality:'exact',source:'provider_reported',status:'reported'};
  const p=String(provider||'').toLowerCase();
  if(['llamacpp','llama.cpp','ollama','local'].includes(p)) {
    return {value_usd:null,quality:'unavailable',source:'local_runtime',status:'not_metered',note:'No provider API billing; host/electricity cost is not estimated.'};
  }
  if(pricing && input?.quality==='exact' && output?.quality==='exact') {
    const inputRate=finiteNumber(pricing.input_per_million);
    const outputRate=finiteNumber(pricing.output_per_million);
    const cacheReadRate=finiteNumber(pricing.cache_read_per_million);
    const cacheWriteRate=finiteNumber(pricing.cache_write_per_million);
    if(inputRate!==null && outputRate!==null) {
      const read=cacheRead?.value||0, write=cacheWrite?.value||0;
      const ordinaryInput=cacheReadRate===null?input.value:Math.max(0,input.value-read);
      let usd=(ordinaryInput/1e6)*inputRate+(output.value/1e6)*outputRate;
      if(cacheReadRate!==null) usd+=(read/1e6)*cacheReadRate;
      if(cacheWriteRate!==null) usd+=(write/1e6)*cacheWriteRate;
      return {
        value_usd:Number(usd.toFixed(12)),quality:'derived',source:'pricing_metadata',status:'derived',
        pricing_source:pricing.source||null,pricing_as_of:pricing.as_of||null,
        note:'Derived from exact token counts and supplied pricing metadata; provider invoice remains authoritative.'
      };
    }
  }
  return {value_usd:null,quality:'unavailable',source:'pricing_unavailable',status:'not_available'};
}

export function normalizeUsageTelemetry(raw,{provider=null,model=null,inputText='',outputText='',elapsedSeconds=null,pricing=null}={}) {
  const usage=raw?.usage||{};
  const promptDetails=usage.prompt_tokens_details||usage.input_tokens_details||{};
  const cacheRead=firstNumber(
    promptDetails.cached_tokens,
    usage.cache_read_input_tokens,
    usage.cached_input_tokens,
    usage.cache_read_tokens
  );
  const cacheWrite=firstNumber(
    usage.cache_creation_input_tokens,
    usage.cache_write_input_tokens,
    usage.cache_write_tokens
  );
  const inputProvider=firstNumber(usage.prompt_tokens,usage.input_tokens);
  const inputRuntime=inputProvider===null&&raw?.timings?.prompt_n!=null
    ? firstNumber(Number(raw.timings.prompt_n)+Number(raw.timings.cache_n||0))
    : null;
  const outputProvider=firstNumber(usage.completion_tokens,usage.output_tokens);
  const outputRuntime=outputProvider===null?firstNumber(raw?.timings?.predicted_n):null;
  const input=exactMetric(inputProvider,'provider_reported')||exactMetric(inputRuntime,'runtime_reported')||estimatedTokens(inputText);
  const output=exactMetric(outputProvider,'provider_reported')||exactMetric(outputRuntime,'runtime_reported')||estimatedTokens(outputText);
  const totalReported=firstNumber(usage.total_tokens);
  const total=exactMetric(totalReported)||(
    input&&output?{
      value:input.value+output.value,
      quality:input.quality==='exact'&&output.quality==='exact'?'exact':'estimated',
      source:input.quality==='exact'&&output.quality==='exact'?'derived_from_exact_counts':'local_estimator',
      ...(input.quality==='estimated'||output.quality==='estimated'?{estimator:'sum-of-normalized-counts-v1'}:{})
    }:null
  );
  const runtimeRate=firstNumber(raw?.timings?.predicted_per_second,usage.output_tokens_per_second);
  const elapsed=finiteNumber(elapsedSeconds);
  const derivedRate=runtimeRate===null&&output&&elapsed&&elapsed>0?output.value/elapsed:null;
  const outputRate=runtimeRate!==null
    ? {value:runtimeRate,quality:'exact',source:'runtime_reported'}
    : derivedRate!==null
      ? {value:derivedRate,quality:output.quality==='exact'?'derived':'estimated',source:'derived_from_output_and_elapsed'}
      : null;
  return {
    schema_version:'1.0',
    provider:provider||null,
    model:model||raw?.model||null,
    input_tokens:input,
    output_tokens:output,
    total_tokens:total,
    cache_read_tokens:exactMetric(cacheRead),
    cache_write_tokens:exactMetric(cacheWrite),
    output_tokens_per_second:outputRate,
    cost:normalizeCost(raw,provider,{input,output,cacheRead:exactMetric(cacheRead),cacheWrite:exactMetric(cacheWrite),pricing}),
    semantics:'Token counts marked exact are provider/runtime reported. Estimated counts are local heuristics and are not billing truth.'
  };
}
