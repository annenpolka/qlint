/**
 * Projection of one case snapshot onto one planned question.
 *
 * This is the last boundary before a payload could reach a model, so it
 * treats the plan as authoritative: only listed fields are read, policy
 * references stay separate from evidence inputs, missing and null values
 * become abstention (never an implicit false), and type violations stop the
 * request instead of being smoothed over.
 *
 * Pure: no filesystem, network, or environment access.
 */
import type { FieldSpec, Json, PlanQuestion, ProjectionOutcome } from "./contracts.js";
export declare function decodePointerSegment(segment: string): string;
export declare function resolvePointer(state: Json, pointer: string): {
    found: true;
    value: Json;
} | {
    found: false;
};
export declare function matchesDeclaredType(value: Json, valueType: FieldSpec["valueType"]): boolean;
export declare function projectQuestion(question: PlanQuestion, state: Json): ProjectionOutcome;
