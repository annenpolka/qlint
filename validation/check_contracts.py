"""Validate the shipped examples and negative schema fixtures (no network)."""
from pathlib import Path
from copy import deepcopy
import json
from jsonschema import Draft202012Validator
ROOT=Path(__file__).resolve().parents[1]
def read(path): return json.loads((ROOT/path).read_text(encoding='utf-8'))
qs=read('schemas/question-suite.schema.json'); ds=read('schemas/diagnostic.schema.json')
Draft202012Validator.check_schema(qs); Draft202012Validator.check_schema(ds)
v=Draft202012Validator(qs); d=Draft202012Validator(ds)
results=[]
for path in sorted((ROOT/'examples').glob('*.suite.json')):
    obj=read(path.relative_to(ROOT)); v.validate(obj)
    results.append({'test':f'schema accepts {path.name}','passed':True})
d.validate(read('examples/diagnostic.model-signal.json'))
results.append({'test':'diagnostic schema validates the explicitly synthetic fixture','passed':True})
located=read('examples/diagnostic.model-signal.json')
located['locations'][0].update({'file':'suite.json','line':3,'column':5})
d.validate(located)
results.append({'test':'diagnostic locations accept optional file/line/column','passed':True})
def negative_diag(name,change):
    sample=deepcopy(read('examples/diagnostic.model-signal.json'));change(sample)
    assert list(d.iter_errors(sample)), name
    results.append({'test':name,'passed':True})
negative_diag('non-positive diagnostic line rejected',lambda s:s['locations'][0].update({'line':0}))
negative_diag('non-positive diagnostic column rejected',lambda s:s['locations'][0].update({'column':-1}))
negative_diag('blank diagnostic file rejected',lambda s:s['locations'][0].update({'file':' '}))
ps=read('schemas/execution-plan.schema.json'); Draft202012Validator.check_schema(ps); pv=Draft202012Validator(ps)
plan_sample={
 'schemaVersion':'0.1','kind':'qlint.execution-plan',
 'tool':{'name':'qlint','version':'0.1.0'},
 'provider':{'name':'replay','network':False},
 'suite':{'id':'fixture','digest':'sha256:'+'0'*64},
 'questions':[{'questionId':'q','atStage':'start','profile':'feature','mode':'interpret','outputKind':'boolean','gates':[],
   'inputs':[{'fieldId':'task','pointer':'/task','valueType':'string','nullable':False,'role':'evidence','sensitivity':'internal','handling':'verbatim'}],
   'policyRefs':[],
   'redaction':{'policy':'explicit-projection-v0.1','excludedFieldIds':[],'restrictedFieldIds':[],'note':'note'},
   'limits':{'rationale':'note'}}],
 'requestCount':1,'maxRequests':1,'notes':['note'],'digest':'sha256:'+'1'*64}
pv.validate(plan_sample)
results.append({'test':'execution plan schema accepts a minimal plan','passed':True})
def negative_plan(name,change):
    sample=deepcopy(plan_sample);change(sample)
    assert list(pv.iter_errors(sample)), name
    results.append({'test':name,'passed':True})
negative_plan('malformed plan digest rejected',lambda p:p.update({'digest':'deadbeef'}))
negative_plan('target role rejected in a plan projection',lambda p:p['questions'][0]['inputs'][0].update({'role':'target'}))
negative_plan('unknown plan kind rejected',lambda p:p.update({'kind':'something_else'}))
base=read('examples/scope-monitor.suite.json')
def negative(name,change):
    sample=deepcopy(base);change(sample)
    assert list(v.iter_errors(sample)), name
    results.append({'test':name,'passed':True})
negative('unknown property rejected',lambda s:s['questions'][0].update({'confidence':.9}))
negative('predict requires a target/horizon',lambda s:s['questions'][0].update({'mode':'predict'}))
negative('non-predict forbids prediction metadata',lambda s:s['questions'][0].update({'prediction':{'targetRef':'final_outcome','horizon':'completion'}}))
negative('missing input cannot silently become false',lambda s:s['questions'][0].update({'missingInput':'false'}))
negative('invalid probability bounds rejected',lambda s:s['bindings'][1]['gates'][0].update({'trueAtLeast':1.5}))
negative('single categorical option rejected',lambda s:s['questions'][0].update({'output':{'kind':'categorical','selection':'best_fit','options':[{'id':'a','description':'A'}]}}))
negative('malformed JSON Pointer rejected',lambda s:s['state']['fields'][0].update({'pointer':'task'}))
negative('root selector rejected',lambda s:s['state']['fields'][0].update({'pointer':''}))
negative('unknown output kind rejected',lambda s:s['questions'][0]['output'].update({'kind':'score'}))
negative('empty instructions rejected',lambda s:s['questions'][0].update({'instructions':' '}))
negative('boolean needs both criteria',lambda s:s['questions'][0]['output']['criteria'].pop('false'))
report={'suiteSchema':'Draft 2020-12','passed':len(results),'failed':0,'tests':results}
(ROOT/'validation/schema-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'passed':len(results),'failed':0}))
