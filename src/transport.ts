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

export type TransportResult =
  | { ok: true; response: Json; latencyMs: number }
  | { ok: false; failure: BackendFailure; latencyMs: number };

export interface SystemOneTransport {
  send(request: SystemOneRequest): Promise<TransportResult>;
}

export const DEFAULT_BASE_URL = "https://api.typesafe.ai";
export const DEFAULT_TIMEOUT_MS = 30_000;

export interface HttpTransportOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createHttpTransport(options: HttpTransportOptions): SystemOneTransport {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async send(request: SystemOneRequest): Promise<TransportResult> {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${baseUrl}/v1/systemone`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        const latencyMs = Date.now() - started;
        if (!response.ok) {
          let detail = "";
          try {
            detail = (await response.text()).slice(0, 300);
          } catch {
            // The status code is enough; never surface the key or full body.
          }
          return {
            ok: false,
            latencyMs,
            failure: {
              kind: "http",
              status: response.status,
              message: `HTTP ${response.status}${detail === "" ? "" : `: ${detail}`}`,
            },
          };
        }
        const parsed: unknown = await response.json();
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return { ok: false, latencyMs, failure: { kind: "http", status: response.status, message: "response body is not a JSON object" } };
        }
        return { ok: true, response: parsed as Json, latencyMs };
      } catch (error) {
        const latencyMs = Date.now() - started;
        if (error instanceof Error && error.name === "AbortError") {
          return { ok: false, latencyMs, failure: { kind: "timeout", message: `no response within ${timeoutMs} ms` } };
        }
        return {
          ok: false,
          latencyMs,
          failure: { kind: "network", message: error instanceof Error ? error.message : String(error) },
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
