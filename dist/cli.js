#!/usr/bin/env node
/**
 * qlint reference CLI — static lint (Stage 1) plus inspect/run (Stage 2).
 *
 * Deliberately small: argument parsing, file I/O, schema loading, and
 * rendering. Checking logic lives in lint-suite.ts / static-checks.ts,
 * planning in plan.ts, projection in projection.ts, replay in replay.ts.
 * Exit codes follow docs/design-v0.1.md; see USAGE.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseBackendCapabilities } from "./capabilities.js";
import { InternalLintError, LINT_SCOPE, lintSuiteSource } from "./lint-suite.js";
import { buildScreeningRequests, screenFromRecordings, ScreeningError } from "./screening.js";
import { buildPlan, PlanError, planDigest } from "./plan.js";
import { ReplayError, replayPlan, runReportDigest } from "./replay.js";
import { createSchemaValidators, loadSchemaSync } from "./schema-validation.js";
export const USAGE = `qlint — question contract checker (reference implementation)

Usage:
  qlint lint <suite.json> [--capabilities <caps.json>] [--format text|json]
  qlint inspect <suite.json> [--out <plan.json>] [--format text|json]
                 [--max-requests N] [--max-bytes N] [--max-tokens N] [--allow-restricted]
  qlint run <plan.json> --cases <cases.jsonl> --replay <recorded.jsonl>
             [--out <report.json>] [--format text|json]
  qlint screen <suite.json> (--replay <recorded.jsonl> | --dry-run)
              [--out <report.json>] [--format text|json] [--fail-on-signal]
  qlint --help
  qlint --version

Exit codes:
  0  every check the command performs completed and found no violations
  1  the input violated the suite contract or the JSON Schema
  2  usage, I/O, plan, or tool-configuration failure (including digest mismatch)
  3  run could not complete for lack of recorded evidence (results left not_run)

lint runs JSON Schema validation and cross-reference checks only.
Semantic screening, dataset probes, metamorphic tests, fuzzing, and calibration
are NOT run; the report lists them under "not run" and never presents a clean
static lint as semantic approval.
inspect writes a digest-bound execution plan; it never contacts a provider.
run executes a plan against recorded responses only; live providers are not
implemented in this bundle.
screen asks the semantic screening meta-questions over recorded Jev responses
(or prints them with --dry-run). Signals are model_signal diagnostics; without
--fail-on-signal they do not fail the command.`;
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
        // The version is informative, not a check.
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
function loadValidators() {
    return createSchemaValidators({
        suite: loadSchemaSync(new URL("../schemas/question-suite.schema.json", import.meta.url)),
        diagnostic: loadSchemaSync(new URL("../schemas/diagnostic.schema.json", import.meta.url)),
        executionPlan: loadSchemaSync(new URL("../schemas/execution-plan.schema.json", import.meta.url)),
    });
}
const VALUE_FLAGS = new Set([
    "--out", "--format", "--capabilities", "--max-requests", "--max-bytes", "--max-tokens",
    "--cases", "--replay", "--allow-provider",
]);
const BOOLEAN_FLAGS = new Set(["--help", "-h", "--version", "-v", "--allow-restricted", "--dry-run", "--fail-on-signal"]);
function parseArgv(argv) {
    const flags = new Map();
    const booleans = new Set();
    const positionals = [];
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (BOOLEAN_FLAGS.has(arg)) {
            booleans.add(arg);
            continue;
        }
        if (VALUE_FLAGS.has(arg)) {
            const value = argv[index + 1];
            if (value === undefined || value.startsWith("--"))
                return { error: `${arg} requires a value` };
            flags.set(arg, value);
            index += 1;
            continue;
        }
        if (arg.startsWith("-"))
            return { error: `unknown option: ${arg}` };
        positionals.push(arg);
    }
    return { flags, booleans, positionals };
}
function checkFlags(parsed, allowedFlags, allowedBooleans) {
    for (const flag of parsed.flags.keys()) {
        if (!allowedFlags.includes(flag))
            return `${flag} is not valid for ${parsed.positionals[0] ?? "this command"}`;
    }
    for (const flag of parsed.booleans) {
        if (flag === "--help" || flag === "-h" || flag === "--version" || flag === "-v")
            continue;
        if (!allowedBooleans.includes(flag))
            return `${flag} is not valid for ${parsed.positionals[0] ?? "this command"}`;
    }
    return undefined;
}
function parseFormat(parsed) {
    const value = parsed.flags.get("--format");
    if (value === undefined)
        return "text";
    if (value !== "text" && value !== "json")
        return '--format must be "text" or "json"';
    return value;
}
function positiveInteger(parsed, flag) {
    const value = parsed.flags.get(flag);
    if (value === undefined)
        return undefined;
    if (!/^[1-9]\d*$/.test(value))
        return `${flag} must be a positive integer`;
    return Number(value);
}
function parseArgs(argv) {
    const parsed = parseArgv(argv);
    if ("error" in parsed)
        return { kind: "error", message: parsed.error };
    if (parsed.booleans.has("--help") || parsed.booleans.has("-h"))
        return { kind: "help" };
    if (parsed.booleans.has("--version") || parsed.booleans.has("-v"))
        return { kind: "version" };
    const [commandName, file, extra] = parsed.positionals;
    if (commandName === undefined)
        return { kind: "error", message: "missing command" };
    if (file === undefined)
        return { kind: "error", message: `${commandName} requires a file path` };
    if (extra !== undefined)
        return { kind: "error", message: `unexpected argument: ${extra}` };
    if (commandName === "lint") {
        const flagError = checkFlags(parsed, ["--format", "--capabilities"], []);
        if (flagError)
            return { kind: "error", message: flagError };
        const format = parseFormat(parsed);
        if (format !== "text" && format !== "json")
            return { kind: "error", message: format };
        const capabilitiesPath = parsed.flags.get("--capabilities");
        return { kind: "lint", file, ...(capabilitiesPath === undefined ? {} : { capabilitiesPath }), format };
    }
    if (commandName === "inspect") {
        const flagError = checkFlags(parsed, ["--out", "--format", "--max-requests", "--max-bytes", "--max-tokens"], ["--allow-restricted"]);
        if (flagError)
            return { kind: "error", message: flagError };
        const format = parseFormat(parsed);
        if (format !== "text" && format !== "json")
            return { kind: "error", message: format };
        const maxRequests = positiveInteger(parsed, "--max-requests");
        const maxBytes = positiveInteger(parsed, "--max-bytes");
        const maxTokens = positiveInteger(parsed, "--max-tokens");
        for (const value of [maxRequests, maxBytes, maxTokens]) {
            if (typeof value === "string")
                return { kind: "error", message: value };
        }
        const out = parsed.flags.get("--out");
        return {
            kind: "inspect",
            file,
            format,
            allowRestricted: parsed.booleans.has("--allow-restricted"),
            ...(out === undefined ? {} : { out }),
            ...(typeof maxRequests === "number" ? { maxRequests } : {}),
            ...(typeof maxBytes === "number" ? { maxBytes } : {}),
            ...(typeof maxTokens === "number" ? { maxTokens } : {}),
        };
    }
    if (commandName === "run") {
        const flagError = checkFlags(parsed, ["--out", "--format", "--cases", "--replay", "--allow-provider"], []);
        if (flagError)
            return { kind: "error", message: flagError };
        if (parsed.flags.has("--allow-provider")) {
            return { kind: "error", message: "live providers are not implemented in this bundle; use --replay <recorded.jsonl>" };
        }
        const format = parseFormat(parsed);
        if (format !== "text" && format !== "json")
            return { kind: "error", message: format };
        const casesPath = parsed.flags.get("--cases");
        const replayPath = parsed.flags.get("--replay");
        if (casesPath === undefined)
            return { kind: "error", message: "run requires --cases <cases.jsonl>" };
        if (replayPath === undefined)
            return { kind: "error", message: "run requires --replay <recorded.jsonl>" };
        const out = parsed.flags.get("--out");
        return { kind: "run", planPath: file, casesPath, replayPath, format, ...(out === undefined ? {} : { out }) };
    }
    if (commandName === "screen") {
        const flagError = checkFlags(parsed, ["--out", "--format", "--replay"], ["--dry-run", "--fail-on-signal"]);
        if (flagError)
            return { kind: "error", message: flagError };
        const format = parseFormat(parsed);
        if (format !== "text" && format !== "json")
            return { kind: "error", message: format };
        const replayPath = parsed.flags.get("--replay");
        const dryRun = parsed.booleans.has("--dry-run");
        if (replayPath === undefined && !dryRun) {
            return { kind: "error", message: "screen requires --replay <recorded.jsonl> (or --dry-run)" };
        }
        const out = parsed.flags.get("--out");
        return {
            kind: "screen",
            file,
            format,
            dryRun,
            failOnSignal: parsed.booleans.has("--fail-on-signal"),
            ...(replayPath === undefined ? {} : { replayPath }),
            ...(out === undefined ? {} : { out }),
        };
    }
    return { kind: "error", message: `unknown command: ${commandName}` };
}
function readText(path, what) {
    try {
        return readFileSync(path, "utf8");
    }
    catch (error) {
        throw new CliError(`cannot read ${what} ${String(path)}: ${errorMessage(error)}`);
    }
}
function readJson(path, what) {
    const source = readText(path, what);
    try {
        return JSON.parse(source);
    }
    catch (error) {
        throw new CliError(`${what} ${String(path)} is not valid JSON: ${errorMessage(error)}`);
    }
}
function loadScreeningPack() {
    const parsed = readJson(new URL("../rules/screening-pack.json", import.meta.url), "screening pack");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new CliError("rules/screening-pack.json is not a JSON object");
    }
    const pack = parsed;
    if (!Array.isArray(pack.rules) || pack.rules.length === 0) {
        throw new CliError("rules/screening-pack.json has no rules");
    }
    for (const rule of pack.rules) {
        const complete = typeof rule.id === "string"
            && typeof rule.summary === "string"
            && typeof rule.message === "string"
            && typeof rule.applicability?.instructions === "string"
            && typeof rule.sufficiency?.instructions === "string"
            && typeof rule.violation?.instructions === "string";
        if (!complete)
            throw new CliError(`rules/screening-pack.json rule ${String(rule.id)} is incomplete`);
    }
    return pack;
}
function readCapabilities(path) {
    const parsed = readJson(path, "capabilities file");
    try {
        return parseBackendCapabilities(parsed);
    }
    catch (error) {
        throw new CliError(`capabilities file ${path}: ${errorMessage(error)}`);
    }
}
function parseJsonLines(source, what, parseLine) {
    source.split("\n").forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed === "")
            return;
        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        }
        catch (error) {
            throw new CliError(`${what} line ${index + 1} is not valid JSON: ${errorMessage(error)}`);
        }
        parseLine(parsed, index + 1);
    });
}
function readCases(path) {
    const cases = [];
    parseJsonLines(readText(path, "cases file"), "cases file", (value, line) => {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            throw new CliError(`cases file line ${line} must be a JSON object`);
        }
        const record = value;
        if (typeof record.caseId !== "string" || record.caseId === "") {
            throw new CliError(`cases file line ${line} needs a non-empty string caseId`);
        }
        if (!("state" in record))
            throw new CliError(`cases file line ${line} needs a state value`);
        cases.push({ caseId: record.caseId, state: record.state });
    });
    if (cases.length === 0)
        throw new CliError("cases file contains no cases");
    return cases;
}
function readRecordings(path) {
    const recordings = [];
    parseJsonLines(readText(path, "recorded responses file"), "recorded responses file", (value, line) => {
        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            throw new CliError(`recorded responses file line ${line} must be a JSON object`);
        }
        const record = value;
        if (typeof record.requestDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(record.requestDigest)) {
            throw new CliError(`recorded responses file line ${line} needs a sha256 requestDigest`);
        }
        if (!("response" in record))
            throw new CliError(`recorded responses file line ${line} needs a response`);
        recordings.push({ requestDigest: record.requestDigest, response: record.response });
    });
    return recordings;
}
function renderLintText(report) {
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
function renderPlanText(plan, outPath) {
    const lines = [];
    lines.push(`qlint ${plan.tool.version} — execution plan (provider: ${plan.provider.name}; network: ${plan.provider.network ? "yes" : "no"})`);
    lines.push(`suite: ${plan.suite.id} (${plan.suite.digest})`);
    lines.push(`requests: ${plan.requestCount} (maxRequests ${plan.maxRequests})`);
    lines.push(`redaction: ${plan.questions[0]?.redaction.policy ?? "explicit-projection-v0.1"}`);
    for (const question of plan.questions) {
        lines.push(`  ${question.questionId} @ ${question.atStage} [${question.profile}, ${question.mode}, ${question.outputKind}]`);
        lines.push(`    inputs: ${question.inputs.map(field => field.fieldId).join(", ") || "(none)"}`);
        lines.push(`    policyRefs: ${question.policyRefs.map(field => field.fieldId).join(", ") || "(none)"}`);
        lines.push(`    excluded: ${question.redaction.excludedFieldIds.join(", ") || "(none)"}`);
        lines.push(`    restricted: ${question.redaction.restrictedFieldIds.join(", ") || "none"}`);
        lines.push(`    limits: ${question.limits.rationale}`);
    }
    for (const note of plan.notes)
        lines.push(`note: ${note}`);
    lines.push(`plan digest: ${plan.digest}`);
    if (outPath !== undefined)
        lines.push(`written: ${outPath}`);
    return lines.join("\n") + "\n";
}
function renderRunText(report) {
    const lines = [];
    lines.push(`qlint ${report.tool.version} — run (mode: ${report.mode}; provider: replay; network: no)`);
    lines.push(`plan: ${report.planDigest}`);
    lines.push(`suite: ${report.suite.id} (${report.suite.digest})`);
    lines.push(`cases: ${report.summary.cases}, questions: ${report.summary.questions}`);
    lines.push(`results: ${report.summary.replayed} replayed, ${report.summary.abstained} abstained, ${report.summary.invalid} invalid, ${report.summary.notRun} not run`);
    for (const result of report.results) {
        if (result.status === "replayed")
            continue;
        lines.push(`  ${result.caseId} ${result.questionId} ${result.status}${result.reason === undefined ? "" : `: ${result.reason}`}`);
    }
    for (const item of report.notExecuted)
        lines.push(`not run: ${item}`);
    lines.push(`report digest: ${report.digest}`);
    return lines.join("\n") + "\n";
}
function exitCodeForRun(report) {
    if (report.summary.invalid > 0)
        return 1;
    if (report.summary.notRun > 0)
        return 3;
    return 0;
}
function renderScreeningRequestsText(requests) {
    const lines = [];
    lines.push("qlint — semantic screening requests (dry run; nothing is sent)");
    lines.push(`requests: ${requests.length} (one per question)`);
    for (const request of requests) {
        lines.push(`  ${request.questionId}: ${request.rules.map(rule => rule.ruleId).join(", ")}`);
        lines.push(`    digest: ${request.requestDigest}`);
    }
    lines.push("note: thresholds are uncalibrated reference defaults and are recorded in the screening report.");
    lines.push("note: state contains the question text and field descriptors only; no field values, labels, or expected diagnostics.");
    return lines.join("\n") + "\n";
}
function renderScreeningText(report) {
    const lines = [];
    lines.push(`qlint ${report.tool.version} — screening (provider: ${report.provider}; network: no)`);
    lines.push(`suite: ${report.suite.id} (${report.suite.digest})`);
    lines.push(`policy: ${report.policy.policyId} (applicability>=${report.policy.applicabilityAtLeast}, sufficiency>=${report.policy.sufficiencyAtLeast}, signal>=${report.policy.signalAtLeast})`);
    lines.push(`requests: ${report.summary.requests}`);
    lines.push(`observations: ${report.summary.signals} signals, ${report.summary.inconclusive} inconclusive, ${report.summary.notRun} not run, ${report.summary.malformed} malformed`);
    for (const observation of report.observations) {
        if (observation.status === "no_signal")
            continue;
        const probabilities = [
            observation.applicability === undefined ? undefined : `a=${observation.applicability}`,
            observation.sufficiency === undefined ? undefined : `s=${observation.sufficiency}`,
            observation.violation === undefined ? undefined : `v=${observation.violation}`,
        ].filter((value) => value !== undefined).join(" ");
        lines.push(`  ${observation.questionId} ${observation.ruleId} ${observation.status}${probabilities === "" ? "" : ` (${probabilities})`}`);
    }
    for (const diagnostic of report.diagnostics) {
        const location = diagnostic.locations[0];
        lines.push(`  ${report.suite.id}${location?.pointer ?? "/"}  warning  ${diagnostic.ruleId}  ${diagnostic.message}`);
    }
    for (const item of report.notExecuted)
        lines.push(`not run: ${item}`);
    lines.push(`report digest: ${report.digest}`);
    return lines.join("\n") + "\n";
}
function exitCodeForScreening(report, failOnSignal) {
    if (report.summary.malformed > 0)
        return 2;
    if (failOnSignal && report.diagnostics.length > 0)
        return 1;
    if (report.summary.notRun > 0)
        return 3;
    return 0;
}
export function run(argv, streams) {
    const command = parseArgs(argv);
    if (command.kind === "help") {
        streams.stdout(USAGE + "\n");
        return 0;
    }
    if (command.kind === "version") {
        streams.stdout(readVersion() + "\n");
        return 0;
    }
    if (command.kind === "error") {
        streams.stderr(`qlint: ${command.message}\n\n${USAGE}\n`);
        return 2;
    }
    try {
        if (command.kind === "lint") {
            const capabilities = command.capabilitiesPath === undefined ? undefined : readCapabilities(command.capabilitiesPath);
            const source = readText(command.file, "suite file");
            const report = lintSuiteSource({
                source,
                file: command.file,
                ...(capabilities === undefined ? {} : { capabilities }),
                catalogRuleIds: loadCatalogRuleIds(),
                validators: loadValidators(),
                version: readVersion(),
            });
            streams.stdout(command.format === "json" ? JSON.stringify(report, null, 2) + "\n" : renderLintText(report));
            return report.summary.errors > 0 ? 1 : 0;
        }
        if (command.kind === "inspect") {
            const validators = loadValidators();
            const source = readText(command.file, "suite file");
            const lint = lintSuiteSource({
                source,
                file: command.file,
                catalogRuleIds: loadCatalogRuleIds(),
                validators,
                version: readVersion(),
            });
            if (lint.summary.errors > 0) {
                streams.stdout(command.format === "json" ? JSON.stringify(lint, null, 2) + "\n" : renderLintText(lint));
                return 1;
            }
            const plan = buildPlan(JSON.parse(source), {
                version: readVersion(),
                ...(command.maxRequests === undefined ? {} : { maxRequests: command.maxRequests }),
                ...(command.maxBytes === undefined ? {} : { maxBytes: command.maxBytes }),
                ...(command.maxTokens === undefined ? {} : { maxTokens: command.maxTokens }),
                ...(command.allowRestricted ? { allowRestricted: true } : {}),
            });
            const issues = validators.executionPlan(plan);
            if (issues.length > 0) {
                throw new InternalLintError(`generated plan does not satisfy schemas/execution-plan.schema.json: ${issues.map(issue => issue.message).join("; ")}`);
            }
            if (command.out !== undefined) {
                writeFileSync(command.out, JSON.stringify(plan, null, 2) + "\n");
            }
            streams.stdout(command.format === "json" ? JSON.stringify(plan, null, 2) + "\n" : renderPlanText(plan, command.out));
            return 0;
        }
        if (command.kind === "screen") {
            const validators = loadValidators();
            const source = readText(command.file, "suite file");
            const lint = lintSuiteSource({
                source,
                file: command.file,
                catalogRuleIds: loadCatalogRuleIds(),
                validators,
                version: readVersion(),
            });
            if (lint.summary.errors > 0) {
                streams.stdout(command.format === "json" ? JSON.stringify(lint, null, 2) + "\n" : renderLintText(lint));
                return 1;
            }
            const suite = JSON.parse(source);
            const pack = loadScreeningPack();
            if (command.dryRun) {
                const requests = buildScreeningRequests(suite, pack);
                streams.stdout(command.format === "json"
                    ? JSON.stringify({ provider: "replay", requests }, null, 2) + "\n"
                    : renderScreeningRequestsText(requests));
                return 0;
            }
            if (command.replayPath === undefined)
                throw new CliError("screen requires --replay <recorded.jsonl>");
            const recordings = readRecordings(command.replayPath);
            const report = screenFromRecordings(suite, pack, recordings, readVersion());
            for (const diagnostic of report.diagnostics) {
                const issues = validators.diagnostic(diagnostic);
                if (issues.length > 0) {
                    throw new InternalLintError(`emitted diagnostic ${diagnostic.ruleId} does not satisfy schemas/diagnostic.schema.json: ${issues.map(issue => issue.message).join("; ")}`);
                }
            }
            if (command.out !== undefined) {
                writeFileSync(command.out, JSON.stringify(report, null, 2) + "\n");
            }
            streams.stdout(command.format === "json" ? JSON.stringify(report, null, 2) + "\n" : renderScreeningText(report));
            return exitCodeForScreening(report, command.failOnSignal);
        }
        // command.kind === "run"
        const validators = loadValidators();
        const plan = readJson(command.planPath, "plan file");
        const planIssues = validators.executionPlan(plan);
        if (planIssues.length > 0) {
            throw new CliError(`plan ${command.planPath} is not a valid execution plan: ${planIssues.map(issue => `${issue.pointer} ${issue.message}`).join("; ")}`);
        }
        if (plan.digest !== planDigest(plan)) {
            throw new CliError(`plan digest mismatch: file has ${plan.digest}, content computes ${planDigest(plan)}`);
        }
        const cases = readCases(command.casesPath);
        const recordings = readRecordings(command.replayPath);
        const report = replayPlan(plan, cases, recordings, readVersion());
        if (report.digest !== runReportDigest(report)) {
            throw new InternalLintError("replay report digest does not match its content");
        }
        if (command.out !== undefined) {
            writeFileSync(command.out, JSON.stringify(report, null, 2) + "\n");
        }
        streams.stdout(command.format === "json" ? JSON.stringify(report, null, 2) + "\n" : renderRunText(report));
        return exitCodeForRun(report);
    }
    catch (error) {
        if (error instanceof CliError || error instanceof InternalLintError || error instanceof PlanError
            || error instanceof ReplayError || error instanceof ScreeningError) {
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
