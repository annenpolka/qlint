import { digestOf } from "./digest.js";
import { projectQuestion } from "./projection.js";
export class ReplayError extends Error {
    constructor(message) {
        super(message);
        this.name = "ReplayError";
    }
}
export function replayPlan(plan, cases, recordings, version) {
    const byDigest = new Map();
    for (const recording of recordings) {
        if (byDigest.has(recording.requestDigest)) {
            throw new ReplayError(`duplicate recorded response for ${recording.requestDigest}`);
        }
        byDigest.set(recording.requestDigest, recording.response);
    }
    const results = [];
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
    const count = (status) => results.filter(result => result.status === status).length;
    const withoutDigest = {
        schemaVersion: "0.1",
        kind: "qlint.run-report",
        mode: "replay",
        tool: { name: "qlint", version },
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
export function runReportDigest(report) {
    const { digest: _digest, ...rest } = report;
    return digestOf(rest);
}
