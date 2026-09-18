/**
 * Canonical JSON and content digests.
 *
 * Digests must be reproducible across runs and machines: object keys are
 * sorted lexicographically, arrays keep their order, and only JSON values
 * are accepted. No timestamps or environment data enter a digest.
 */
import { createHash } from "node:crypto";

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("canonicalJson accepts only finite numbers");
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map(item => canonicalJson(item)).join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      const entries = keys.map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
      return `{${entries.join(",")}}`;
    }
    default:
      throw new TypeError(`canonicalJson does not accept ${typeof value}`);
  }
}

export function digestOf(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}
