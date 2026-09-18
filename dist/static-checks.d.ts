import type { QuestionSuite, StaticReport, BackendCapabilities } from "./contracts.js";
/**
 * Cross-reference checks ONLY. Validate unknown JSON against the shipped schema
 * before calling. A clean report is not a semantic approval or a schema check.
 * No model requests, filesystem access, environment variables, or side effects.
 */
export declare function lintValidatedSuite(suite: QuestionSuite, capabilities?: BackendCapabilities): StaticReport;
