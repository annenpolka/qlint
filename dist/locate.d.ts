/**
 * Maps JSON Pointers to positions in the original JSON text.
 *
 * Used after JSON.parse has already accepted the document, to attach
 * 1-based line/column numbers to diagnostics. This module never decides
 * whether a document is valid, and it is pure: no filesystem, network, or
 * environment access, no mutation of its input.
 */
export interface SourcePosition {
    /** UTF-16 offset into the source text. */
    offset: number;
    /** 1-based line number. */
    line: number;
    /** 1-based column number, counted in UTF-16 code units. */
    column: number;
}
export interface LocationIndex {
    /** Position of the value at this exact pointer, when it was indexed. */
    exact(pointer: string): SourcePosition | undefined;
    /** Position of the exact pointer, or the closest indexed ancestor. */
    nearest(pointer: string): SourcePosition | undefined;
}
/** Position of a UTF-16 offset in the source; 1-based line and column. */
export declare function positionAtOffset(source: string, offset: number): SourcePosition;
export declare class JsonScanError extends Error {
    readonly offset: number;
    constructor(message: string, offset: number);
}
/**
 * Scans JSON text and records the first position of every value.
 * Duplicate object keys keep the first position; JSON.parse keeps the last,
 * so a duplicate-key diagnostic may point at the earlier occurrence.
 */
export declare function buildLocationIndex(source: string): LocationIndex;
/** Returns undefined for text the scanner cannot index; callers keep the pointer only. */
export declare function tryBuildLocationIndex(source: string): LocationIndex | undefined;
