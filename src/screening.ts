/**
 * Semantic screening: builds small meta-questions about each QuestionSpec and
 * turns validated Noul answers into model_signal diagnostics.
 *
 * The model never sees state values, expected diagnostics, or rule
 * thresholds: the sent state contains the question text and field descriptors
 * only. Diagnostics are assembled here from the rule pack, so a candidate
 * answer cannot change severity, rule identity, or output shape.
 *
 * Two execution modes share one classifier:
 * - screenFromRecordings: recorded responses (offline, deterministic)
 * - screenLive: an injected transport (the only network path in the bundle)
 */
import { parseNoulAnswer, parseSystemOneResponse } from "./adapter.js";
import type {
  Diagnostic,
  Json,
  QuestionSpec,
  QuestionSuite,
  RecordedResponse,
  ScreeningObservation,
  ScreeningPack,
  ScreeningPolicy,
  ScreeningReport,
  ScreeningRequest,
  ScreeningRuleDefinition,
  ScreeningRuleView,
  ScreeningSubQuestion,
  ScreeningUsage,
} from "./contracts.js";
import { digestOf } from "./digest.js";
import type { BackendFailure, SystemOneTransport } from "./transport.js";

export class ScreeningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreeningError";
  }
}

export const SCREENING_POLICY: ScreeningPolicy = {
  policyId: "screening-reference-v0.1",
  applicabilityAtLeast: 0.8,
  sufficiencyAtLeast: 0.8,
  signalAtLeast: 0.5,
  note: "Uncalibrated defaults for the reference implementation. Choose thresholds on validation data before relying on them; a signal is a model_signal, not a verdict.",
};

export function ruleApplies(rule: ScreeningRuleDefinition, question: QuestionSpec): boolean {
  const { modes, outputKinds } = rule.appliesTo;
  if (modes !== undefined && !modes.includes(question.mode)) return false;
  if (outputKinds !== undefined && !outputKinds.includes(question.output.kind)) return false;
  return true;
}

function describeOutput(output: QuestionSpec["output"]): Json {
  if (output.kind === "boolean") {
    return { kind: "boolean", criteria: { true: output.criteria.true, false: output.criteria.false } };
  }
  if (output.kind === "categorical") {
    return {
      kind: "categorical",
      selection: output.selection,
      options: output.options.map(option => ({ id: option.id, description: option.description })),
      ...(output.fallbackOptionId === undefined ? {} : { fallbackOptionId: output.fallbackOptionId }),
      ...(output.tieBreak === undefined ? {} : { tieBreak: output.tieBreak }),
    };
  }
  return {
    kind: "ordinal",
    axis: output.axis,
    levels: output.levels.map(level => ({ id: level.id, description: level.description })),
  };
}

function describeField(suite: QuestionSuite, fieldId: string): Json {
  const field = suite.state.fields.find(candidate => candidate.id === fieldId);
  if (!field) throw new ScreeningError(`question references unknown field ${fieldId}`);
  return {
    fieldId: field.id,
    pointer: field.pointer,
    valueType: field.valueType,
    nullable: field.nullable,
    role: field.role,
  };
}

function subQuestion(definition: { instructions: string; criteria: { true: string; false: string } }): ScreeningSubQuestion {
  return { type: "noul", instructions: definition.instructions, criteria: definition.criteria };
}

export function buildScreeningRequests(suite: QuestionSuite, pack: ScreeningPack): ScreeningRequest[] {
  const model = pack.model ?? "jev-latest";
  const requests: ScreeningRequest[] = [];
  suite.questions.forEach((question, questionIndex) => {
    const rules = pack.rules.filter(rule => ruleApplies(rule, question));
    if (rules.length === 0) return;
    const state: Json = {
      question: {
        instructions: question.instructions,
        mode: question.mode,
        applicability: question.applicability,
        evidenceBoundary: question.evidenceBoundary,
        output: describeOutput(question.output),
        inputs: question.inputs.map(fieldId => describeField(suite, fieldId)),
        policyRefs: question.policyRefs.map(fieldId => describeField(suite, fieldId)),
      },
    };
    const questions: Record<string, ScreeningSubQuestion> = {};
    const ruleViews: ScreeningRuleView[] = [];
    for (const rule of rules) {
      const subQuestionIds = {
        applicability: `${rule.id}__applicability`,
        sufficiency: `${rule.id}__sufficiency`,
        violation: `${rule.id}__violation`,
      };
      questions[subQuestionIds.applicability] = subQuestion(rule.applicability);
      questions[subQuestionIds.sufficiency] = subQuestion(rule.sufficiency);
      questions[subQuestionIds.violation] = subQuestion(rule.violation);
      ruleViews.push({ ruleId: rule.id, summary: rule.summary, subQuestionIds });
    }
    requests.push({
      questionId: question.id,
      questionIndex,
      state,
      questions,
      rules: ruleViews,
      requestDigest: digestOf({ model, state, questions }),
    });
  });
  return requests;
}

