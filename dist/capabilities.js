const KINDS = new Set(["boolean", "categorical", "ordinal"]);
const FIELDS = new Set([
    "kinds",
    "nativeDistribution",
    "nativeAbstention",
    "maxCategoricalOptions",
    "maxOrdinalLevels",
    "questionIdsVisibleToModel",
    "siblingLevelDescriptionsVisible",
]);
function requireBoolean(source, key) {
    const value = source[key];
    if (typeof value !== "boolean")
        throw new Error(`capabilities.${key} must be a boolean`);
    return value;
}
function optionalBoolean(source, key) {
    const value = source[key];
    if (value === undefined)
        return undefined;
    if (typeof value !== "boolean")
        throw new Error(`capabilities.${key} must be a boolean when present`);
    return value;
}
function optionalPositiveInteger(source, key) {
    const value = source[key];
    if (value === undefined)
        return undefined;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
        throw new Error(`capabilities.${key} must be a positive integer when present`);
    }
    return value;
}
export function parseBackendCapabilities(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("backend capabilities must be a JSON object");
    }
    const source = value;
    for (const key of Object.keys(source)) {
        if (!FIELDS.has(key))
            throw new Error(`unknown backend capabilities field: ${key}`);
    }
    if (!Array.isArray(source.kinds) || !source.kinds.every(kind => typeof kind === "string" && KINDS.has(kind))) {
        throw new Error('capabilities.kinds must be an array of "boolean" | "categorical" | "ordinal"');
    }
    const capabilities = {
        kinds: [...source.kinds],
        nativeDistribution: requireBoolean(source, "nativeDistribution"),
        nativeAbstention: requireBoolean(source, "nativeAbstention"),
    };
    const maxCategoricalOptions = optionalPositiveInteger(source, "maxCategoricalOptions");
    if (maxCategoricalOptions !== undefined)
        capabilities.maxCategoricalOptions = maxCategoricalOptions;
    const maxOrdinalLevels = optionalPositiveInteger(source, "maxOrdinalLevels");
    if (maxOrdinalLevels !== undefined)
        capabilities.maxOrdinalLevels = maxOrdinalLevels;
    const questionIdsVisibleToModel = optionalBoolean(source, "questionIdsVisibleToModel");
    if (questionIdsVisibleToModel !== undefined)
        capabilities.questionIdsVisibleToModel = questionIdsVisibleToModel;
    const siblingLevelDescriptionsVisible = optionalBoolean(source, "siblingLevelDescriptionsVisible");
    if (siblingLevelDescriptionsVisible !== undefined) {
        capabilities.siblingLevelDescriptionsVisible = siblingLevelDescriptionsVisible;
    }
    return capabilities;
}
