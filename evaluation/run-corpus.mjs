/**
 * Runs the screening evaluation corpus and computes the section-4 metrics:
 * per-rule precision/recall/unknown, legitimate-stop rate, evidence-span
 * correctness, usage, latency, and execution failures. Metrics are reported
 * overall and separately for the tuning and eval splits.
 *
 * Usage:
 *   node evaluation/run-corpus.mjs --live [--model jev-latest] [--record evaluation/recorded-live.jsonl]
 *   node evaluation/run-corpus.mjs --replay evaluation/recorded-live.jsonl [--out evaluation/results.json]
 *
 * Live mode reads TYPESAFE_API_KEY from the environment and sends one request
 * per case (the corpus is 60 cases). Nothing is retried automatically.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildScreeningRequests, screenFromRecordings, screenLive } from "../dist/screening.js";
import { createHttpTransport } from "../dist/transport.js";
import { loadCases, validateCases } from "./validate-cases.mjs";

const root = new URL("../", import.meta.url);
const pack = JSON.parse(readFileSync(new URL("rules/screening-pack.json", root), "utf8"));
const version = JSON.parse(readFileSync(new URL("package.json", root), "utf8")).version;

const { values } = parseArgs({
  options: {
    live: { type: "boolean", default: false },
    replay: { type: "string" },
    out: { type: "string", default: "evaluation/results.json" },
    record: { type: "string", default: "evaluation/recorded-live.jsonl" },
    model: { type: "string" },
    split: { type: "string", default: "all" },
  },
});

if (!["all", "tuning", "eval"].includes(values.split)) {
  console.error("--split must be all, tuning, or eval");
  process.exit(2);
}

const allCases = loadCases();
const problems = validateCases(allCases);
if (problems.length > 0) {
  for (const problem of problems) console.error(`case validation: ${problem}`);
  process.exit(2);
}
const cases = values.split === "all" ? allCases : allCases.filter(item => item.split === values.split);

const classifyCase = (item, report) => {
  const diagnostics = report.diagnostics;
  const observation = ruleId => report.observations.find(entry => entry.ruleId === ruleId);
  if (item.kind === "legitimate") {
    const stopped = diagnostics.length > 0;
    return {
      caseId: item.caseId,
      family: item.family,
      split: item.split,
      outcome: stopped ? "stopped" : "clean",
      signalRules: diagnostics.map(diagnostic => diagnostic.ruleId),
      unknownRules: report.observations
        .filter(entry => ["inconclusive", "not_applicable", "not_run", "malformed", "backend_error"].includes(entry.status))
        .map(entry => entry.ruleId),
    };
  }
  const expected = new Set([...item.expected.rules, ...item.expected.alternatives]);
  const hits = diagnostics.filter(diagnostic => expected.has(diagnostic.ruleId));
  if (hits.length > 0) {
    const spanOk = hits.some(diagnostic => diagnostic.locations[0]?.pointer === item.expected.evidencePointer);
    return {
      caseId: item.caseId,
      family: item.family,
      split: item.split,
      outcome: "hit",
      signalRules: diagnostics.map(diagnostic => diagnostic.ruleId),
      spanOk,
    };
  }
  const expectedObservations = item.expected.rules.map(observation).filter(entry => entry !== undefined);
  const unknown = expectedObservations.some(entry => ["inconclusive", "not_applicable", "not_run", "malformed", "backend_error"].includes(entry.status));
  return {
    caseId: item.caseId,
    family: item.family,
    split: item.split,
    outcome: unknown ? "unknown" : "miss",
    signalRules: diagnostics.map(diagnostic => diagnostic.ruleId),
  };
};

const metric = subset => {
  const rules = ["QSM001", "QSM002", "QSM003", "QSM004", "QBE004"];
  const perRule = Object.fromEntries(rules.map(rule => [rule, { tp: 0, fn: 0, unknown: 0, fp: 0 }]));
  let stoppedLegitimate = 0;
  let legitimate = 0;
  let hits = 0;
  let spanOk = 0;
  for (const item of subset) {
    const diagnostics = item.report.diagnostics;
    if (item.kind === "legitimate") {
      legitimate += 1;
      if (diagnostics.length > 0) stoppedLegitimate += 1;
      for (const diagnostic of diagnostics) {
        if (perRule[diagnostic.ruleId]) perRule[diagnostic.ruleId].fp += 1;
      }
      continue;
    }
    const expected = new Set([...item.expected.rules, ...item.expected.alternatives]);
    const hit = diagnostics.filter(diagnostic => expected.has(diagnostic.ruleId));
    const outcome = item.outcome;
    for (const rule of item.expected.rules) {
      if (!perRule[rule]) continue;
      if (outcome === "hit") perRule[rule].tp += 1;
      else if (outcome === "unknown") perRule[rule].unknown += 1;
      else perRule[rule].fn += 1;
    }
    for (const diagnostic of diagnostics) {
      if (expected.has(diagnostic.ruleId)) continue;
      if (perRule[diagnostic.ruleId]) perRule[diagnostic.ruleId].fp += 1;
    }
    if (hit.length > 0) {
      hits += 1;
      if (hit.some(diagnostic => diagnostic.locations[0]?.pointer === item.expected.evidencePointer)) spanOk += 1;
    }
  }
  return {
    perRule,
    legitimateStopRate: legitimate === 0 ? null : stoppedLegitimate / legitimate,
    evidenceSpanCorrectness: hits === 0 ? null : spanOk / hits,
    defectHits: subset.filter(item => item.kind === "defect" && item.outcome === "hit").length,
    defectUnknown: subset.filter(item => item.kind === "defect" && item.outcome === "unknown").length,
    defectMisses: subset.filter(item => item.kind === "defect" && item.outcome === "miss").length,
  };
};

const run = async () => {
  const detailed = [];
  let usage = null;
  let failures = 0;

  if (values.live) {
    const apiKey = process.env.TYPESAFE_API_KEY;
    if (apiKey === undefined || apiKey === "") {
      console.error("live mode requires TYPESAFE_API_KEY in the environment (the key is never written to disk)");
      process.exit(2);
    }
    const transport = createHttpTransport({ apiKey });
    const recordings = [];
    usage = { requests: 0, inputTokens: 0, outputTokens: 0, latencyMs: 0 };
    for (const item of cases) {
      const outcome = await screenLive(item.suite, pack, transport, version, {
        maxRequests: 1,
        ...(values.model === undefined ? {} : { model: values.model }),
        onRecord: recording => recordings.push(recording),
      });
      failures += outcome.failures.length;
      if (outcome.report.usage) {
        usage.requests += outcome.report.usage.requests;
        usage.inputTokens += outcome.report.usage.inputTokens;
        usage.outputTokens += outcome.report.usage.outputTokens;
        usage.latencyMs += outcome.report.usage.latencyMs;
      }
      detailed.push({ ...item, report: outcome.report, ...classifyCase(item, outcome.report) });
    }
    writeFileSync(values.record, recordings.map(recording => JSON.stringify(recording)).join("\n") + (recordings.length === 0 ? "" : "\n"), { mode: 0o600 });
  } else {
    if (values.replay === undefined) {
      console.error("usage: node evaluation/run-corpus.mjs --live | --replay <recorded.jsonl>");
      process.exit(2);
    }
    const byDigest = new Map();
    for (const line of readFileSync(values.replay, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      const recording = JSON.parse(line);
      byDigest.set(recording.requestDigest, recording);
    }
    for (const item of cases) {
      const requests = buildScreeningRequests(item.suite, pack);
      const recordingsForCase = requests
        .map(request => byDigest.get(request.requestDigest))
        .filter(recording => recording !== undefined);
      const report = screenFromRecordings(item.suite, pack, recordingsForCase, version);
      detailed.push({ ...item, report, ...classifyCase(item, report) });
    }
  }

  const subset = split => detailed.filter(item => item.split === split);
  const metrics = {
    corpus: {
      total: detailed.length,
      defect: detailed.filter(item => item.kind === "defect").length,
      legitimate: detailed.filter(item => item.kind === "legitimate").length,
    },
    overall: metric(detailed),
    tuning: metric(subset("tuning")),
    eval: metric(subset("eval")),
  };
  const result = {
    mode: values.live ? "live" : "replay",
    model: values.model ?? pack.model ?? "jev-latest",
    policy: detailed[0]?.report.policy ?? null,
    metrics,
    usage,
    backendFailures: failures,
    cases: detailed.map(item => ({
      caseId: item.caseId,
      family: item.family,
      kind: item.kind,
      split: item.split,
      outcome: item.outcome,
      signalRules: item.signalRules,
      spanOk: item.spanOk ?? null,
      diagnostics: item.report.diagnostics.length,
    })),
  };
  writeFileSync(values.out, JSON.stringify(result, null, 2) + "\n");

  const print = (label, value) => {
    console.log(`${label}: hits ${value.defectHits}, unknown ${value.defectUnknown}, misses ${value.defectMisses}, legitimate-stop ${value.legitimateStopRate === null ? "n/a" : `${Math.round(value.legitimateStopRate * 100)}%`}, span ${value.evidenceSpanCorrectness === null ? "n/a" : `${Math.round(value.evidenceSpanCorrectness * 100)}%`}`);
    for (const [rule, counts] of Object.entries(value.perRule)) {
      console.log(`  ${rule}: tp ${counts.tp}, unknown ${counts.unknown}, fn ${counts.fn}, fp ${counts.fp}`);
    }
  };
  console.log(`screening corpus (${values.live ? "live" : "replay"}), model ${result.model}`);
  if (usage) console.log(`usage: ${usage.requests} requests, ${usage.inputTokens} input tokens, ${usage.outputTokens} output tokens, ${usage.latencyMs} ms, failures ${failures}`);
  print("overall", metrics.overall);
  print("tuning", metrics.tuning);
  print("eval", metrics.eval);
  console.log(`wrote ${values.out}`);
};

await run();