interface Classification {
  observations: ScreeningObservation[];
  diagnostics: Diagnostic[];
  usage?: { inputTokens?: number; outputTokens?: number };
}

function classifyResponse(
  request: ScreeningRequest,
  response: Json,
  pack: ScreeningPack,
  policy: ScreeningPolicy,
): Classification {
  const expectedIds = request.rules.flatMap(rule => [
    rule.subQuestionIds.applicability,
    rule.subQuestionIds.sufficiency,
    rule.subQuestionIds.violation,
  ]);
  const envelope = parseSystemOneResponse(response, expectedIds);
  if (!envelope.ok) {
    const problems = envelope.issues.map(issue => `${issue.path} ${issue.message}`);
    return {
      observations: request.rules.map(rule => ({
        questionId: request.questionId,
        ruleId: rule.ruleId,
        status: "malformed" as const,
        problems,
      })),
      diagnostics: [],
    };
  }
  const observations: ScreeningObservation[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const rule of request.rules) {
    const parsed = {
      applicability: parseNoulAnswer(envelope.value.answers[rule.subQuestionIds.applicability]),
      sufficiency: parseNoulAnswer(envelope.value.answers[rule.subQuestionIds.sufficiency]),
      violation: parseNoulAnswer(envelope.value.answers[rule.subQuestionIds.violation]),
    };
    const failed = Object.entries(parsed).filter(entry => !entry[1].ok);
    if (failed.length > 0) {
      const problems = failed.flatMap(([dimension, result]) => result.ok
        ? []
        : result.issues.map(issue => `${dimension}${issue.path} ${issue.message}`));
      observations.push({ questionId: request.questionId, ruleId: rule.ruleId, status: "malformed", problems });
      continue;
    }
    const applicability = parsed.applicability.ok ? parsed.applicability.value.noul : 0;
    const sufficiency = parsed.sufficiency.ok ? parsed.sufficiency.value.noul : 0;
    const violation = parsed.violation.ok ? parsed.violation.value.noul : 0;
    const probabilities = { applicability, sufficiency, violation };
    if (applicability < policy.applicabilityAtLeast) {
      observations.push({ questionId: request.questionId, ruleId: rule.ruleId, status: "not_applicable", ...probabilities });
      continue;
    }
    if (sufficiency < policy.sufficiencyAtLeast) {
      observations.push({ questionId: request.questionId, ruleId: rule.ruleId, status: "inconclusive", ...probabilities });
      continue;
    }
    if (violation >= policy.signalAtLeast) {
      observations.push({ questionId: request.questionId, ruleId: rule.ruleId, status: "signal", ...probabilities });
      const definition = pack.rules.find(candidate => candidate.id === rule.ruleId);
      diagnostics.push({
        ruleId: rule.ruleId,
        questionId: request.questionId,
        severity: "warning",
        basis: "model_signal",
        message: definition?.message ?? rule.summary,
        locations: [{ pointer: `/questions/${request.questionIndex}${definition?.evidencePath ?? "/instructions"}` }],
        evidence: [
          { kind: "model_response", runId: request.requestDigest, answerId: rule.subQuestionIds.applicability, modelProbability: applicability },
          { kind: "model_response", runId: request.requestDigest, answerId: rule.subQuestionIds.sufficiency, modelProbability: sufficiency },
          { kind: "model_response", runId: request.requestDigest, answerId: rule.subQuestionIds.violation, modelProbability: violation },
        ],
      });
      continue;
    }
    observations.push({ questionId: request.questionId, ruleId: rule.ruleId, status: "no_signal", ...probabilities });
  }
  return { observations, diagnostics, usage: envelope.value.usage };
}

function assembleReport(input: {
  suite: QuestionSuite;
  requests: ScreeningRequest[];
  observations: ScreeningObservation[];
  diagnostics: Diagnostic[];
  version: string;
  policy: ScreeningPolicy;
  provider: ScreeningReport["provider"];
  model?: string;
  usage?: ScreeningUsage;
  extraNotExecuted?: string[];
}): ScreeningReport {
  const { suite, requests, observations, diagnostics, version, policy, provider, model, usage, extraNotExecuted } = input;
  const count = (status: ScreeningObservation["status"]): number => observations.filter(observation => observation.status === status).length;
  const withoutDigest = {
    schemaVersion: "0.1" as const,
    kind: "qlint.screening-report" as const,
    tool: { name: "qlint" as const, version },
    provider,
    ...(model === undefined ? {} : { model }),
    ...(usage === undefined ? {} : { usage }),
    suite: { id: suite.id, digest: digestOf(suite) },
    policy,
    observations,
    diagnostics,
    summary: {
      questions: suite.questions.length,
      requests: requests.length,
      signals: count("signal"),
      inconclusive: count("inconclusive"),
      notRun: count("not_run"),
      malformed: count("malformed"),
      backendErrors: count("backend_error"),
    },
    notExecuted: [
      ...(extraNotExecuted ?? []),
      "threshold calibration",
      "policy excerpts (policyRefs values are not sent, only their descriptors)",
      "suite statistics",
    ],
  };
  return { ...withoutDigest, digest: digestOf(withoutDigest) };
}

