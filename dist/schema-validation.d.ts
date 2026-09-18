export interface SchemaIssue {
    keyword: string;
    /** JSON Pointer into the validated document. */
    pointer: string;
    message: string;
}
export interface SchemaValidators {
    suite(data: unknown): SchemaIssue[];
    diagnostic(data: unknown): SchemaIssue[];
    executionPlan(data: unknown): SchemaIssue[];
}
export interface SchemaSources {
    suite: object;
    diagnostic: object;
    executionPlan: object;
}
/**
 * Compiles the shipped schemas (Draft 2020-12). `strict` is off because the
 * schemas use patterns such as `required` inside `not` that Ajv otherwise
 * reports as strict-mode warnings; the schemas are the reviewed source of truth.
 */
export declare function createSchemaValidators(sources: SchemaSources): SchemaValidators;
/** Reads a schema file. Boundary function: filesystem access is not hidden in the validators. */
export declare function loadSchemaSync(path: string | URL): object;
