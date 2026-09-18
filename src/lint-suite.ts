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
import type { BackendCapabilities, CheckCoverage, Diagnostic, DiagnosticLocation, QuestionSuite } from "./contracts.js";
import type { LocationIndex } from "./locate.js";
import { buildLocationIndex, JsonScanError, positionAtOffset, tryBuildLocationIndex } from "./locate.js";
import type { SchemaValidators } from "./schema-validation.js";
import { lintValidatedSuite } from "./static-checks.js";

export const LINT_SCOPE = "static_lint_only";
export const LINT_NOTE =
  "Static lint only: semantic screening, dataset probes, metamorphic tests, fuzzing, and calibration were NOT run. A clean static lint is not semantic approval.";

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
export class InternalLintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InternalLintError";
  }
}

function syntaxLocation(error: unknown, source: string): DiagnosticLocation {
  const message = error instanceof Error ? error.message : String(error);
  const lineColumn = /\(line (\d+) column (\d+)\)/.exec(message);
  if (lineColumn) {
    return { pointer: "/", line: Number(lineColumn[1]), column: Number(lineColumn[2]) };
  }
  const position = /position (\d+)/.exec(message);
  if (position) {
    const at = positionAtOffset(source, Number(position[1]));
    return { pointer: "/", line: at.line, column: at.column };
  }
  // Some engine versions ("Unexpected end of JSON input") carry no position;
  // the scanner reports where parsing stopped.
  try {
    buildLocationIndex(source);
  } catch (error) {
    if (error instanceof JsonScanError) {
      const at = positionAtOffset(source, error.offset);
      return { pointer: "/", line: at.line, column: at.column };
    }
  }
  return { pointer: "/" };
}

function withFileLocations(diagnostic: Diagnostic, index: LocationIndex | undefined, file: string | undefined): Diagnostic {
  return {
    ...diagnostic,
    locations: diagnostic.locations.map(location => {
      const position = index?.nearest(location.pointer);
      return {
        ...location,
        ...(file === undefined ? {} : { file }),
        ...(position === undefined ? {} : { line: position.line, column: position.column }),
      };
    }),
  };
}

function schemaDiagnostic(message: string, location: DiagnosticLocation, file: string | undefined): Diagnostic {
  return {
    ruleId: "QCT001",
    severity: "error",
    basis: "static_proof",
    message,
    locations: [file === undefined ? location : { ...location, file }],
    evidence: [{ kind: "contract_ref", pointer: location.pointer }],
  };
}

function countSeverities(diagnostics: Diagnostic[]): Pick<LintSummary, "errors" | "warnings" | "infos"> {
  let errors = 0;
  let warnings = 0;
  let infos = 0;
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") errors += 1;
    else if (diagnostic.severity === "warning") warnings += 1;
    else infos += 1;
  }
  return { errors, warnings, infos };
}

export function lintSuiteSource(request: LintRequest): LintReport {
  const { source, file, capabilities, catalogRuleIds, validators, version } = request;
  const index = tryBuildLocationIndex(source);
  const diagnostics: Diagnostic[] = [];
  const statuses = new Map<string, CheckCoverage["status"]>();
  let notExecuted: string[];
  let suiteId: string | null = null;
  let schemaVersion: string | null = null;

  let parsed: unknown = undefined;
  let parseError: unknown = undefined;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    parseError = error;
  }

  if (parseError !== undefined) {
    diagnostics.push(schemaDiagnostic(`Invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`, syntaxLocation(parseError, source), file));
    statuses.set("QCT001", "flagged");
    notExecuted = [
      "cross-reference checks (QCT002-QCT009) and backend capability checks (QBE001-QBE002): the input is not valid JSON",
    ];
  } else {
    const issues = validators.suite(parsed);
    if (issues.length > 0) {
      for (const issue of issues) {
        diagnostics.push(withFileLocations(schemaDiagnostic(`Schema violation: ${issue.message}`, { pointer: issue.pointer }, file), index, file));
      }
      statuses.set("QCT001", "flagged");
      notExecuted = [
        "cross-reference checks (QCT002-QCT009) and backend capability checks (QBE001-QBE002): the input failed JSON Schema validation",
      ];
    } else {
      statuses.set("QCT001", "passed");
      const report = lintValidatedSuite(parsed as QuestionSuite, capabilities);
      for (const diagnostic of report.diagnostics) {
        diagnostics.push(withFileLocations(diagnostic, index, file));
      }
      for (const ruleId of report.executedRuleIds) statuses.set(ruleId, "passed");
      for (const diagnostic of report.diagnostics) statuses.set(diagnostic.ruleId, "flagged");
      notExecuted = report.notExecuted.filter(item => item !== "JSON Schema validation (caller responsibility)");
      if (capabilities === undefined) {
        notExecuted.push("backend capability checks (QBE001-QBE002; no capability profile provided)");
      }
      const parsedSuite = parsed as Partial<QuestionSuite>;
      if (typeof parsedSuite.id === "string") suiteId = parsedSuite.id;
      if (typeof parsedSuite.schemaVersion === "string") schemaVersion = parsedSuite.schemaVersion;
    }
  }

  const coverage: CheckCoverage[] = catalogRuleIds.map(ruleId => ({
    ruleId,
    status: statuses.get(ruleId) ?? "not_run",
  }));

  for (const diagnostic of diagnostics) {
    const issues = validators.diagnostic(diagnostic);
    if (issues.length > 0) {
      throw new InternalLintError(
        `emitted diagnostic ${diagnostic.ruleId} does not satisfy schemas/diagnostic.schema.json: ${issues.map(issue => issue.message).join("; ")}`,
      );
    }
  }

  return {
    tool: "qlint",
    version,
    scope: LINT_SCOPE,
    file: file ?? null,
    suiteId,
    schemaVersion,
    diagnostics,
    coverage,
    notExecuted,
    summary: {
      ...countSeverities(diagnostics),
      rulesChecked: coverage.filter(entry => entry.status === "passed" || entry.status === "flagged").length,
      rulesFlagged: coverage.filter(entry => entry.status === "flagged").length,
      rulesNotRun: coverage.filter(entry => entry.status === "not_run").length,
    },
    note: LINT_NOTE,
  };
}
