/**
 * Execution-plan construction (`qlint inspect`).
 *
 * The plan fixes exactly which state fields each question may send, keeps
 * policy references separate from evidence inputs, records redaction and
 * limits with their basis, and binds the whole content to a digest so
 * `qlint run` can detect edits. Pure: the caller supplies the suite.
 */
import type { ExecutionPlan, QuestionSuite } from "./contracts.js";
export declare class PlanError extends Error {
    constructor(message: string);
}
export interface PlanOptions {
    version: string;
    maxRequests?: number;
    maxBytes?: number;
    maxTokens?: number;
    allowRestricted?: boolean;
}
export declare function buildPlan(suite: QuestionSuite, options: PlanOptions): ExecutionPlan;
export declare function planDigest(plan: ExecutionPlan): string;
export declare function verifyPlanDigest(plan: ExecutionPlan): boolean;
