import type { QuestionSpec, QuestionSuite, RecordedResponse, ScreeningPack, ScreeningPolicy, ScreeningReport, ScreeningRequest, ScreeningRuleDefinition } from "./contracts.js";
import type { BackendFailure, SystemOneTransport } from "./transport.js";
export declare class ScreeningError extends Error {
    constructor(message: string);
}
export declare const SCREENING_POLICY: ScreeningPolicy;
export declare function ruleApplies(rule: ScreeningRuleDefinition, question: QuestionSpec): boolean;
export declare function buildScreeningRequests(suite: QuestionSuite, pack: ScreeningPack): ScreeningRequest[];
export declare function screeningReportDigest(report: ScreeningReport): string;
export declare function screenFromRecordings(suite: QuestionSuite, pack: ScreeningPack, recordings: RecordedResponse[], version: string, policy?: ScreeningPolicy): ScreeningReport;
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
export declare function screenLive(suite: QuestionSuite, pack: ScreeningPack, transport: SystemOneTransport, version: string, options?: LiveScreeningOptions): Promise<LiveScreeningOutcome>;