export function screeningReportDigest(report: ScreeningReport): string {
  const { digest: _digest, ...rest } = report;
  return digestOf(rest);
}

export function screenFromRecordings(
  suite: QuestionSuite,
  pack: ScreeningPack,
  recordings: RecordedResponse[],
  version: string,
  policy: ScreeningPolicy = SCREENING_POLICY,
): ScreeningReport {
  const requests = buildScreeningRequests(suite, pack);
  const byDigest = new Map<string, Json>();
  for (const recording of recordings) {
    if (byDigest.has(recording.requestDigest)) {
      throw new ScreeningError(`duplicate recorded response for ${recording.requestDigest}`);
    }
    byDigest.set(recording.requestDigest, recording.response);
  }

  const observations: ScreeningObservation[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const request of requests) {
    const response = byDigest.get(request.requestDigest);
    if (response === undefined) {
      for (const rule of request.rules) {
        observations.push({ questionId: request.questionId, ruleId: rule.ruleId, status: "not_run" });
      }
      continue;
    }
    const classified = classifyResponse(request, response, pack, policy);
    observations.push(...classified.observations);
    diagnostics.push(...classified.diagnostics);
  }
  return assembleReport({
    suite, requests, observations, diagnostics, version, policy, provider: "replay",
    extraNotExecuted: ["provider execution (replay only; no network)"],
  });
}

export interface LiveScreeningOptions {
  policy?: ScreeningPolicy;
  /** Requests beyond the budget are recorded as not_run. */
  maxRequests?: number;
  /** Overrides the pack's model name; the request digest binds the model. */
  model?: string;
  onRecord?: (recording: RecordedResponse) => void;
}

export interface LiveScreeningFailure {
  requestDigest: string;
  questionId: string;
  failure: BackendFailure;
}

export interface LiveScreeningOutcome {
  report: ScreeningReport;
  failures: LiveScreeningFailure[];
}

export async function screenLive(
  suite: QuestionSuite,
  pack: ScreeningPack,
  transport: SystemOneTransport,
  version: string,
  options: LiveScreeningOptions = {},
): Promise<LiveScreeningOutcome> {
  const policy = options.policy ?? SCREENING_POLICY;
  const effectivePack = options.model === undefined ? pack : { ...pack, model: options.model };
  const requests = buildScreeningRequests(suite, effectivePack);
  const model = effectivePack.model ?? "jev-latest";
  const budget = options.maxRequests ?? requests.length;

  const observations: ScreeningObservation[] = [];
  const diagnostics: Diagnostic[] = [];
  const failures: LiveScreeningFailure[] = [];
  let requestsSent = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let latencyMs = 0;

  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index]!;
    if (index >= budget) {
      for (const rule of request.rules) {
        observations.push({ questionId: request.questionId, ruleId: rule.ruleId, status: "not_run" });
      }
      continue;
    }
    requestsSent += 1;
    const result = await transport.send({
      model,
      state: request.state,
      questions: request.questions as unknown as Record<string, Json>,
    });
    latencyMs += result.latencyMs;
    if (!result.ok) {
      failures.push({ requestDigest: request.requestDigest, questionId: request.questionId, failure: result.failure });
      for (const rule of request.rules) {
        observations.push({
          questionId: request.questionId,
          ruleId: rule.ruleId,
          status: "backend_error",
          problems: [`${result.failure.kind}: ${result.failure.message}`],
        });
      }
      continue;
    }
    options.onRecord?.({ requestDigest: request.requestDigest, response: result.response });
    const classified = classifyResponse(request, result.response, effectivePack, policy);
    observations.push(...classified.observations);
    diagnostics.push(...classified.diagnostics);
    inputTokens += classified.usage?.inputTokens ?? 0;
    outputTokens += classified.usage?.outputTokens ?? 0;
  }

  const budgetNote = budget < requests.length
    ? `budget: ${budget} of ${requests.length} requests executed; the rest are not_run`
    : undefined;
  const report = assembleReport({
    suite,
    requests,
    observations,
    diagnostics,
    version,
    policy,
    provider: "typesafe",
    model,
    usage: { requests: requestsSent, inputTokens, outputTokens, latencyMs },
    extraNotExecuted: [
      "provider execution: live requests were sent to the TypeSafe endpoint",
      ...(budgetNote === undefined ? [] : [budgetNote]),
    ],
  });
  return { report, failures };
}
