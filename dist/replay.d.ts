/**
 * Replay runner: executes a digest-bound plan against recorded responses.
 *
 * No network, no provider, no adapter: a result either replays a recording
 * matched by request digest, abstains at projection time, reports an invalid
 * projection, or is left not_run because no recording covers it. The report
 * is itself digest-bound so repeated runs can be compared byte for byte.
 */
import type { ExecutionPlan, Json, RecordedResponse, RunReport } from "./contracts.js";
export interface ReplayCase {
    caseId: string;
    /** Snapshot root that field pointers resolve into. */
    state: Json;
}
export declare class ReplayError extends Error {
    constructor(message: string);
}
export declare function replayPlan(plan: ExecutionPlan, cases: ReplayCase[], recordings: RecordedResponse[], version: string): RunReport;
export declare function runReportDigest(report: RunReport): string;
