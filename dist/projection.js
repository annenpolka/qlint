import { digestOf } from "./digest.js";
export function decodePointerSegment(segment) {
    return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}
export function resolvePointer(state, pointer) {
    const segments = pointer.split("/").slice(1).map(decodePointerSegment);
    let current = state;
    for (const segment of segments) {
        if (Array.isArray(current)) {
            if (!/^(?:0|[1-9]\d*)$/.test(segment))
                return { found: false };
            const index = Number(segment);
            if (index >= current.length)
                return { found: false };
            current = current[index];
            continue;
        }
        if (typeof current === "object" && current !== null) {
            const record = current;
            if (!(segment in record))
                return { found: false };
            current = record[segment];
            continue;
        }
        return { found: false };
    }
    return { found: true, value: current };
}
export function matchesDeclaredType(value, valueType) {
    switch (valueType) {
        case "string": return typeof value === "string";
        case "number": return typeof value === "number";
        case "integer": return typeof value === "number" && Number.isInteger(value);
        case "boolean": return typeof value === "boolean";
        case "array": return Array.isArray(value);
        case "object": return typeof value === "object" && value !== null && !Array.isArray(value);
    }
}
export function projectQuestion(question, state) {
    const inputs = {};
    const policyRefs = {};
    const missing = [];
    const nulls = [];
    const problems = [];
    const collect = (projections, target) => {
        for (const projection of projections) {
            // The plan type and schema already exclude targets. Widening the role
            // here is deliberate defense in depth for unvalidated hand-made plans.
            const role = projection.role;
            if (role === "target") {
                problems.push({
                    fieldId: projection.fieldId,
                    kind: "target_role",
                    message: `${projection.fieldId} is an evaluation target and must not be projected`,
                });
                continue;
            }
            const resolved = resolvePointer(state, projection.pointer);
            if (!resolved.found) {
                missing.push(projection.fieldId);
                continue;
            }
            if (resolved.value === null) {
                if (projection.nullable) {
                    target[projection.fieldId] = null;
                }
                else {
                    nulls.push(projection.fieldId);
                }
                continue;
            }
            if (!matchesDeclaredType(resolved.value, projection.valueType)) {
                problems.push({
                    fieldId: projection.fieldId,
                    kind: "type_mismatch",
                    message: `${projection.fieldId} has a value that is not ${projection.valueType}`,
                });
                continue;
            }
            target[projection.fieldId] = resolved.value;
        }
    };
    collect(question.inputs, inputs);
    collect(question.policyRefs, policyRefs);
    if (problems.length > 0)
        return { status: "invalid", problems };
    if (missing.length > 0)
        return { status: "abstained", reason: "missing_input", fieldIds: missing };
    if (nulls.length > 0)
        return { status: "abstained", reason: "null_value", fieldIds: nulls };
    const payload = {
        questionId: question.questionId,
        atStage: question.atStage,
        inputs,
        policyRefs,
    };
    return { status: "projected", payload, requestDigest: digestOf(payload) };
}
