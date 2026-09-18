export const DEFAULT_BASE_URL = "https://api.typesafe.ai";
export const DEFAULT_TIMEOUT_MS = 30_000;
export function createHttpTransport(options) {
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const fetchImpl = options.fetchImpl ?? fetch;
    return {
        async send(request) {
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
                    }
                    catch {
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
                const parsed = await response.json();
                if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
                    return { ok: false, latencyMs, failure: { kind: "http", status: response.status, message: "response body is not a JSON object" } };
                }
                return { ok: true, response: parsed, latencyMs };
            }
            catch (error) {
                const latencyMs = Date.now() - started;
                if (error instanceof Error && error.name === "AbortError") {
                    return { ok: false, latencyMs, failure: { kind: "timeout", message: `no response within ${timeoutMs} ms` } };
                }
                return {
                    ok: false,
                    latencyMs,
                    failure: { kind: "network", message: error instanceof Error ? error.message : String(error) },
                };
            }
            finally {
                clearTimeout(timer);
            }
        },
    };
}
