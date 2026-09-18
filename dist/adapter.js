/** Distributions must sum to 1 within this tolerance; outside it, the answer is malformed. */
export const DISTRIBUTION_SUM_TOLERANCE = 1e-6;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}
function probability(value) {
    return finiteNumber(value) && value >= 0 && value <= 1;
}
function unexpectedFields(record, allowed, path) {
    const issues = [];
    for (const key of Object.keys(record)) {
        if (!allowed.includes(key)) {
            issues.push({ path: `${path}/${key}`, message: "unexpected field in a model answer" });
        }
    }
    return issues;
}
function checkDistribution(raw, expectedKeys, path) {
    const issues = [];
    if (!isRecord(raw)) {
        return { issues: [{ path, message: "probabilities must be an object" }], distribution: {} };
    }
    const distribution = {};
    for (const key of expectedKeys) {
        if (!(key in raw))
            issues.push({ path: `${path}/${key}`, message: "missing candidate in the returned distribution" });
    }
    for (const [key, value] of Object.entries(raw)) {
        if (!expectedKeys.includes(key)) {
            issues.push({ path: `${path}/${key}`, message: "candidate was not offered in the request" });
            continue;
        }
        if (!probability(value)) {
            issues.push({ path: `${path}/${key}`, message: "probability must be finite and between 0 and 1" });
            continue;
        }
        distribution[key] = value;
    }
    const sum = Object.values(distribution).reduce((total, value) => total + value, 0);
    if (Object.keys(distribution).length === expectedKeys.length && Math.abs(sum - 1) > DISTRIBUTION_SUM_TOLERANCE) {
        issues.push({
            path,
            message: `probabilities must sum to 1 within ${DISTRIBUTION_SUM_TOLERANCE}; got ${sum}`,
        });
    }
    return { issues, distribution };
}
export function parseNoulAnswer(answer) {
    if (!isRecord(answer))
        return { ok: false, issues: [{ path: "/", message: "answer must be an object" }] };
    const issues = unexpectedFields(answer, ["type", "noul"], "");
    if (answer.type !== "noul")
        issues.push({ path: "/type", message: 'answer type must be "noul"' });
    if (!probability(answer.noul))
        issues.push({ path: "/noul", message: "noul must be a finite probability between 0 and 1" });
    if (issues.length > 0)
        return { ok: false, issues };
    return { ok: true, value: { type: "noul", noul: answer.noul } };
}
export function parseChoiceAnswer(answer, optionIds) {
    if (!isRecord(answer))
        return { ok: false, issues: [{ path: "/", message: "answer must be an object" }] };
    const issues = unexpectedFields(answer, ["type", "choice", "probabilities", "confidence"], "");
    if (answer.type !== "choice")
        issues.push({ path: "/type", message: 'answer type must be "choice"' });
    const { issues: distributionIssues, distribution } = checkDistribution(answer.probabilities, optionIds, "/probabilities");
    issues.push(...distributionIssues);
    if (typeof answer.choice !== "string" || !optionIds.includes(answer.choice)) {
        issues.push({ path: "/choice", message: "choice must name one of the offered options" });
    }
    else {
        const top = Math.max(...Object.values(distribution));
        if ((distribution[answer.choice] ?? 0) + 1e-9 < top) {
            issues.push({ path: "/choice", message: "choice is not the highest-probability option" });
        }
    }
    if (!probability(answer.confidence))
        issues.push({ path: "/confidence", message: "confidence must be a finite probability between 0 and 1" });
    if (issues.length > 0)
        return { ok: false, issues };
    return {
        ok: true,
        value: {
            type: "choice",
            choice: answer.choice,
            probabilities: distribution,
            confidence: answer.confidence,
        },
    };
}
export function parseScoreAnswer(answer, levelCount) {
    if (!isRecord(answer))
        return { ok: false, issues: [{ path: "/", message: "answer must be an object" }] };
    const levelKeys = Array.from({ length: levelCount }, (_unused, index) => String(index));
    const issues = unexpectedFields(answer, ["type", "score", "legend", "probabilities", "confidence"], "");
    if (answer.type !== "score")
        issues.push({ path: "/type", message: 'answer type must be "score"' });
    const { issues: distributionIssues, distribution } = checkDistribution(answer.probabilities, levelKeys, "/probabilities");
    issues.push(...distributionIssues);
    const legend = answer.legend;
    if (!isRecord(legend) || levelKeys.some(key => !(key in legend))) {
        issues.push({ path: "/legend", message: "legend must map every level number to its description" });
    }
    if (!finiteNumber(answer.score)) {
        issues.push({ path: "/score", message: "score must be a finite number" });
    }
    else if (Object.keys(distribution).length === levelCount) {
        const weighted = levelKeys.reduce((total, key) => total + Number(key) * (distribution[key] ?? 0), 0);
        if (Math.abs(answer.score - weighted) > DISTRIBUTION_SUM_TOLERANCE) {
            issues.push({ path: "/score", message: `score ${answer.score} does not match its own probability-weighted mean ${weighted}` });
        }
    }
    if (!probability(answer.confidence))
        issues.push({ path: "/confidence", message: "confidence must be a finite probability between 0 and 1" });
    if (issues.length > 0)
        return { ok: false, issues };
    return {
        ok: true,
        value: {
            type: "score",
            score: answer.score,
            probabilities: distribution,
            confidence: answer.confidence,
        },
    };
}
/** Validates the response envelope and that answers cover exactly the asked question ids. */
export function parseSystemOneResponse(payload, expectedQuestionIds) {
    if (!isRecord(payload))
        return { ok: false, issues: [{ path: "/", message: "response must be an object" }] };
    const issues = unexpectedFields(payload, ["model", "answers", "usage"], "");
    if (typeof payload.model !== "string" || payload.model === "") {
        issues.push({ path: "/model", message: "response must name the model" });
    }
    if (!isRecord(payload.answers)) {
        issues.push({ path: "/answers", message: "answers must be an object" });
        return { ok: false, issues };
    }
    for (const id of expectedQuestionIds) {
        if (!(id in payload.answers))
            issues.push({ path: `/answers/${id}`, message: "answer is missing for an asked question" });
    }
    for (const key of Object.keys(payload.answers)) {
        if (!expectedQuestionIds.includes(key)) {
            issues.push({ path: `/answers/${key}`, message: "answer was returned for a question that was not asked" });
        }
    }
    if (issues.length > 0)
        return { ok: false, issues };
    const usage = {};
    if (isRecord(payload.usage)) {
        if (finiteNumber(payload.usage.input_tokens))
            usage.inputTokens = payload.usage.input_tokens;
        if (finiteNumber(payload.usage.output_tokens))
            usage.outputTokens = payload.usage.output_tokens;
    }
    return {
        ok: true,
        value: { model: payload.model, answers: payload.answers, usage },
    };
}
export function noulMeasurement(pTrue) {
    return { kind: "boolean", representation: "distribution", pTrue, probabilitySource: "model_distribution" };
}
export function choiceMeasurement(distribution) {
    return { kind: "categorical", representation: "distribution", distribution, probabilitySource: "model_distribution" };
}
export function scoreMeasurement(distribution) {
    return { kind: "ordinal", representation: "distribution", distribution, probabilitySource: "model_distribution" };
}
