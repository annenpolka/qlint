/**
 * Validates the evaluation corpus offline:
 * counts, splits, unique ids, lint-clean suites, and that the expected rule
 * actually applies to the case's question. No model calls.
 *
 * Exported as validateCases() for tests; also runnable directly.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createSchemaValidators, loadSchemaSync } from "../dist/schema-validation.js";
import { lintSuiteSource } from "../dist/lint-suite.js";
import { ruleApplies } from "../dist/screening.js";

const root = new URL("../", import.meta.url);
const validators = createSchemaValidators({
  suite: loadSchemaSync(new URL("schemas/question-suite.schema.json", root)),
  diagnostic: loadSchemaSync(new URL("schemas/diagnostic.schema.json", root)),
  executionPlan: loadSchemaSync(new URL("schemas/execution-plan.schema.json", root)),
});
const catalog = JSON.parse(readFileSync(new URL("rules/catalog.json", root), "utf8"));
const pack = JSON.parse(readFileSync(new URL("rules/screening-pack.json", root), "utf8"));
const familyRule = new Map(pack.rules.map(rule => [rule.id, rule]));

export function validateCases(cases) {
  const problems = [];
  const check = (condition, message) => {
    if (!condition) problems.push(message);
  };

  check(cases.length === 80, `expected 80 cases, found ${cases.length}`);
  const defect = cases.filter(item => item.kind === "defect");
  const legitimate = cases.filter(item => item.kind === "legitimate");
  check(defect.length === 55, `expected 55 defect cases, found ${defect.length}`);
  check(legitimate.length === 25, `expected 25 legitimate cases, found ${legitimate.length}`);
  check(cases.filter(item => item.split === "tuning").length === 30, "expected 30 tuning cases");
  check(cases.filter(item => item.split === "eval").length === 30, "expected 30 eval cases");
  check(cases.filter(item => item.split === "eval2").length === 20, "expected 20 eval2 cases");

  const ids = new Set();
  for (const item of cases) {
    check(typeof item.caseId === "string" && item.caseId !== "", "caseId must be a non-empty string");
    check(!ids.has(item.caseId), `duplicate caseId ${item.caseId}`);
    ids.add(item.caseId);
    check(["ja", "en"].includes(item.language), `${item.caseId}: language must be ja or en`);
    check(["tuning", "eval", "eval2"].includes(item.split), `${item.caseId}: split must be tuning, eval, or eval2`);
    check(["QSM001", "QSM002", "QSM003", "QSM004", "QBE004"].includes(item.family), `${item.caseId}: unknown family ${item.family}`);
    check(typeof item.groupId === "string" && item.groupId !== "", `${item.caseId}: groupId is required`);

    if (item.kind === "defect") {
      check(item.expected.status === "signal", `${item.caseId}: defect expects signal`);
      check(Array.isArray(item.expected.rules) && item.expected.rules.includes(item.family), `${item.caseId}: expected rules must name the family`);
      check(/^\/questions\/0\/(instructions|output)$/.test(item.expected.evidencePointer), `${item.caseId}: evidencePointer must target instructions or output`);
      const rule = familyRule.get(item.family);
      check(rule !== undefined, `${item.caseId}: family has no screening rule`);
      if (rule) check(ruleApplies(rule, item.suite.questions[0]), `${item.caseId}: expected rule ${item.family} does not apply to this question`);
    } else {
      check(item.expected.status === "no_signal", `${item.caseId}: legitimate expects no_signal`);
      check(item.expected.rules.length === 0, `${item.caseId}: legitimate expects no rules`);
    }

    const source = JSON.stringify(item.suite);
    const lint = lintSuiteSource({
      source,
      file: `${item.caseId}.json`,
      catalogRuleIds: catalog.rules.map(rule => rule.id),
      validators,
      version: "corpus-check",
    });
    check(lint.summary.errors === 0, `${item.caseId}: suite has lint errors: ${lint.diagnostics.map(d => d.message).join("; ")}`);
  }
  return problems;
}

export function loadCases() {
  const text = readFileSync(new URL("cases.jsonl", import.meta.url), "utf8");
  return text.split("\n").filter(line => line.trim() !== "").map(line => JSON.parse(line));
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const problems = validateCases(loadCases());
  if (problems.length > 0) {
    for (const problem of problems) console.error(`case validation: ${problem}`);
    process.exitCode = 1;
  } else {
    console.log("evaluation corpus: 80 cases valid (55 defect / 25 legitimate; 30 tuning / 30 eval / 20 eval2)");
  }
}
