/**
 * Screening evaluation corpus definitions (implementation plan section 4).
 *
 * 60 cases: 40 defect cases (5 implemented rule families x 8) and 20
 * look-alike legitimate cases (4 per family). Defect texts are human-authored
 * per family; legitimate cases cover explicit AND conditions, crisp numeric or
 * negative-side boundaries, predict-as-declared questions, self-contained
 * ordinal levels, overlapping best_fit categories, and rare-event detectors.
 *
 * Splits: 30 tuning / 30 eval. Thresholds may be studied on the tuning split
 * only; the eval split is reported untouched.
 *
 * Run `node evaluation/generate-cases.mjs` to write evaluation/cases.jsonl.
 */

const BOOL = (trueText, falseText) => ({ kind: "boolean", criteria: { true: trueText, false: falseText } });
const ORD = (axis, levels) => ({ kind: "ordinal", axis, levels: levels.map((description, index) => ({ id: `level_${index}`, description })) });
const CAT = (selection, options) => ({ kind: "categorical", selection, options: options.map((description, index) => ({ id: `option_${index}`, description })) });

function suiteFor({ id, mode = "interpret", instructions, applicability, evidenceBoundary, output, prediction, policyRefs = [], inputs = ["task", "diff"] }) {
  return {
    schemaVersion: "0.1",
    id,
    state: {
      id: `state_${id}`,
      stages: [{ id: "start", after: [] }, { id: "complete", after: ["start"] }],
      fields: [
        { id: "task", pointer: "/task", valueType: "string", nullable: false, availableFrom: "start", role: "evidence", derivedFrom: [], sensitivity: "internal" },
        { id: "diff", pointer: "/diff", valueType: "string", nullable: false, availableFrom: "start", role: "evidence", derivedFrom: [], sensitivity: "internal" },
        { id: "outcome", pointer: "/outcome", valueType: "string", nullable: false, availableFrom: "complete", role: "target", derivedFrom: [], sensitivity: "internal" },
        ...policyRefs.map(fieldId => ({ id: fieldId, pointer: `/${fieldId}`, valueType: "string", nullable: false, availableFrom: "start", role: "policy", derivedFrom: [], sensitivity: "internal" })),
      ],
    },
    questions: [{
      id: "q1",
      revision: 1,
      mode,
      instructions,
      inputs,
      policyRefs,
      applicability: applicability ?? "対象の作業が存在する。",
      evidenceBoundary: evidenceBoundary ?? "提示された入力だけを根拠にする。",
      missingInput: "abstain",
      insufficientEvidence: "abstain",
      ...(prediction === undefined ? {} : { prediction }),
      output,
    }],
    bindings: [{ questionId: "q1", atStage: "start", profile: "feature", gates: [], onIndeterminate: "abstain" }],
  };
}

const cases = [];
const counters = new Map();
const nextId = (family, kind, language) => {
  const key = `${family}_${kind}_${language}`;
  const count = (counters.get(key) ?? 0) + 1;
  counters.set(key, count);
  return `${family.toLowerCase()}_${kind}_${language}_${String(count).padStart(2, "0")}`;
};

function defect(family, group, language, split, question, rationale, extra = {}) {
  const caseId = nextId(family, "defect", language);
  cases.push({
    caseId,
    groupId: `${family}_${group}`,
    family,
    kind: "defect",
    language,
    split,
    suite: suiteFor({ id: caseId, ...question }),
    expected: {
      status: "signal",
      rules: [family],
      alternatives: extra.alternatives ?? [],
      evidencePointer: extra.evidencePointer ?? "/questions/0/instructions",
      rationale,
    },
  });
}

function legit(family, group, language, split, question, rationale) {
  const caseId = nextId(family, "legit", language);
  cases.push({
    caseId,
    groupId: `${family}_${group}`,
    family,
    kind: "legitimate",
    language,
    split,
    suite: suiteFor({ id: caseId, ...question }),
    expected: {
      status: "no_signal",
      rules: [],
      alternatives: [],
      evidencePointer: "/questions/0/instructions",
      rationale,
    },
  });
}

// --- QSM001 compound-judgment ------------------------------------------------

defect("QSM001", "state_outcome", "ja", "tuning",
  { instructions: "この変更は正しく、かつ読みやすいか。", output: BOOL("正しく、読みやすい。", "それ以外。") },
  "正しさと読みやすさは独立に変わり得るが、合成の規則が示されていない。");
