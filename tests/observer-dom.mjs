import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Observer event bindings reference elements present in observer.html', async () => {
  const html=await readFile(new URL('../chrome/observer.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
  const listenerTargets=[...js.matchAll(/must\('([^']+)'\)\.addEventListener/g)].map(m=>m[1]);
  assert.ok(listenerTargets.length>0,'expected Observer event bindings');
  assert.deepEqual(listenerTargets.filter(id=>!ids.has(id)),[]);
  const allDollarRefs=[...new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]))];
  assert.deepEqual(allDollarRefs.filter(id=>!ids.has(id)),[]);
});
