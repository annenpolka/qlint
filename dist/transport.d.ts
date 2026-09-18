/**
 * HTTP transport for the TypeSafe evaluation endpoint.
 *
 * This is the only module that performs network I/O. The API key is supplied
 * by the caller and is never logged, echoed in errors, or included in any
 * artifact. Errors are classified so that a backend failure is never
 * attributed to the question under inspection.
 *
 * Endpoint and response shapes follow https://docs.typesafe.ai/api
 * (checked 2026-09-18): POST /v1/systemone with {state, model, questions}.
 */
import type { Json } from "./contracts.js";
export interface SystemOneRequest {
    model: string;
    state: Json;
    questions: Record<string, Json>;
}
export interface BackendFailure {
    kind: "timeout" | "network" | "http";
    status?: number;
    message: string;
}
export type TransportResult = {
    ok: true;
    response: Json;
    latencyMs: number;
} | {
    ok: false;
    failure: BackendFailure;
    latencyMs: number;
};
export interface SystemOneTransport {
    send(request: SystemOneRequest): Promise<TransportResult>;
}
export declare const DEFAULT_BASE_URL = "https://api.typesafe.ai";
export declare const DEFAULT_TIMEOUT_MS = 30000;
export interface HttpTransportOptions {
    apiKey: string;
    baseUrl?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
}
export declare function createHttpTransport(options: HttpTransportOptions): SystemOneTransport;
