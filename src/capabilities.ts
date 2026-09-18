/**
 * Parsing for the backend capability profile passed to static checks.
 *
 * Capabilities come from the user, not from a model. Malformed capabilities
 * are a tool-configuration failure (CLI exit 2), never a defect of the input
 * suite, so this module throws instead of producing diagnostics.
 */
import type { BackendCapabilities, OutputSpec } from "./contracts.js";

const KINDS: ReadonlySet<string> = new Set(["boolean", "categorical", "ordinal"]);
const FIELDS = new Set([
  "kinds",
  "nativeDistribution",
  "nativeAbstention",
  "maxCategoricalOptions",
  "maxOrdinalLevels",
  "questionIdsVisibleToModel",
  "siblingLevelDescriptionsVisible",
]);

function requireBoolean(source: Record<string, unknown>, key: string): boolean {
  const value = source[key];
  if (typeof value !== "boolean") throw new Error(`capabilities.${key} must be a boolean`);
  return value;
}

function optionalBoolean(source: Record<string, unknown>, key: string): boolean | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`capabilities.${key} must be a boolean when present`);
  return value;
}

function optionalPositiveInteger(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`capabilities.${key} must be a positive integer when present`);
  }
  return value;
}

export function parseBackendCapabilities(value: unknown): BackendCapabilities {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("backend capabilities must be a JSON object");
  }
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!FIELDS.has(key)) throw new Error(`unknown backend capabilities field: ${key}`);
  }
  if (!Array.isArray(source.kinds) || !source.kinds.every(kind => typeof kind === "string" && KINDS.has(kind))) {
    throw new Error('capabilities.kinds must be an array of "boolean" | "categorical" | "ordinal"');
  }
  const capabilities: BackendCapabilities = {
    kinds: [...source.kinds] as OutputSpec["kind"][],
    nativeDistribution: requireBoolean(source, "nativeDistribution"),
    nativeAbstention: requireBoolean(source, "nativeAbstention"),
  };
  const maxCategoricalOptions = optionalPositiveInteger(source, "maxCategoricalOptions");
  if (maxCategoricalOptions !== undefined) capabilities.maxCategoricalOptions = maxCategoricalOptions;
  const maxOrdinalLevels = optionalPositiveInteger(source, "maxOrdinalLevels");
  if (maxOrdinalLevels !== undefined) capabilities.maxOrdinalLevels = maxOrdinalLevels;
  const questionIdsVisibleToModel = optionalBoolean(source, "questionIdsVisibleToModel");
  if (questionIdsVisibleToModel !== undefined) capabilities.questionIdsVisibleToModel = questionIdsVisibleToModel;
  const siblingLevelDescriptionsVisible = optionalBoolean(source, "siblingLevelDescriptionsVisible");
  if (siblingLevelDescriptionsVisible !== undefined) {
    capabilities.siblingLevelDescriptionsVisible = siblingLevelDescriptionsVisible;
  }
  return capabilities;
}
