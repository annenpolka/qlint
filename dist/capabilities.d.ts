/**
 * Parsing for the backend capability profile passed to static checks.
 *
 * Capabilities come from the user, not from a model. Malformed capabilities
 * are a tool-configuration failure (CLI exit 2), never a defect of the input
 * suite, so this module throws instead of producing diagnostics.
 */
import type { BackendCapabilities } from "./contracts.js";
export declare function parseBackendCapabilities(value: unknown): BackendCapabilities;
