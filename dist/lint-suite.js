import { buildLocationIndex, JsonScanError, positionAtOffset, tryBuildLocationIndex } from "./locate.js";
import { lintValidatedSuite } from "./static-checks.js";
export const LINT_SCOPE = "static_lint_only";
export const LINT_NOTE = "Static lint only: semantic screening, dataset probes, metamorphic tests, fuzzing, and calibration were NOT run. A clean static lint is not semantic approval.";
/** Raised when the linter contradicts its own Diagnostic contract; a tool bug, not a user error. */
export class InternalLintError extends Error {
    constructor(message) {
        super(message);
        this.name = "InternalLintError";
    }
}
function syntaxLocation(error, source) {
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
    }
    catch (error) {
        if (error instanceof JsonScanError) {
            const at = positionAtOffset(source, error.offset);
            return { pointer: "/", line: at.line, column: at.column };
        }
    }
    return { pointer: "/" };
}
function withFileLocations(diagnostic, index, file) {
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
function schemaDiagnostic(message, location, file) {
    return {
        ruleId: "QCT001",
        severity: "error",
        basis: "static_proof",
        message,
        locations: [file === undefined ? location : { ...location, file }],
        evidence: [{ kind: "contract_ref", pointer: location.pointer }],
    };
}
function countSeverities(diagnostics) {
    let errors = 0;
    let warnings = 0;
    let infos = 0;
    for (const diagnostic of diagnostics) {
        if (diagnostic.severity === "error")
            errors += 1;
        else if (diagnostic.severity === "warning")
            warnings += 1;
        else
            infos += 1;
    }
    return { errors, warnings, infos };
}
export function lintSuiteSource(request) {
    const { source, file, capabilities, catalogRuleIds, validators, version } = request;
    const index = tryBuildLocationIndex(source);
    const diagnostics = [];
    const statuses = new Map();
    let notExecuted;
    let suiteId = null;
    let schemaVersion = null;
    let parsed = undefined;
    let parseError = undefined;
    try {
        parsed = JSON.parse(source);
    }
    catch (error) {
        parseError = error;
    }
    if (parseError !== undefined) {
        diagnostics.push(schemaDiagnostic(`Invalid JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`, syntaxLocation(parseError, source), file));
        statuses.set("QCT001", "flagged");
        notExecuted = [
            "cross-reference checks (QCT002-QCT009) and backend capability checks (QBE001-QBE002): the input is not valid JSON",
        ];
    }
    else {
        const issues = validators.suite(parsed);
        if (issues.length > 0) {
            for (const issue of issues) {
                diagnostics.push(withFileLocations(schemaDiagnostic(`Schema violation: ${issue.message}`, { pointer: issue.pointer }, file), index, file));
            }
            statuses.set("QCT001", "flagged");
            notExecuted = [
                "cross-reference checks (QCT002-QCT009) and backend capability checks (QBE001-QBE002): the input failed JSON Schema validation",
            ];
        }
        else {
            statuses.set("QCT001", "passed");
            const report = lintValidatedSuite(parsed, capabilities);
            for (const diagnostic of report.diagnostics) {
                diagnostics.push(withFileLocations(diagnostic, index, file));
            }
            for (const ruleId of report.executedRuleIds)
                statuses.set(ruleId, "passed");
            for (const diagnostic of report.diagnostics)
                statuses.set(diagnostic.ruleId, "flagged");
            notExecuted = report.notExecuted.filter(item => item !== "JSON Schema validation (caller responsibility)");
            if (capabilities === undefined) {
                notExecuted.push("backend capability checks (QBE001-QBE002; no capability profile provided)");
            }
            const parsedSuite = parsed;
            if (typeof parsedSuite.id === "string")
                suiteId = parsedSuite.id;
            if (typeof parsedSuite.schemaVersion === "string")
                schemaVersion = parsedSuite.schemaVersion;
        }
    }
    const coverage = catalogRuleIds.map(ruleId => ({
        ruleId,
        status: statuses.get(ruleId) ?? "not_run",
    }));
    for (const diagnostic of diagnostics) {
        const issues = validators.diagnostic(diagnostic);
        if (issues.length > 0) {
            throw new InternalLintError(`emitted diagnostic ${diagnostic.ruleId} does not satisfy schemas/diagnostic.schema.json: ${issues.map(issue => issue.message).join("; ")}`);
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
