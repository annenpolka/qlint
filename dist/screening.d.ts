import type { QuestionSpec, QuestionSuite, RecordedResponse, ScreeningPack, ScreeningPolicy, ScreeningReport, ScreeningRequest, ScreeningRuleDefinition } from "./contracts.js";
export declare class ScreeningError extends Error {
    constructor(message: string);
}
export declare const SCREENING_POLICY: ScreeningPolicy;
export declare function ruleApplies(rule: ScreeningRuleDefinition, question: QuestionSpec): boolean;
export declare function buildScreeningRequests(suite: QuestionSuite, pack: ScreeningPack): ScreeningRequest[];
export declare function screeningReportDigest(report: ScreeningReport): string;
export declare function screenFromRecordings(suite: QuestionSuite, pack: ScreeningPack, recordings: RecordedResponse[], version: string, policy?: ScreeningPolicy): ScreeningReport;
