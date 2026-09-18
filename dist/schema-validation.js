/**
 * JSON Schema validation at the input boundary.
 *
 * Unknown JSON must pass through these validators before it is treated as a
 * QuestionSuite. The validators are pure functions over the schemas given to
 * them; reading the schema files is the caller's responsibility.
 */
import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
function escapeSegment(segment) {
    return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
function issuePointer(error) {
    const base = error.instancePath ?? "";
    const params = error.params;
    if (error.keyword === "required" && typeof params.missingProperty === "string") {
        return `${base}/${escapeSegment(params.missingProperty)}`;
    }
    if (error.keyword === "additionalProperties" && typeof params.additionalProperty === "string") {
        return `${base}/${escapeSegment(params.additionalProperty)}`;
    }
    return base === "" ? "/" : base;
}
function toIssues(errors) {
    if (!errors)
        return [];
    const seen = new Set();
    const issues = [];
    for (const error of errors) {
        const pointer = issuePointer(error);
        const message = error.message ?? "schema violation";
        const key = `${pointer}\u0000${error.keyword}\u0000${message}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        issues.push({ keyword: error.keyword, pointer, message });
    }
    return issues;
}
/**
 * Compiles the shipped schemas (Draft 2020-12). `strict` is off because the
 * schemas use patterns such as `required` inside `not` that Ajv otherwise
 * reports as strict-mode warnings; the schemas are the reviewed source of truth.
 */
export function createSchemaValidators(sources) {
    const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
    const suite = ajv.compile(sources.suite);
    const diagnostic = ajv.compile(sources.diagnostic);
    return {
        suite: data => toIssues(suite(data) ? null : suite.errors),
        diagnostic: data => toIssues(diagnostic(data) ? null : diagnostic.errors),
    };
}
/** Reads a schema file. Boundary function: filesystem access is not hidden in the validators. */
export function loadSchemaSync(path) {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error(`schema at ${String(path)} is not a JSON object`);
    }
    return parsed;
}
