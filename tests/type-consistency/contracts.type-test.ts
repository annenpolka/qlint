/**
 * Compile-time drift check: schemas/ is the structural source of truth and
 * src/contracts.ts must stay mutually assignable with the types generated
 * from the schemas. A schema edit that the hand-written types do not follow
 * makes one of the assignments below fail to compile, failing `npm test`.
 *
 * Run via `npm run test:types` (generates tests/generated/ first, then tsc).
 * Nothing imports this file at runtime.
 */
import type { Diagnostic, ExecutionPlan, QuestionSuite } from "../../src/contracts.js";
import type { Diagnostic as GeneratedDiagnostic } from "../generated/diagnostic.js";
import type { ExecutionPlan as GeneratedExecutionPlan } from "../generated/execution-plan.js";
import type { QuestionSuite as GeneratedQuestionSuite } from "../generated/question-suite.js";

type Extends<A, B> = [A] extends [B] ? true : false;
type MutuallyAssignable<A, B> = Extends<A, B> extends true ? Extends<B, A> : false;

const suite: MutuallyAssignable<QuestionSuite, GeneratedQuestionSuite> = true;
const diagnostic: MutuallyAssignable<Diagnostic, GeneratedDiagnostic> = true;
const plan: MutuallyAssignable<ExecutionPlan, GeneratedExecutionPlan> = true;

void suite;
void diagnostic;
void plan;
