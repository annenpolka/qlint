/**
 * Semantic screening: builds small meta-questions about each QuestionSpec and
 * turns validated Noul answers into model_signal diagnostics.
 *
 * The model never sees state values, expected diagnostics, or rule
 * thresholds: the sent state contains the question text and field descriptors
 * only. Diagnostics are assembled here from the rule pack, so a candidate
 * answer cannot change severity, rule identity, or output shape.
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
} from "./contracts.js";
import { digestOf } from "./digest.js";

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

function subQuestion(id: string, definition: { instructions: string; criteria: { true: string; false: string } }): ScreeningSubQuestion {
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
      questions[subQuestionIds.applicability] = subQuestion(subQuestionIds.applicability, rule.applicability);
      questions[subQuestionIds.sufficiency] = subQuestion(subQuestionIds.sufficiency, rule.sufficiency);
      questions[subQuestionIds.violation] = subQuestion(subQuestionIds.violation, rule.violation);
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
    const expectedIds = request.rules.flatMap(rule => [
      rule.subQuestionIds.applicability,
      rule.subQuestionIds.sufficiency,
      rule.subQuestionIds.violation,
    ]);
    const envelope = parseSystemOneResponse(response, expectedIds);
    if (!envelope.ok) {
      const problems = envelope.issues.map(issue => `${issue.path} ${issue.message}`);
      for (const rule of request.rules) {
        observations.push({ questionId: request.questionId, ruleId: rule.ruleId, status: "malformed", problems });
      }
      continue;
    }
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
          locations: [{ pointer: `/questions/${request.questionIndex}/instructions` }],
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
  }

  const count = (status: ScreeningObservation["status"]): number => observations.filter(observation => observation.status === status).length;
  const withoutDigest = {
    schemaVersion: "0.1" as const,
    kind: "qlint.screening-report" as const,
    tool: { name: "qlint" as const, version },
    provider: "replay" as const,
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
    },
    notExecuted: [
      "provider execution (replay only; no network)",
      "threshold calibration",
      "policy excerpts (policyRefs values are not sent, only their descriptors)",
      "suite statistics",
    ],
  };
  return { ...withoutDigest, digest: digestOf(withoutDigest) };
}
