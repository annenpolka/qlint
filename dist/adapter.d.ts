/**
 * Provider adapter: validates raw System One answers and turns them into
 * contract Measurements.
 *
 * The rules are deliberately strict. A malformed answer is reported with every
 * violated expectation and is never silently repaired: no renormalization, no
 * filling missing candidates, no reading probabilities out of free text. The
 * accepted shapes follow the TypeSafe HTTP API reference for `POST
 * /v1/systemone` (Noul, Choice, Score) as of 2026-09-18.
 */
import type { Measurement } from "./contracts.js";
export interface AdapterIssue {
    path: string;
    message: string;
}
export type AdapterResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    issues: AdapterIssue[];
};
/** Distributions must sum to 1 within this tolerance; outside it, the answer is malformed. */
export declare const DISTRIBUTION_SUM_TOLERANCE = 0.000001;
export interface NoulAnswerValue {
    type: "noul";
    noul: number;
}
export declare function parseNoulAnswer(answer: unknown): AdapterResult<NoulAnswerValue>;
export interface ChoiceAnswerValue {
    type: "choice";
    choice: string;
    probabilities: Record<string, number>;
    confidence: number;
}
export declare function parseChoiceAnswer(answer: unknown, optionIds: string[]): AdapterResult<ChoiceAnswerValue>;
export interface ScoreAnswerValue {
    type: "score";
    score: number;
    probabilities: Record<string, number>;
    confidence: number;
}
export declare function parseScoreAnswer(answer: unknown, levelCount: number): AdapterResult<ScoreAnswerValue>;
export interface ParsedSystemOneResponse {
    model: string;
    answers: Record<string, unknown>;
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
    };
}
/** Validates the response envelope and that answers cover exactly the asked question ids. */
export declare function parseSystemOneResponse(payload: unknown, expectedQuestionIds: string[]): AdapterResult<ParsedSystemOneResponse>;
export declare function noulMeasurement(pTrue: number): Measurement;
export declare function choiceMeasurement(distribution: Record<string, number>): Measurement;
export declare function scoreMeasurement(distribution: Record<string, number>): Measurement;
