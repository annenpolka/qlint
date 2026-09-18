/**
 * Static lint orchestration for a single QuestionSuite document.
 *
 * Order matters and is part of the contract: JSON parse, then JSON Schema,
 * then cross-reference checks. Cross-reference checks are never run over
 * input that failed schema validation, and checks that did not run are
 * reported as `not_run`, never as a pass.
 *
 * Pure: the caller supplies the source text, the capabilities profile, the
 * rule-ID catalog, and compiled validators. No filesystem or network access.
 */
import type { BackendCapabilities, CheckCoverage, Diagnostic } from "./contracts.js";
import type { SchemaValidators } from "./schema-validation.js";
export declare const LINT_SCOPE = "static_lint_only";
export declare const LINT_NOTE = "Static lint only: semantic screening, dataset probes, metamorphic tests, fuzzing, and calibration were NOT run. A clean static lint is not semantic approval.";
export interface LintSummary {
    errors: number;
    warnings: number;
    infos: number;
    rulesChecked: number;
    rulesFlagged: number;
    rulesNotRun: number;
}
export interface LintReport {
    tool: "qlint";
    version: string;
    scope: typeof LINT_SCOPE;
    file: string | null;
    suiteId: string | null;
    schemaVersion: string | null;
    diagnostics: Diagnostic[];
    coverage: CheckCoverage[];
    notExecuted: string[];
    summary: LintSummary;
    note: string;
}
export interface LintRequest {
    source: string;
    /** Path shown in diagnostics; omit for in-memory use. */
    file?: string;
    capabilities?: BackendCapabilities;
    /** Every rule ID from rules/catalog.json, in catalog order. */
    catalogRuleIds: string[];
    validators: SchemaValidators;
    version: string;
}
/** Raised when the linter contradicts its own Diagnostic contract; a tool bug, not a user error. */
export declare class InternalLintError extends Error {
    constructor(message: string);
}
export declare function lintSuiteSource(request: LintRequest): LintReport;