defect("QSM001", "state_outcome", "en", "tuning",
  { instructions: "Is this change correct and easy to read?", output: BOOL("Correct and easy to read.", "Otherwise.") },
  "Correctness and readability vary independently and no composition rule is stated.");
defect("QSM001", "state_outcome", "ja", "eval",
  { instructions: "作業が完了し、依頼を満たしているか。", output: BOOL("完了しており依頼も満たす。", "それ以外。") },
  "完了状態と依頼充足は独立し得る。片方だけ true の扱いが未定義。");
defect("QSM001", "state_outcome", "en", "eval",
  { instructions: "Is the work finished and does it satisfy the request?", output: BOOL("Finished and satisfying.", "Otherwise.") },
  "Completion and request satisfaction can vary independently.");
defect("QSM001", "quality_style", "ja", "tuning",
  { instructions: "テストは十分にあり、速く実行されるか。", output: BOOL("十分かつ高速。", "それ以外。") },
  "網羅性と実行速度は独立した軸。");
defect("QSM001", "quality_style", "en", "tuning",
  { instructions: "Are the tests thorough and fast?", output: BOOL("Thorough and fast.", "Otherwise.") },
  "Thoroughness and speed are independent axes.");
defect("QSM001", "quality_style", "ja", "eval",
  { instructions: "この関数は安全で、性能も十分か。", output: BOOL("安全かつ十分な性能。", "それ以外。") },
  "安全性と性能は独立に変わり、合成規則がない。");
defect("QSM001", "quality_style", "en", "eval",
  { instructions: "Is this function safe and performant enough?", output: BOOL("Safe and performant.", "Otherwise.") },
  "Safety and performance vary independently.");
legit("QSM001", "explicit_and", "ja", "tuning",
  { instructions: "依頼に含まれる変更と、方針で明示的に許可された変更の両方を満たすか。true は両方を満たす場合のみ。", output: BOOL("両方を満たす。", "少なくとも一方を満たさない。"), policyRefs: ["policy"] },
  "AND条件と合成規則が明示されている。");
legit("QSM001", "explicit_and", "en", "tuning",
  { instructions: "Does the submission satisfy both the acceptance criteria and the licensing policy? Answer true only if both hold.", output: BOOL("Both hold.", "At least one does not hold.") },
  "The composition (both must hold) is explicit.");
legit("QSM001", "single_concept", "ja", "eval",
  { instructions: "この差分は、依頼で名指しされたファイルの外に変更を加えているか。", output: BOOL("名指しされたファイル以外に変更がある。", "変更は名指しされたファイル内に収まっている。") },
  "依頼範囲という単一の概念を判定している。");
legit("QSM001", "single_concept", "en", "eval",
  { instructions: "Does the diff stay within the files named in the request?", output: BOOL("At least one change is outside the named files.", "All changes are within the named files.") },
  "One concept: staying within the named files.");

// --- QSM002 underspecified-boundary -----------------------------------------

defect("QSM002", "quality_undefined", "ja", "tuning",
  { instructions: "この回答は品質が高いか。", output: BOOL("品質が高い。", "品質が低い。") },
  "「品質」の判定境界も否定側の意味も定義されていない。");
defect("QSM002", "quality_undefined", "en", "tuning",
  { instructions: "Is this response high quality?", output: BOOL("High quality.", "Low quality.") },
  "Neither the boundary nor the negative side of \u201chigh quality\u201d is defined.");
defect("QSM002", "quality_undefined", "ja", "eval",
  { instructions: "このコードは適切に書かれているか。", output: BOOL("適切。", "不適切。") },
  "「適切」の基準がない。");
defect("QSM002", "quality_undefined", "en", "eval",
  { instructions: "Is this behavior appropriate?", output: BOOL("Appropriate.", "Not appropriate.") },
  "\u201cAppropriate\u201d has no stated boundary.");
defect("QSM002", "appropriate_effort", "ja", "tuning",
  { instructions: "エージェントは妥当な努力をしたか。", output: BOOL("妥当な努力をした。", "努力が足りない。") },
  "「妥当な努力」の水準が不明。");
defect("QSM002", "appropriate_effort", "en", "tuning",
  { instructions: "Did the agent make a reasonable effort?", output: BOOL("Reasonable effort.", "Insufficient effort.") },
  "\u201cReasonable effort\u201d has no standard.");
