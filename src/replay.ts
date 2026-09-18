/**
 * Replay runner: executes a digest-bound plan against recorded responses.
 *
 * No network, no provider, no adapter: a result either replays a recording
 * matched by request digest, abstains at projection time, reports an invalid
 * projection, or is left not_run because no recording covers it. The report
 * is itself digest-bound so repeated runs can be compared byte for byte.
 */
import type { ExecutionPlan, Json, RecordedResponse, ReplayResult, RunReport } from "./contracts.js";
import { digestOf } from "./digest.js";
import { projectQuestion } from "./projection.js";

export interface ReplayCase {
  caseId: string;
  /** Snapshot root that field pointers resolve into. */
  state: Json;
}

export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayError";
  }
}

export function replayPlan(
  plan: ExecutionPlan,
  cases: ReplayCase[],
  recordings: RecordedResponse[],
  version: string,
): RunReport {
  const byDigest = new Map<string, Json>();
  for (const recording of recordings) {
    if (byDigest.has(recording.requestDigest)) {
      throw new ReplayError(`duplicate recorded response for ${recording.requestDigest}`);
    }
    byDigest.set(recording.requestDigest, recording.response);
  }

  const results: ReplayResult[] = [];
  for (const caseInput of cases) {
    for (const question of plan.questions) {
      const outcome = projectQuestion(question, caseInput.state);
      if (outcome.status === "abstained") {
        results.push({
          caseId: caseInput.caseId,
          questionId: question.questionId,
          status: "abstained",
          reason: outcome.reason,
        });
        continue;
      }
      if (outcome.status === "invalid") {
        results.push({
          caseId: caseInput.caseId,
          questionId: question.questionId,
          status: "invalid",
          problems: outcome.problems,
        });
        continue;
      }
      const response = byDigest.get(outcome.requestDigest);
      if (response === undefined) {
        results.push({
          caseId: caseInput.caseId,
          questionId: question.questionId,
          status: "not_run",
          requestDigest: outcome.requestDigest,
          payload: outcome.payload,
          reason: "no recorded response matches this request digest",
        });
        continue;
      }
      results.push({
        caseId: caseInput.caseId,
        questionId: question.questionId,
        status: "replayed",
        requestDigest: outcome.requestDigest,
        payload: outcome.payload,
        response,
      });
    }
  }

  const count = (status: ReplayResult["status"]): number => results.filter(result => result.status === status).length;
  const withoutDigest = {
    schemaVersion: "0.1" as const,
    kind: "qlint.run-report" as const,
    mode: "replay" as const,
    tool: { name: "qlint" as const, version },
    planDigest: plan.digest,
    suite: plan.suite,
    results,
    summary: {
      cases: cases.length,
      questions: plan.questions.length,
      replayed: count("replayed"),
      abstained: count("abstained"),
      invalid: count("invalid"),
      notRun: count("not_run"),
      requestsSent: 0,
    },
    notExecuted: [
      "adapter normalization (responses stay raw)",
      "gate runtime",
      "live provider execution (network)",
    ],
  };
  return { ...withoutDigest, digest: digestOf(withoutDigest) };
}

export function runReportDigest(report: RunReport): string {
  const { digest: _digest, ...rest } = report;
  return digestOf(rest);
}
