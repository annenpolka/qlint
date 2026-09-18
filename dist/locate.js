/**
 * Maps JSON Pointers to positions in the original JSON text.
 *
 * Used after JSON.parse has already accepted the document, to attach
 * 1-based line/column numbers to diagnostics. This module never decides
 * whether a document is valid, and it is pure: no filesystem, network, or
 * environment access, no mutation of its input.
 */
/** Position of a UTF-16 offset in the source; 1-based line and column. */
export function positionAtOffset(source, offset) {
    const clamped = Math.max(0, Math.min(offset, source.length));
    let line = 1;
    let lineStart = 0;
    for (let i = 0; i < clamped; i += 1) {
        if (source.charCodeAt(i) === 10) {
            line += 1;
            lineStart = i + 1;
        }
    }
    return { offset: clamped, line, column: clamped - lineStart + 1 };
}
export class JsonScanError extends Error {
    offset;
    constructor(message, offset) {
        super(message);
        this.name = "JsonScanError";
        this.offset = offset;
    }
}
const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);
const SCALAR = /(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/y;
function escapeSegment(segment) {
    return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
/** Reads one JSON string starting at the opening quote. */
function decodeString(source, start) {
    let i = start + 1;
    let value = "";
    for (;;) {
        if (i >= source.length)
            throw new JsonScanError("Unterminated string", start);
        const ch = source[i];
        if (ch === '"')
            return { value, end: i + 1 };
        if (ch !== "\\") {
            value += ch;
            i += 1;
            continue;
        }
        i += 1;
        if (i >= source.length)
            throw new JsonScanError("Unterminated escape", i);
        const esc = source[i];
        switch (esc) {
            case '"':
                value += '"';
                break;
            case "\\":
                value += "\\";
                break;
            case "/":
                value += "/";
                break;
            case "b":
                value += "\b";
                break;
            case "f":
                value += "\f";
                break;
            case "n":
                value += "\n";
                break;
            case "r":
                value += "\r";
                break;
            case "t":
                value += "\t";
                break;
            case "u": {
                const hex = source.slice(i + 1, i + 5);
                if (!/^[0-9a-fA-F]{4}$/.test(hex))
                    throw new JsonScanError("Invalid \\u escape", i);
                value += String.fromCharCode(Number.parseInt(hex, 16));
                i += 4;
                break;
            }
            default:
                throw new JsonScanError(`Invalid escape \\${esc}`, i);
        }
        i += 1;
    }
}
/**
 * Scans JSON text and records the first position of every value.
 * Duplicate object keys keep the first position; JSON.parse keeps the last,
 * so a duplicate-key diagnostic may point at the earlier occurrence.
 */
export function buildLocationIndex(source) {
    const lineStarts = [0];
    for (let i = 0; i < source.length; i += 1) {
        if (source.charCodeAt(i) === 10)
            lineStarts.push(i + 1);
    }
    const positionAt = (offset) => {
        let low = 0;
        let high = lineStarts.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (lineStarts[mid] <= offset)
                low = mid;
            else
                high = mid - 1;
        }
        return { offset, line: low + 1, column: offset - lineStarts[low] + 1 };
    };
    const positions = new Map();
    const segments = [];
    let i = 0;
    // The root value is indexed under "" (JSON Pointer convention); the CLI
    // renders the root placeholder as "/" where the contract requires \S.
    const pointerOf = () => segments.length === 0 ? "" : "/" + segments.map(escapeSegment).join("/");
    const skipWhitespace = () => {
        while (i < source.length && WHITESPACE.has(source[i]))
            i += 1;
    };
    const record = () => {
        const pointer = pointerOf();
        if (!positions.has(pointer))
            positions.set(pointer, positionAt(i));
    };
    const scalar = () => {
        SCALAR.lastIndex = i;
        const match = SCALAR.exec(source);
        if (!match || match.index !== i)
            throw new JsonScanError("Invalid JSON token", i);
        i = SCALAR.lastIndex;
    };
    const value = () => {
        skipWhitespace();
        record();
        const ch = source[i];
        if (ch === "{") {
            object();
            return;
        }
        if (ch === "[") {
            array();
            return;
        }
        if (ch === '"') {
            i = decodeString(source, i).end;
            return;
        }
        scalar();
    };
    const object = () => {
        i += 1;
        skipWhitespace();
        if (source[i] === "}") {
            i += 1;
            return;
        }
        for (;;) {
            skipWhitespace();
            if (source[i] !== '"')
                throw new JsonScanError("Expected a property name", i);
            const key = decodeString(source, i);
            i = key.end;
            skipWhitespace();
            if (source[i] !== ":")
                throw new JsonScanError("Expected ':'", i);
            i += 1;
            segments.push(key.value);
            value();
            segments.pop();
            skipWhitespace();
            if (source[i] === ",") {
                i += 1;
                continue;
            }
            if (source[i] === "}") {
                i += 1;
                return;
            }
            throw new JsonScanError("Expected ',' or '}'", i);
        }
    };
    const array = () => {
        i += 1;
        skipWhitespace();
        if (source[i] === "]") {
            i += 1;
            return;
        }
        let index = 0;
        for (;;) {
            segments.push(String(index));
            value();
            segments.pop();
            index += 1;
            skipWhitespace();
            if (source[i] === ",") {
                i += 1;
                continue;
            }
            if (source[i] === "]") {
                i += 1;
                return;
            }
            throw new JsonScanError("Expected ',' or ']'", i);
        }
    };
    value();
    skipWhitespace();
    if (i !== source.length)
        throw new JsonScanError("Unexpected content after the top-level value", i);
    const exact = (pointer) => positions.get(pointer);
    const nearest = (pointer) => {
        let candidate = pointer;
        for (;;) {
            const found = positions.get(candidate);
            if (found)
                return found;
            const slash = candidate.lastIndexOf("/");
            if (slash <= 0)
                return positions.get("");
            candidate = candidate.slice(0, slash);
        }
    };
    return { exact, nearest };
}
/** Returns undefined for text the scanner cannot index; callers keep the pointer only. */
export function tryBuildLocationIndex(source) {
    try {
        return buildLocationIndex(source);
    }
    catch {
        return undefined;
    }
}