defect("QSM002", "appropriate_effort", "ja", "eval",
  { instructions: "この変更は十分に検討されたか。", output: BOOL("十分に検討された。", "検討が不十分。") },
  "「十分」の基準がなく、否定側も曖昧。");
defect("QSM002", "appropriate_effort", "en", "eval",
  { instructions: "Was this change well considered?", output: BOOL("Well considered.", "Not well considered.") },
  "The threshold for \u201cwell considered\u201d is unstated.");
legit("QSM002", "crisp_threshold", "ja", "tuning",
  { instructions: "依頼文の文字数が500字未満ならtrue。500字以上ならfalse。", output: BOOL("500字未満。", "500字以上。") },
  "境界が数値で明示されている。");
legit("QSM002", "crisp_threshold", "en", "tuning",
  { instructions: "True if the diff changes no files outside src/. False if any file outside src/ is changed.", output: BOOL("No file outside src/ is changed.", "At least one file outside src/ is changed.") },
  "The boundary and the negative side are stated exactly.");
legit("QSM002", "negative_defined", "ja", "eval",
  { instructions: "true は依頼文に入力ファイル名が明記されている場合。false はどのファイルか明記されていない場合。一部だけ明記なら false。", output: BOOL("ファイル名が明記されている。", "明記されていない、または一部のみ。") },
  "否定側と部分該当の扱いが明示されている。");
legit("QSM002", "negative_defined", "en", "eval",
  { instructions: "True if the request text names at least one concrete file and one exact command. False if it names neither. A partial mention is false.", output: BOOL("Both a file and a command are named.", "Otherwise, including partial mentions.") },
  "The negative case and partial mentions are bounded.");

// --- QSM003 unobservable-as-declared ----------------------------------------

defect("QSM003", "future_outcome", "ja", "tuning",
  { instructions: "この作業は最終的に失敗するか。", output: BOOL("最終的に失敗する。", "失敗しない。") },
  "interpret として宣言されているが、未来の結果という入力外の観測を要する。");
defect("QSM003", "future_outcome", "en", "tuning",
  { instructions: "Will this task fail in the end?", output: BOOL("It will fail.", "It will not fail.") },
  "Declared interpret but requires a future outcome outside the inputs.");
defect("QSM003", "future_outcome", "ja", "eval",
  { instructions: "この変更は本番環境で障害を起こすか。", output: BOOL("障害を起こす。", "起こさない。") },
  "将来の本番挙動は提示入力から観測できない。");
defect("QSM003", "future_outcome", "en", "eval",
  { instructions: "Will this change cause an incident in production?", output: BOOL("It will cause an incident.", "It will not.") },
  "Future production behavior cannot be observed from the inputs.");
defect("QSM003", "hidden_context", "ja", "tuning",
  { instructions: "この対応は社内規定に適合しているか。", output: BOOL("適合している。", "適合していない。"), evidenceBoundary: "社内規定そのものは提示されない。提示された入力だけを根拠にする。" },
  "適合判定に必要な規定が入力に存在しない。");
defect("QSM003", "hidden_context", "en", "tuning",
  { instructions: "Is this response consistent with the user's previous complaints?", output: BOOL("Consistent with the complaints.", "Not consistent."), evidenceBoundary: "Previous complaints are not provided. Use only the shown inputs." },
  "The required history is not among the declared inputs.");
defect("QSM003", "hidden_context", "ja", "eval",
  { instructions: "この差分は、昨日のレビュー指摘を解消しているか。", output: BOOL("解消している。", "解消していない。") },
  "レビュー指摘が入力に含まれない。");
defect("QSM003", "hidden_context", "en", "eval",
  { instructions: "Does this change address the incident from last week?", output: BOOL("It addresses the incident.", "It does not.") },
  "The incident record is not among the declared inputs.");
legit("QSM003", "predict_declared", "ja", "tuning",
  { mode: "predict", instructions: "この作業は最終的に失敗するか。", output: BOOL("失敗する。", "失敗しない。"), prediction: { targetRef: "outcome", horizon: "作業完了時" } },
  "predict として正しく宣言され、予測対象も契約に登録されている。");
legit("QSM003", "predict_declared", "en", "tuning",
  { mode: "predict", instructions: "Will this change cause an incident in production?", output: BOOL("It will.", "It will not."), prediction: { targetRef: "outcome", horizon: "at release" } },
  "Declared predict with a registered target.");
