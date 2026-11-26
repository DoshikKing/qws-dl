import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as vue from 'vue';

test('visible polling serializes requests, pauses hidden/closed panels, resumes once and cleans up', async () => {
  const source = readFileSync(new URL('../app/composables/useVisiblePolling.ts', import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const exports = {}, document = new EventTarget(), timers = new Map(), enabled = vue.ref(true);
  document.visibilityState = 'visible';
  let mounted, unmounted, sequence = 0, calls = 0, settle;
  runInNewContext(outputText, {
    exports, document, watch: vue.watch,
    onMounted: fn => { mounted = fn; }, onBeforeUnmount: fn => { unmounted = fn; },
    setTimeout: fn => { const id = ++sequence; timers.set(id, fn); return id; },
    clearTimeout: id => { timers.delete(id); },
  });
  const scope = vue.effectScope();
  scope.run(() => exports.useVisiblePolling(() => { calls++; return new Promise(resolve => { settle = resolve; }); }, 3000, () => enabled.value));
  const visibility = state => { document.visibilityState = state; document.dispatchEvent(new Event('visibilitychange')); };
  const flush = async () => { await Promise.resolve(); await vue.nextTick(); };
  try {
    assert.equal(calls, 0, 'SSR does not access browser globals or fetch');
    mounted(); assert.equal(calls, 1); assert.equal(timers.size, 0);
    visibility('hidden'); visibility('visible'); visibility('visible');
    assert.equal(calls, 1, 'resuming during an in-flight request does not overlap it');
    settle(); await flush(); assert.equal(timers.size, 1);
    visibility('hidden'); assert.equal(timers.size, 0);
    visibility('visible'); assert.equal(calls, 2);
    enabled.value = false; await flush(); settle(); await flush(); assert.equal(timers.size, 0);
    enabled.value = true; await flush(); assert.equal(calls, 3);
    settle(); await flush(); const next = [...timers.values()][0]; timers.clear(); next();
    assert.equal(calls, 4, 'the next periodic request starts after settlement');
    unmounted(); settle(); await flush(); assert.equal(timers.size, 0);
    visibility('visible'); assert.equal(calls, 4, 'unmount removes the visibility listener');
  } finally { scope.stop(); }
});
