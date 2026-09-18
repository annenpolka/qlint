/** qlint contract proposal v0.1. Provider-neutral; no model or network dependency. */
export type Id = string;
export type JsonPrimitive = string | number | boolean | null;
export type Json = JsonPrimitive | Json[] | { [key: string]: Json };

export interface StageSpec {
  id: Id;
  /** Prerequisite stages; forms a DAG, not a total ordering. */
  after: Id[];
}
export interface FieldSpec {
  id: Id;
  /** Non-root JSON Pointer into an immutable, time-bounded snapshot. */
  pointer: string;
  valueType: "string" | "number" | "integer" | "boolean" | "array" | "object";
  nullable: boolean;
  availableFrom: Id;
  role: "evidence" | "policy" | "target" | "metadata";
  derivedFrom: Id[];
  sensitivity: "public" | "internal" | "restricted";
}
export interface StateContract {
  id: Id;
  stages: StageSpec[];
  fields: FieldSpec[];
}
export interface OptionSpec { id: Id; description: string }
export type OutputSpec =
  | { kind: "boolean"; criteria: { true: string; false: string } }
  | {
      kind: "categorical";
      selection: "partition" | "best_fit";
      options: OptionSpec[];
      /** A real content category, not the same thing as missing evidence. */
      fallbackOptionId?: Id;
      /** Natural-language tie resolution; screened, not statically proven. */
      tieBreak?: string;
    }
  | {
      kind: "ordinal";
      axis: string;
      /** List order is ascending; each description must be self-contained. */
      levels: OptionSpec[];
    };
export interface QuestionSpec {
  id: Id;
  revision: number;
  mode: "extract" | "interpret" | "predict";
  instructions: string;
  /** Every listed field is required for this v0.1 contract. */
  inputs: Id[];
  /** Kept orthogonal to mode; policy documents are also projected inputs. */
  policyRefs: Id[];
  applicability: string;
  /** Define what counts as evidence, including negative evidence. */
  evidenceBoundary: string;
  missingInput: "abstain";
  insufficientEvidence: "abstain";
  /** Metadata only; its actual value MUST NOT enter a prediction payload. */
  prediction?: { targetRef: Id; horizon: string };
  output: OutputSpec;
}
export interface GateSpec {
  purpose: "applicability" | "evidence";
  questionId: Id;
  /** p <= falseAtMost: false; p >= trueAtLeast: true; otherwise undecided. */
  falseAtMost: number;
  trueAtLeast: number;
}
export interface BindingSpec {
  questionId: Id;
  atStage: Id;
  profile: "feature" | "monitor" | "router" | "judge";
  gates: GateSpec[];
  onIndeterminate: "abstain";
}
export interface QuestionSuite {
  schemaVersion: "0.1";
  id: Id;
  state: StateContract;
  questions: QuestionSpec[];
  /** v0.1: exactly one binding per question in an executable suite. */
  bindings: BindingSpec[];
}

export type DiagnosticBasis = "static_proof" | "model_signal" | "empirical_witness";
export type Severity = "error" | "warning" | "info";
export type Evidence =
  | { kind: "contract_ref"; pointer: string }
  | { kind: "model_response"; runId: Id; answerId: Id; modelProbability?: number }
  | {
      kind: "paired_case";
      beforeCaseId: Id;
      afterCaseId: Id;
      transformId: Id;
      transformReview: "human_reviewed" | "unreviewed";
    }
  | { kind: "metric"; name: string; value: number; sampleSize: number; unit: string };
/**
 * A reported location. `pointer` always refers to the input document.
 * CLI tools add `file`/`line`/`column` after resolving the pointer against
 * the original text; `line` and `column` are 1-based. Library callers that
 * never see source text leave them absent.
 */
export interface DiagnosticLocation {
  pointer: string;
  file?: string;
  line?: number;
  column?: number;
}
export interface Diagnostic {
  ruleId: string;
  questionId?: Id;
  severity: Severity;
  basis: DiagnosticBasis;
  message: string;
  locations: DiagnosticLocation[];
  evidence: Evidence[];
}
export interface CheckCoverage {
  ruleId: string;
  status: "passed" | "flagged" | "unknown" | "not_run" | "not_applicable";
}
export interface Assessment {
  questionId: Id;
  status: "invalid" | "review_required" | "screened" | "inconclusive";
  coverage: CheckCoverage[];
  diagnostics: Diagnostic[];
  /** An explicit profile, not a universal correctness certificate. */
  profileId: Id;
}
export type ProbabilitySource =
  | "model_distribution"
  | "empirical_frequency"
  | "self_report";
export type Measurement =
  | { kind: "boolean"; representation: "distribution"; pTrue: number; probabilitySource: ProbabilitySource }
  | { kind: "boolean"; representation: "label"; value: boolean }
  | {
      kind: "categorical" | "ordinal";
      representation: "distribution";
      /** Stable option/level IDs; never silently key by presentation order. */
      distribution: Record<Id, number>;
      probabilitySource: ProbabilitySource;
    }
  | { kind: "categorical" | "ordinal"; representation: "label"; labelId: Id };
export interface RunProvenance {
  runId: Id;
  provider: string;
  requestedModel: string;
  resolvedModel?: string;
  providerRevision?: string;
  adapterVersion: string;
  specDigest: string;
  projectedStateDigest: string;
  ruleSetDigest: string;
  calibrationId?: string;
}
export type EvaluationResult =
  | { status: "answered"; measurement: Measurement; provenance: RunProvenance }
  | {
      status: "abstained";
      reason: "missing_input" | "insufficient_evidence" | "gate_uncertain";
      evidenceRefs: string[];
      provenance?: RunProvenance;
    }
  | { status: "not_applicable"; gateQuestionId: Id; provenance?: RunProvenance }
  | { status: "error"; code: string; message: string; retryable: boolean };
export interface BackendCapabilities {
  kinds: OutputSpec["kind"][];
  nativeDistribution: boolean;
  nativeAbstention: boolean;
  maxCategoricalOptions?: number;
  maxOrdinalLevels?: number;
  /** A declaration to be checked by adapter conformance tests. */
  questionIdsVisibleToModel?: boolean;
  siblingLevelDescriptionsVisible?: boolean;
}
export interface StaticReport {
  scope: "reference_static_checks_only";
  diagnostics: Diagnostic[];
  executedRuleIds: string[];
  notExecuted: string[];
}

/** A model can emit signals, never an authoritative Diagnostic or CI policy. */
export interface ModelScreenSignal {
  ruleId: string;
  questionId: Id;
  applicability: "applicable" | "not_applicable" | "unknown";
  evidenceSufficiency: "sufficient" | "insufficient" | "unknown";
  violation: Measurement;
  /** IDs must refer to fragments supplied by the parser; no invented quotes. */
  fragmentIds: Id[];
  provenance: RunProvenance;
}
