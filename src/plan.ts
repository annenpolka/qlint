/**
 * Execution-plan construction (`qlint inspect`).
 *
 * The plan fixes exactly which state fields each question may send, keeps
 * policy references separate from evidence inputs, records redaction and
 * limits with their basis, and binds the whole content to a digest so
 * `qlint run` can detect edits. Pure: the caller supplies the suite.
 */
import type { ExecutionPlan, PlanFieldProjection, PlanQuestion, QuestionSuite } from "./contracts.js";
import { digestOf } from "./digest.js";

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

export interface PlanOptions {
  version: string;
  maxRequests?: number;
  maxBytes?: number;
  maxTokens?: number;
  allowRestricted?: boolean;
}

const PROJECTION_NOTE =
  "Only the fields listed for this question are projected. Every other declared field, including evaluation targets, is excluded; excludedFieldIds records that boundary.";

function limitRationale(options: PlanOptions): string {
  const parts: string[] = [];
  if (options.maxBytes === undefined && options.maxTokens === undefined) {
    parts.push("no payload-size estimate is computed at plan time because no state values exist yet; pass --max-bytes or --max-tokens to bind request size explicitly");
  } else {
    if (options.maxBytes !== undefined) parts.push(`maxBytes=${options.maxBytes} was provided by the caller, not derived from data`);
    if (options.maxTokens !== undefined) parts.push(`maxTokens=${options.maxTokens} was provided by the caller, not derived from data`);
  }
  return parts.join("; ");
}

export function buildPlan(suite: QuestionSuite, options: PlanOptions): ExecutionPlan {
  const fields = new Map(suite.state.fields.map(field => [field.id, field]));
  const bindings = new Map(suite.bindings.map(binding => [binding.questionId, binding]));
  const questions: PlanQuestion[] = [];

  for (const question of suite.questions) {
    const binding = bindings.get(question.id);
    if (!binding) throw new PlanError(`question ${question.id} has no execution binding`);

    const toProjection = (fieldId: string): PlanFieldProjection => {
      const field = fields.get(fieldId);
      if (!field) throw new PlanError(`question ${question.id} references unknown field ${fieldId}`);
      if (field.role === "target") throw new PlanError(`question ${question.id} references evaluation target ${fieldId}`);
      return {
        fieldId: field.id,
        pointer: field.pointer,
        valueType: field.valueType,
        nullable: field.nullable,
        role: field.role,
        sensitivity: field.sensitivity,
        handling: "verbatim",
      };
    };

    const inputs = question.inputs.map(toProjection);
    const policyRefs = question.policyRefs.map(toProjection);
    const used = new Set([...question.inputs, ...question.policyRefs]);
    const excludedFieldIds = suite.state.fields.filter(field => !used.has(field.id)).map(field => field.id);
    const restrictedFieldIds = [...inputs, ...policyRefs]
      .filter(projection => projection.sensitivity === "restricted")
      .map(projection => projection.fieldId);

    if (restrictedFieldIds.length > 0 && options.allowRestricted !== true) {
      throw new PlanError(
        `restricted fields require explicit approval via --allow-restricted: ${restrictedFieldIds.join(", ")}`,
      );
    }

    const redactionNote = options.allowRestricted === true && restrictedFieldIds.length > 0
      ? `${PROJECTION_NOTE} Restricted fields were explicitly approved for projection.`
      : PROJECTION_NOTE;

    const limits: PlanQuestion["limits"] = {
      ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
      ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
      rationale: limitRationale(options),
    };

    questions.push({
      questionId: question.id,
      atStage: binding.atStage,
      profile: binding.profile,
      mode: question.mode,
      outputKind: question.output.kind,
      gates: binding.gates.map(gate => ({ purpose: gate.purpose, questionId: gate.questionId })),
      inputs,
      policyRefs,
      redaction: { policy: "explicit-projection-v0.1", excludedFieldIds, restrictedFieldIds, note: redactionNote },
      limits,
    });
  }

  const requestCount = questions.length;
  const maxRequests = options.maxRequests ?? requestCount;
  if (maxRequests < requestCount) {
    throw new PlanError(`--max-requests ${maxRequests} is below the ${requestCount} requests this suite requires`);
  }

  const withoutDigest = {
    schemaVersion: "0.1" as const,
    kind: "qlint.execution-plan" as const,
    tool: { name: "qlint" as const, version: options.version },
    provider: { name: "replay" as const, network: false as const },
    suite: { id: suite.id, digest: digestOf(suite) },
    questions,
    requestCount,
    maxRequests,
    notes: [
      "provider replay: this plan is executed against recorded responses only; live providers are not implemented in this bundle",
      "gate runtime and adapter normalization are not part of plan execution",
      "the plan is digest-bound; qlint run refuses content whose digest does not match",
    ],
  };
  return { ...withoutDigest, digest: digestOf(withoutDigest) };
}

export function planDigest(plan: ExecutionPlan): string {
  const { digest: _digest, ...rest } = plan;
  return digestOf(rest);
}

export function verifyPlanDigest(plan: ExecutionPlan): boolean {
  return plan.digest === planDigest(plan);
}
