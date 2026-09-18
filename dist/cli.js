#!/usr/bin/env node
/**
 * qlint reference CLI — static lint only.
 *
 * Deliberately small: argument parsing, file I/O, schema loading, and
 * rendering. All checking logic lives in lint-suite.ts / static-checks.ts.
 * Exit codes follow docs/design-v0.1.md; see USAGE for the lint-specific
 * interpretation recorded in that document.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseBackendCapabilities } from "./capabilities.js";
import { InternalLintError, LINT_SCOPE, lintSuiteSource } from "./lint-suite.js";
import { createSchemaValidators, loadSchemaSync } from "./schema-validation.js";
export const USAGE = `qlint — question contract checker (reference static lint)

Usage:
  qlint lint <suite.json> [--capabilities <caps.json>] [--format text|json]
  qlint --help
  qlint --version

Exit codes:
  0  every check lint performs completed and found no violations
  1  the input violated the suite contract or the JSON Schema
  2  usage, I/O, or tool-configuration failure
  3  reserved for profile runs whose required checks were not completed (lint never uses it)

lint runs JSON Schema validation and cross-reference checks only.
Semantic screening, dataset probes, metamorphic tests, fuzzing, and calibration
are NOT run; the report lists them under "not run" and never presents a clean
static lint as semantic approval.`;
class CliError extends Error {
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function readVersion() {
    try {
        const parsed = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
        if (typeof parsed === "object" && parsed !== null && typeof parsed.version === "string") {
            return parsed.version;
        }
    }
    catch {
        // Fall through to the placeholder; the version is informative, not a check.
    }
    return "0.0.0";
}
function loadCatalogRuleIds() {
    const parsed = JSON.parse(readFileSync(new URL("../rules/catalog.json", import.meta.url), "utf8"));
    if (typeof parsed !== "object" || parsed === null)
        throw new CliError("rules/catalog.json is not a JSON object");
    const rules = parsed.rules;
    if (!Array.isArray(rules))
        throw new CliError("rules/catalog.json has no rules array");
    const ids = [];
    for (const rule of rules) {
        const id = typeof rule === "object" && rule !== null ? rule.id : undefined;
        if (typeof id !== "string")
            throw new CliError("rules/catalog.json contains a rule without a string id");
        ids.push(id);
    }
    return ids;
}
function parseArgs(argv) {
    const positionals = [];
    let capabilitiesPath;
    let format = "text";
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--help" || arg === "-h")
            return { kind: "help" };
        if (arg === "--version" || arg === "-v")
            return { kind: "version" };
        if (arg === "--capabilities") {
            const value = argv[index + 1];
            if (value === undefined)
                return { kind: "error", message: "--capabilities requires a file path" };
            capabilitiesPath = value;
            index += 1;
            continue;
        }
        if (arg === "--format") {
            const value = argv[index + 1];
            if (value !== "text" && value !== "json")
                return { kind: "error", message: '--format must be "text" or "json"' };
            format = value;
            index += 1;
            continue;
        }
        if (arg.startsWith("-"))
            return { kind: "error", message: `unknown option: ${arg}` };
        positionals.push(arg);
    }
    const command = positionals[0];
    if (command === undefined)
        return { kind: "error", message: "missing command" };
    if (command !== "lint")
        return { kind: "error", message: `unknown command: ${command}` };
    const file = positionals[1];
    if (file === undefined)
        return { kind: "error", message: "lint requires a suite file path" };
    if (positionals.length > 2)
        return { kind: "error", message: `unexpected argument: ${positionals[2]}` };
    return {
        kind: "lint",
        options: { file, ...(capabilitiesPath === undefined ? {} : { capabilitiesPath }), format },
    };
}
function readCapabilities(path) {
    let source;
    try {
        source = readFileSync(path, "utf8");
    }
    catch (error) {
        throw new CliError(`cannot read capabilities file ${path}: ${errorMessage(error)}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(source);
    }
    catch (error) {
        throw new CliError(`capabilities file ${path} is not valid JSON: ${errorMessage(error)}`);
    }
    try {
        return parseBackendCapabilities(parsed);
    }
    catch (error) {
        throw new CliError(`capabilities file ${path}: ${errorMessage(error)}`);
    }
}
function renderText(report) {
    const lines = [];
    lines.push(`qlint ${report.version} — ${LINT_SCOPE} (schema + cross-reference checks; no network)`);
    if (report.file !== null)
        lines.push(`file: ${report.file}`);
    if (report.suiteId !== null) {
        const versionSuffix = report.schemaVersion === null ? "" : ` (schemaVersion ${report.schemaVersion})`;
        lines.push(`suite: ${report.suiteId}${versionSuffix}`);
    }
    const { errors, warnings, infos } = report.summary;
    lines.push(errors === 0 && warnings === 0 && infos === 0
        ? "result: no violations in the checks that ran"
        : `result: ${errors} error(s), ${warnings} warning(s), ${infos} info`);
    for (const diagnostic of report.diagnostics) {
        const location = diagnostic.locations[0];
        const place = location?.line === undefined
            ? report.file ?? "<input>"
            : `${location.file ?? report.file ?? "<input>"}:${location.line}:${location.column ?? 1}`;
        lines.push(`${place}  ${diagnostic.severity}  ${diagnostic.ruleId}  ${location?.pointer ?? "/"}`);
        lines.push(`    ${diagnostic.message}`);
    }
    const count = (status) => report.coverage.filter(entry => entry.status === status).length;
    lines.push(`coverage: ${count("passed")} passed, ${count("flagged")} flagged, ${count("not_run")} not run (${report.coverage.length} catalog rules)`);
    for (const item of report.notExecuted)
        lines.push(`not run: ${item}`);
    lines.push(`note: ${report.note}`);
    return lines.join("\n") + "\n";
}
export function run(argv, streams) {
    const parsedArgs = parseArgs(argv);
    if (parsedArgs.kind === "help") {
        streams.stdout(USAGE + "\n");
        return 0;
    }
    if (parsedArgs.kind === "version") {
        streams.stdout(readVersion() + "\n");
        return 0;
    }
    if (parsedArgs.kind === "error") {
        streams.stderr(`qlint: ${parsedArgs.message}\n\n${USAGE}\n`);
        return 2;
    }
    const { file, capabilitiesPath, format } = parsedArgs.options;
    try {
        const capabilities = capabilitiesPath === undefined ? undefined : readCapabilities(capabilitiesPath);
        let source;
        try {
            source = readFileSync(file, "utf8");
        }
        catch (error) {
            throw new CliError(`cannot read ${file}: ${errorMessage(error)}`);
        }
        const validators = createSchemaValidators({
            suite: loadSchemaSync(new URL("../schemas/question-suite.schema.json", import.meta.url)),
            diagnostic: loadSchemaSync(new URL("../schemas/diagnostic.schema.json", import.meta.url)),
        });
        const report = lintSuiteSource({
            source,
            file,
            ...(capabilities === undefined ? {} : { capabilities }),
            catalogRuleIds: loadCatalogRuleIds(),
            validators,
            version: readVersion(),
        });
        streams.stdout(format === "json" ? JSON.stringify(report, null, 2) + "\n" : renderText(report));
        return report.summary.errors > 0 ? 1 : 0;
    }
    catch (error) {
        if (error instanceof CliError || error instanceof InternalLintError) {
            streams.stderr(`qlint: ${errorMessage(error)}\n`);
            return 2;
        }
        streams.stderr(`qlint: unexpected failure: ${errorMessage(error)}\n`);
        return 2;
    }
}
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
    process.exitCode = run(process.argv.slice(2), {
        stdout: text => process.stdout.write(text),
        stderr: text => process.stderr.write(text),
    });
}