legit("QSM003", "input_bound", "ja", "eval",
  { instructions: "依頼文に書かれた完了条件を、差分が満たしているか。判定には提示された依頼文と差分だけを使う。", output: BOOL("満たしている。", "満たしていない。") },
  "提示された入力だけで判定できる。");
legit("QSM003", "input_bound", "en", "eval",
  { instructions: "Does the diff remove the line that the request explicitly asks to remove?", output: BOOL("It removes that line.", "It does not.") },
  "Answerable from the shown inputs alone.");

// --- QSM004 primitive-mismatch ----------------------------------------------

defect("QSM004", "boolean_for_open", "ja", "tuning",
  { instructions: "差分に含まれる問題点は何か。", output: BOOL("問題がある。", "問題がない。") },
  "どの問題かを問うているが boolean は内容を記録できない。");
defect("QSM004", "boolean_for_open", "en", "tuning",
  { instructions: "Which problem does the diff contain?", output: BOOL("There is a problem.", "There is no problem.") },
  "The question asks which problem; a boolean cannot record it.");
defect("QSM004", "boolean_for_open", "ja", "eval",
  { instructions: "この依頼はどのカテゴリに属するか。", output: BOOL("カテゴリがある。", "カテゴリがない。") },
  "カテゴリ選択の質問に boolean を割り当てている。");
defect("QSM004", "boolean_for_open", "en", "eval",
  { instructions: "What kind of request is this?", output: BOOL("It has a kind.", "It has no kind.") },
  "A boolean cannot express the kind.");
defect("QSM004", "ordered_for_unordered", "ja", "tuning",
  { instructions: "このコードはどの言語で書かれているか。", output: ORD("language", ["Python", "TypeScript", "Go"]) },
  "順序のないカテゴリを ordinal のレベルとして並べている。");
defect("QSM004", "ordered_for_unordered", "en", "tuning",
  { instructions: "Which language is this code written in?", output: ORD("language", ["Python", "TypeScript", "Go"]) },
  "Unordered categories are declared as ordered levels.");
defect("QSM004", "boolean_for_degree", "ja", "eval",
  { instructions: "この問題はどの程度深刻か。", output: BOOL("深刻である。", "深刻でない。") },
  "程度を問うているが boolean では段階を表現できない。");
defect("QSM004", "boolean_for_degree", "en", "eval",
  { instructions: "How severe is this issue?", output: BOOL("Severe.", "Not severe.") },
  "A boolean cannot express the degree.");
legit("QSM004", "boolean_matches", "ja", "tuning",
  { instructions: "差分は依頼にないファイルを変更しているか。", output: BOOL("依頼にないファイルを変更している。", "依頼の範囲に収まっている。") },
  "yes/no の判断に boolean が合っている。");
legit("QSM004", "boolean_matches", "en", "tuning",
  { instructions: "Does the report contain any personal data?", output: BOOL("Personal data is present.", "No personal data is present.") },
  "A yes/no judgment matches the boolean shape.");
legit("QSM004", "matching_shape", "ja", "eval",
  { instructions: "この問題の深刻度を、提示された3段階で評価する。", output: ORD("severity", ["機能への影響なし", "回避策のある機能低下", "回避策のない停止"]) },
  "程度の判断に自己完結した ordinal が合っている。");
legit("QSM004", "matching_shape", "en", "eval",
  { instructions: "Which category best fits this item?", output: CAT("best_fit", ["A bug report with steps to reproduce", "A defect report, including bug reports that also read as defects"]) },
  "best_fit は重なりを許容する宣言であり、それ自体は型不一致ではない。");

// --- QBE004 context-dependent-level -----------------------------------------

defect("QBE004", "relative_reference", "ja", "tuning",
  { instructions: "この変更の影響を評価する。", output: ORD("impact", ["問題なし", "前の段階よりやや悪い", "さらに悪い"]) },
  "レベルが他のレベルとの比較でしか意味を持たない。");
defect("QBE004", "relative_reference", "en", "tuning",
  { instructions: "Rate the impact of this change.", output: ORD("impact", ["No issue", "Slightly worse than the previous level", "Even worse"]) },
  "Levels are defined only relative to their neighbours.");
defect("QBE004", "number_reference", "ja", "eval",
  { instructions: "この変更を分類する。", output: ORD("class", ["レベル0に該当", "レベル1に該当", "上記に該当しない"]) },
  "レベル番号と他のレベルへの参照でしか記述されていない。");
