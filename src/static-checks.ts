import type {
  QuestionSuite, Diagnostic, StaticReport, BackendCapabilities,
} from "./contracts.js";

/**
 * Cross-reference checks ONLY. Validate unknown JSON against the shipped schema
 * before calling. A clean report is not a semantic approval or a schema check.
 * No model requests, filesystem access, environment variables, or side effects.
 */
export function lintValidatedSuite(
  suite: QuestionSuite,
  capabilities?: BackendCapabilities,
): StaticReport {
  const diagnostics: Diagnostic[] = [];
  function emit(ruleId: string, message: string, pointer: string, questionId?: string): void {
    diagnostics.push({
      ruleId, severity: "error", basis: "static_proof", message,
      locations: [{ pointer }], evidence: [{ kind: "contract_ref", pointer }],
      ...(questionId === undefined ? {} : { questionId }),
    });
  }
  function duplicates(ids: string[], pointer: string): void {
    const seen = new Set<string>();
    ids.forEach((id, index) => {
      if (seen.has(id)) emit("QCT008", `Duplicate identifier: ${id}`, `${pointer}/${index}`);
      seen.add(id);
    });
  }
  const stages = new Map(suite.state.stages.map(s => [s.id, s]));
  const fields = new Map(suite.state.fields.map(f => [f.id, f]));
  const questions = new Map(suite.questions.map(q => [q.id, q]));
  const bindings = new Map(suite.bindings.map(b => [b.questionId, b]));
  duplicates(suite.state.stages.map(s => s.id), "/state/stages");
  duplicates(suite.state.fields.map(f => f.id), "/state/fields");
  duplicates(suite.questions.map(q => q.id), "/questions");
  duplicates(suite.bindings.map(b => b.questionId), "/bindings");

  function cycles(graph: Map<string, string[]>, pointer: string): void {
    const done = new Set<string>();
    const active = new Set<string>();
    const walk = (id: string, path: string[]): void => {
      if (active.has(id)) {
        emit("QCT003", `Dependency cycle: ${[...path, id].join(" -> ")}`, pointer);
        return;
      }
      if (done.has(id)) return;
      active.add(id);
      for (const next of graph.get(id) ?? []) if (graph.has(next)) walk(next, [...path, id]);
      active.delete(id);
      done.add(id);
    };
    for (const id of graph.keys()) walk(id, []);
  }
  suite.state.stages.forEach((stage, index) => {
    for (const parent of stage.after) {
      if (!stages.has(parent)) emit("QCT002", `Unknown stage: ${parent}`, `/state/stages/${index}/after`);
    }
  });
  suite.state.fields.forEach((field, index) => {
    if (!stages.has(field.availableFrom)) {
      emit("QCT002", `Unknown availability stage: ${field.availableFrom}`, `/state/fields/${index}/availableFrom`);
    }
    for (const parent of field.derivedFrom) {
      if (!fields.has(parent)) emit("QCT002", `Unknown source field: ${parent}`, `/state/fields/${index}/derivedFrom`);
    }
  });
  cycles(new Map([...stages].map(([id, stage]) => [id, stage.after])), "/state/stages");
  cycles(new Map([...fields].map(([id, field]) => [id, field.derivedFrom])), "/state/fields");

  const reachable = (earlier: string, at: string): boolean => {
    const pending = [at];
    const seen = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (current === earlier) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      pending.push(...(stages.get(current)?.after ?? []));
    }
    return false;
  };
  const targetFields = [...fields.values()].filter(f => f.role === "target");
  const containsPointer = (ancestor: string, child: string): boolean =>
    ancestor === child || child.startsWith(ancestor + "/");

  suite.questions.forEach((question, index) => {
    const pointer = `/questions/${index}`;
    if (!bindings.has(question.id)) emit("QCT008", "Question has no execution binding.", pointer, question.id);
    question.inputs.forEach((ref, refIndex) => {
      if (!fields.has(ref)) emit("QCT002", `Unknown input field: ${ref}`, `${pointer}/inputs/${refIndex}`, question.id);
    });
    question.policyRefs.forEach((ref, refIndex) => {
      const refPointer = `${pointer}/policyRefs/${refIndex}`;
      if (!fields.has(ref)) emit("QCT002", `Unknown policy field: ${ref}`, refPointer, question.id);
      else if (fields.get(ref)!.role !== "policy") emit("QCT009", `policyRefs points to a non-policy field: ${ref}`, refPointer, question.id);
    });
    if (question.prediction) {
      const target = fields.get(question.prediction.targetRef);
      if (!target) emit("QCT002", "Unknown prediction target.", `${pointer}/prediction`, question.id);
      else if (target.role !== "target") emit("QCT009", "Prediction target must have role=target.", `${pointer}/prediction`, question.id);
    }
    // Walk inputs and derived fields, keeping the listed reference each
    // dependency entered through, so diagnostics point at that array item.
    const origins = new Map<string, string>();
    const pending: Array<{ id: string; origin: string }> = [
      ...question.inputs.map((ref, refIndex) => ({ id: ref, origin: `${pointer}/inputs/${refIndex}` })),
      ...question.policyRefs.map((ref, refIndex) => ({ id: ref, origin: `${pointer}/policyRefs/${refIndex}` })),
    ];
    while (pending.length) {
      const { id, origin } = pending.pop()!;
      if (origins.has(id)) continue;
      origins.set(id, origin);
      for (const parent of fields.get(id)?.derivedFrom ?? []) pending.push({ id: parent, origin });
    }
    const binding = bindings.get(question.id);
    for (const [ref, origin] of origins) {
      const field = fields.get(ref);
      if (!field) continue;
      if (targetFields.some(target => containsPointer(field.pointer, target.pointer) || containsPointer(target.pointer, field.pointer))) {
        emit("QCT005", `Input or dependency exposes an evaluation target: ${ref}`, origin, question.id);
      }
      if (binding && stages.has(binding.atStage) && stages.has(field.availableFrom)
          && !reachable(field.availableFrom, binding.atStage)) {
        emit("QCT004", `Field ${ref} is not guaranteed available at ${binding.atStage}; declared at ${field.availableFrom}.`, origin, question.id);
      }
      // A selected parent object can carry registered child fields whose own
      // declared availability is later than the parent's. Targets are excluded
      // here because QCT005 reports their exposure.
      for (const nested of fields.values()) {
        if (nested.role === "target" || nested.id === field.id || field.pointer === nested.pointer) continue;
        if (!containsPointer(field.pointer, nested.pointer)) continue;
        if (binding && stages.has(binding.atStage) && stages.has(nested.availableFrom)
            && !reachable(nested.availableFrom, binding.atStage)) {
          emit("QCT004", `Selector ${field.pointer} contains declared field ${nested.pointer}, which is not guaranteed available at ${binding.atStage}; declared at ${nested.availableFrom}.`, origin, question.id);
        }
      }
    }
    const out = question.output;
    if (out.kind !== "boolean") {
      const options = out.kind === "ordinal" ? out.levels : out.options;
      const ids = options.map(o => o.id);
      if (new Set(ids).size !== ids.length) {
        emit("QCT006", "Duplicate option/level IDs.", `${pointer}/output`, question.id);
      }
      if (out.kind === "categorical" && out.fallbackOptionId !== undefined && !ids.includes(out.fallbackOptionId)) {
        emit("QCT006", "Fallback ID does not name a declared option.", `${pointer}/output/fallbackOptionId`, question.id);
      }
    }
    if (capabilities) {
      if (!capabilities.kinds.includes(out.kind)) {
        emit("QBE001", `Backend does not support ${out.kind}.`, `${pointer}/output`, question.id);
      }
      if (out.kind === "categorical" && capabilities.maxCategoricalOptions !== undefined
          && out.options.length > capabilities.maxCategoricalOptions) {
        emit("QBE002", "Categorical option count exceeds the declared backend limit.", `${pointer}/output`, question.id);
      }
      if (out.kind === "ordinal" && capabilities.maxOrdinalLevels !== undefined
          && out.levels.length > capabilities.maxOrdinalLevels) {
        emit("QBE002", "Ordinal level count exceeds the declared backend limit.", `${pointer}/output`, question.id);
      }
    }
  });

  suite.bindings.forEach((binding, index) => {
    const pointer = `/bindings/${index}`;
    if (!questions.has(binding.questionId)) emit("QCT002", `Unknown bound question: ${binding.questionId}`, pointer);
    if (!stages.has(binding.atStage)) emit("QCT002", `Unknown binding stage: ${binding.atStage}`, pointer, binding.questionId);
    const purposes = new Set<string>();
    binding.gates.forEach((gate, gateIndex) => {
      const gatePointer = `${pointer}/gates/${gateIndex}`;
      const other = questions.get(gate.questionId);
      if (!other) emit("QCT002", `Unknown gate question: ${gate.questionId}`, gatePointer, binding.questionId);
      else if (other.output.kind !== "boolean") emit("QCT007", "A gate must refer to a boolean question.", gatePointer, binding.questionId);
      if (gate.falseAtMost >= gate.trueAtLeast) emit("QCT007", "Gate thresholds must leave a non-empty undecided interval.", gatePointer, binding.questionId);
      if (purposes.has(gate.purpose)) emit("QCT007", `Duplicate gate purpose: ${gate.purpose}`, gatePointer, binding.questionId);
      purposes.add(gate.purpose);
      const otherBinding = bindings.get(gate.questionId);
      if (otherBinding && otherBinding.atStage !== binding.atStage) {
        emit("QCT007", "v0.1 requires a gate and its consumer to use the same stage.", gatePointer, binding.questionId);
      }
    });
  });
  cycles(new Map([...bindings].map(([id, binding]) => [id, binding.gates.map(g => g.questionId)])), "/bindings");
  return {
    scope: "reference_static_checks_only",
    diagnostics,
    executedRuleIds: ["QCT002", "QCT003", "QCT004", "QCT005", "QCT006", "QCT007", "QCT008", "QCT009",
      ...(capabilities ? ["QBE001", "QBE002"] : [])],
    notExecuted: ["JSON Schema validation (caller responsibility)", "semantic screening", "empirical probes", "fuzzing", "calibration", "suite statistics"],
  };
}
