import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lintValidatedSuite } from '../dist/static-checks.js';
const baseline = JSON.parse(readFileSync(new URL('../examples/scope-monitor.suite.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(baseline);
const codes = (s, caps) => lintValidatedSuite(s, caps).diagnostics.map(d => d.ruleId);
const expects = (s, code) => assert.ok(codes(s).includes(code), JSON.stringify(lintValidatedSuite(s), null, 2));
const categorical = () => ({kind:'categorical',selection:'best_fit',options:[{id:'first',description:'First category.'},{id:'second',description:'Second category.'}]});

test('valid fixture has no cross-reference violations; semantics explicitly not checked', () => {
  const report = lintValidatedSuite(fresh());
  assert.deepEqual(report.diagnostics, []);
  assert.equal(report.scope, 'reference_static_checks_only');
  assert.ok(report.notExecuted.includes('semantic screening'));
});
test('unknown input reference', () => { const s=fresh();s.questions[1].inputs.push('unknown');expects(s,'QCT002'); });
test('stage cycle', () => { const s=fresh();s.state.stages[0].after=['complete'];expects(s,'QCT003'); });
test('future input is not available during execution', () => { const s=fresh();s.questions[1].inputs.push('final_outcome');expects(s,'QCT004'); });
test('direct evaluation label leakage', () => { const s=fresh();s.questions[1].inputs.push('final_outcome');expects(s,'QCT005'); });
test('derived label leakage', () => {
  const s=fresh();s.state.fields.push({...s.state.fields[3],id:'summary',pointer:'/summary',role:'evidence',derivedFrom:['final_outcome']});
  s.questions[1].inputs.push('summary');expects(s,'QCT005');
});
test('lineage availability cannot be erased by an earlier declared timestamp', () => {
  const s=fresh();s.state.fields.push({...s.state.fields[3],id:'summary',pointer:'/summary',role:'evidence',availableFrom:'start',derivedFrom:['final_outcome']});
  s.questions[1].inputs.push('summary');expects(s,'QCT004');
});
test('non-boolean gate', () => { const s=fresh();s.questions[0].output=categorical();expects(s,'QCT007'); });
test('gate thresholds overlap', () => { const s=fresh();s.bindings[1].gates[0].falseAtMost=.8;s.bindings[1].gates[0].trueAtLeast=.2;expects(s,'QCT007'); });
test('duplicate category IDs', () => { const s=fresh();s.questions[1].output=categorical();s.questions[1].output.options[1].id='first';expects(s,'QCT006'); });
test('fallback must identify a declared category', () => { const s=fresh();s.questions[1].output={...categorical(),fallbackOptionId:'other'};expects(s,'QCT006'); });
test('duplicate question ID', () => { const s=fresh();s.questions.push(structuredClone(s.questions[0]));expects(s,'QCT008'); });
test('a question requires a binding', () => { const s=fresh();s.bindings.pop();expects(s,'QCT008'); });
test('policy references require policy role', () => { const s=fresh();s.questions[1].policyRefs=['task'];expects(s,'QCT009'); });
test('parent selector containing a declared target is unsafe', () => {
  const s=fresh();s.state.fields[3].pointer='/trace/final_outcome';s.state.fields[1].pointer='/trace';expects(s,'QCT005');
});
test('child selector inside a declared target is unsafe', () => {
  const s=fresh();s.state.fields[3].pointer='/labels';s.state.fields[1].pointer='/labels/outcome';expects(s,'QCT005');
});
test('gate dependency cycle', () => { const s=fresh();s.bindings[0].gates=[{...s.bindings[1].gates[0],questionId:'scope_drift'}];expects(s,'QCT003'); });
test('field lineage cycle', () => { const s=fresh();s.state.fields[0].derivedFrom=['diff'];s.state.fields[1].derivedFrom=['task'];expects(s,'QCT003'); });
test('ambiguous prose is NOT falsely certified or rejected by a static checker', () => {
  const s=JSON.parse(readFileSync(new URL('../examples/semantic-ambiguity.suite.json',import.meta.url),'utf8'));
  assert.deepEqual(codes(s),[]);
});
test('backend capability limits are checked separately', () => {
  const s=fresh();s.questions[1].output=categorical();
  assert.ok(codes(s,{kinds:['boolean','categorical'],nativeDistribution:true,nativeAbstention:false,maxCategoricalOptions:1}).includes('QBE002'));
});
test('an unsupported output kind is a capability error', () => {
  const s=fresh();s.questions[1].output=categorical();
  assert.ok(codes(s,{kinds:['boolean'],nativeDistribution:true,nativeAbstention:false}).includes('QBE001'));
});
test('separate prerequisite branches are not implicitly ordered', () => {
  const s=fresh();s.state.stages.push({id:'review',after:['start']});s.state.fields[1].availableFrom='review';expects(s,'QCT004');
});
test('input suite remains unmodified', () => {
  const s=fresh(); const before=JSON.stringify(s); lintValidatedSuite(s); assert.equal(JSON.stringify(s),before);
});