defect("QBE004", "number_reference", "en", "eval",
  { instructions: "Classify this change.", output: ORD("class", ["Same as level 0", "Same as level 1", "Everything else"]) },
  "Descriptions reference level numbers instead of standing alone.");
defect("QBE004", "cumulative", "ja", "tuning",
  { instructions: "テストの状態を評価する。", output: ORD("tests", ["問題なし", "上記に加えてテストもない", "上記に加えてドキュメントもない"]) },
  "各レベルが前のレベルの内容を前提にしている。");
defect("QBE004", "cumulative", "en", "tuning",
  { instructions: "Rate the state of the tests.", output: ORD("tests", ["No gaps", "Everything above, plus missing tests", "Everything above, plus missing docs"]) },
  "Each level presupposes the previous one.");
defect("QBE004", "comparative", "ja", "eval",
  { instructions: "この変更のリスクを評価する。", output: ORD("risk", ["低い", "中程度（低いより高い）", "高い（中程度より高い）"]) },
  "レベル記述が相対比較で与えられている。");
defect("QBE004", "comparative", "en", "eval",
  { instructions: "Rate the risk of this change.", output: ORD("risk", ["Low", "Medium, higher than low", "High, higher than medium"]) },
  "Descriptions are comparative rather than absolute.");
legit("QBE004", "self_contained_severity", "ja", "tuning",
  { instructions: "この問題の深刻度を評価する。", output: ORD("severity", ["化粧上の問題のみで機能に影響しない", "機能は壊れているが回避策がある", "回避策がなく作業が止まる"]) },
  "各レベルが単独で状況を記述している。");
legit("QBE004", "self_contained_severity", "en", "tuning",
  { instructions: "Rate the severity of this issue.", output: ORD("severity", ["Cosmetic only; functionality unaffected", "Degraded feature with a workaround", "Blocking issue with no workaround"]) },
  "Every level describes a situation on its own.");
legit("QBE004", "self_contained_confidence", "ja", "eval",
  { instructions: "提示された証拠の強さを評価する。", output: ORD("evidence_strength", ["確信を持って判断できる", "一部に推測が含まれる", "入力だけでは判断できない"]) },
  "各レベルが独立して理解できる。");
legit("QBE004", "self_contained_confidence", "en", "eval",
  { instructions: "Rate the strength of the shown evidence.", output: ORD("evidence_strength", ["The evidence supports a confident judgment", "Part of the judgment relies on inference", "The inputs do not support a judgment"]) },
  "Levels stand alone.");

// --- eval2: fresh held-out batch, authored before the rule revision ----------
// 20 cases (15 defect, 5 legitimate), split "eval2". These are observed once
// after the rule pack is frozen for this iteration; they were authored before
// the tuning results of that revision were known.

defect("QSM001", "eval2_accuracy_tone", "ja", "eval2",
  { instructions: "この回答は正確で、かつ丁寧か。", output: BOOL("正確かつ丁寧。", "それ以外。") },
  "正確さと丁寧さは独立に変わり、合成規則がない。");
defect("QSM001", "eval2_minimal_complete", "en", "eval2",
  { instructions: "Is the patch minimal and complete?", output: BOOL("Minimal and complete.", "Otherwise.") },
  "Minimality and completeness are independent dimensions.");
defect("QSM001", "eval2_feasible_worthwhile", "ja", "eval2",
  { instructions: "この提案は実現可能で、費用対効果も高いか。", output: BOOL("実現可能かつ費用対効果が高い。", "それ以外。") },
  "実現可能性と費用対効果は独立に変わり得る。");
legit("QSM001", "eval2_explicit_both", "ja", "eval2",
  { instructions: "この差分に、依頼で明示された変更と無関係な変更の両方が含まれるか。true は両方を含む場合のみ。", output: BOOL("両方を含む。", "少なくとも一方を含まない。") },
  "両方という合成規則が明示されている。");

defect("QSM002", "eval2_understandable", "ja", "eval2",
  { instructions: "この説明は分かりやすいか。", output: BOOL("分かりやすい。", "分かりにくい。") },
  "「分かりやすい」の基準が定義されていない。");
defect("QSM002", "eval2_robust_enough", "en", "eval2",
  { instructions: "Is the error handling robust enough?", output: BOOL("Robust enough.", "Not robust enough.") },
  "\u201cRobust enough\u201d has no stated boundary.");
