/**
 * Writes evaluation/cases.jsonl from the human-authored definitions.
 * Deterministic: running twice produces identical bytes.
 */
import { writeFileSync } from "node:fs";
import { corpus, corpusSummary } from "./case-definitions.mjs";

const lines = corpus.map(item => JSON.stringify(item));
writeFileSync(new URL("cases.jsonl", import.meta.url), lines.join("\n") + "\n");
console.log(`wrote evaluation/cases.jsonl (${corpusSummary.total} cases: ${corpusSummary.defect} defect, ${corpusSummary.legitimate} legitimate; ${corpusSummary.tuning} tuning, ${corpusSummary.eval} eval)`);
