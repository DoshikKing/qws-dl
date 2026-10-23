import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { parse, compileScript } from "@vue/compiler-sfc";
import ts from "typescript";
import * as vue from "vue";

test("job log follows new output, pauses when reading history, and resumes at the bottom", async () => {
  const source = readFileSync(new URL("../app/components/JobLog.vue", import.meta.url), "utf8");
  const script = compileScript(parse(source).descriptor, { id: "job-log-test" });
  const { outputText } = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  });
  const exports = {};
  let mounted;
  const scope = vue.effectScope();
  const props = vue.reactive({ log: "initial output" });
  runInNewContext(outputText, {
    exports,
    require: () => vue,
    ref: vue.ref,
    watch: vue.watch,
    onMounted: (callback) => { mounted = callback; },
  });
  const component = scope.run(() => exports.default.setup(props, { expose() {} }));
  const element = { scrollTop: 0, scrollHeight: 1000, clientHeight: 300 };
  component.output.value = element;
  try {
    mounted();
    assert.equal(element.scrollTop, 1000, "opening shows the latest output");

    element.scrollHeight = 1200;
    props.log += "\nnew output";
    await vue.nextTick();
    assert.equal(element.scrollTop, 1200);

    element.scrollTop = 100;
    component.updateFollowing();
    element.scrollHeight = 1400;
    props.log += "\nmore output";
    await vue.nextTick();
    assert.equal(element.scrollTop, 100, "reading history keeps its position");

    element.scrollTop = 1100;
    component.updateFollowing();
    element.scrollHeight = 1600;
    props.log += "\nlatest output";
    await vue.nextTick();
    assert.equal(element.scrollTop, 1600, "returning to the bottom resumes following");
  } finally {
    scope.stop();
  }
});