defect("QSM002", "eval2_reliable_tests", "ja", "eval2",
  { instructions: "このテストは信頼できるか。", output: BOOL("信頼できる。", "信頼できない。") },
  "「信頼できる」の水準が未定義。");
legit("QSM002", "eval2_exact_count", "ja", "eval2",
  { instructions: "true は、依頼文に記載された変更対象ファイルが1つだけの場合。false は0個または2個以上の場合。", output: BOOL("変更対象ファイルが1つ。", "0個または2個以上。") },
  "境界が数え方まで明示されている。");

defect("QSM003", "eval2_next_release", "ja", "eval2",
  { instructions: "この変更は、次のリリースで問題を起こすか。", output: BOOL("問題を起こす。", "起こさない。") },
  "interpret のまま将来のリリース挙動を求めている。");
defect("QSM003", "eval2_undocumented", "en", "eval2",
  { instructions: "Did the agent follow the team's undocumented conventions?", output: BOOL("It followed them.", "It did not."), evidenceBoundary: "The conventions are not provided. Use only the shown inputs." },
  "Required conventions are not among the declared inputs.");
defect("QSM003", "eval2_rejected_history", "ja", "eval2",
  { instructions: "この対応は、以前に却下された提案と同じ問題を含むか。", output: BOOL("同じ問題を含む。", "含まない。") },
  "却下された提案の記録が入力に存在しない。");
legit("QSM003", "eval2_predict_declared", "ja", "eval2",
  { mode: "predict", instructions: "この変更は、次のリリースで問題を起こすか。", output: BOOL("問題を起こす。", "起こさない。"), prediction: { targetRef: "outcome", horizon: "次のリリース時" } },
  "predict として宣言され、対象も契約に登録されている。");

defect("QSM004", "eval2_kind_boolean", "ja", "eval2",
  { instructions: "差分はどの種類の変更を含むか。", output: BOOL("種類がある。", "種類がない。") },
  "種類の選択を boolean で表そうとしている。");
defect("QSM004", "eval2_count_boolean", "en", "eval2",
  { instructions: "How many files does the change touch?", output: BOOL("It touches files.", "It touches none.") },
  "数量を boolean では記録できない。");
defect("QSM004", "eval2_unordered_ordinal", "ja", "eval2",
  { instructions: "変更の種類を判定する。", output: ORD("kind", ["バグ修正", "機能追加", "リファクタリング"]) },
  "順序のない種類を ordinal として宣言している。");
legit("QSM004", "eval2_boolean_scope", "ja", "eval2",
  { instructions: "差分に、依頼で許可されていない変更が含まれるか。", output: BOOL("許可されていない変更が含まれる。", "許可された範囲に収まっている。") },
  "yes/no の判断に boolean が合っている。");

defect("QBE004", "eval2_relative_ja", "ja", "eval2",
  { instructions: "この変更の影響を段階評価する。", output: ORD("impact", ["影響なし", "軽微（上の段階より大きい）", "重大（さらに大きい）"]) },
  "レベルが相対的な大小で記述されている。",
  { evidencePointer: "/questions/0/output" });
defect("QBE004", "eval2_previous_en", "en", "eval2",
  { instructions: "Rate the impact of this change.", output: ORD("impact", ["No change", "More than the previous level", "The most"]) },
  "Levels rely on the previous level for meaning.",
  { evidencePointer: "/questions/0/output" });
defect("QBE004", "eval2_rank_relative", "ja", "eval2",
  { instructions: "この変更をランク付けする。", output: ORD("rank", ["Aランク", "Bランク（Aより下）", "Cランク（Bより下）"]) },
  "ランクの説明が他ランクとの比較でしか成立しない。",
  { evidencePointer: "/questions/0/output" });
legit("QBE004", "eval2_self_contained_status", "ja", "eval2",
  { instructions: "この作業の状態を評価する。", output: ORD("status", ["未着手で作業は始まっていない", "作業中だが未完了", "完了して検証済み"]) },
  "各レベルが単独で状況を記述している。");

export const corpus = cases;
export const corpusSummary = {
  total: cases.length,
  defect: cases.filter(item => item.kind === "defect").length,
  legitimate: cases.filter(item => item.kind === "legitimate").length,
  tuning: cases.filter(item => item.split === "tuning").length,
  eval: cases.filter(item => item.split === "eval").length,
  eval2: cases.filter(item => item.split === "eval2").length,
  languages: ["ja", "en"],
  families: ["QSM001", "QSM002", "QSM003", "QSM004", "QBE004"],
};
