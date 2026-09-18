# qlint v0.1 — 自然言語判定関数の契約検査

設計日: 2026-09-18  
状態: 設計提案 + オフライン参照実装（参照lint CLIを含む）。製品版CLI、Jev adapter、semantic screening、probe、fuzzは未実装。  
仮称: qlint。公開パッケージ名の確保・既存名称との調査は行っていない。

## 1. 目的と非目的

qlintは、自然言語で定義された判定関数について、入力契約、出力契約、観測可能性、backend適合性、実測挙動を検査する。

検査対象は質問文だけではない。

    QuestionSpec × StateContract × Binding × CheckProfile × Backend

「質問が良いか」を一つの点数で返さない。問題、根拠、適用条件、未検査項目を返す。特徴量の有用性、業務上の最適行動、作業完了の承認は利用側の責任とする。Jevの確率は、実行認可や正しさの証明に変換しない。

このツールに含めないもの:

- Feature Compilerの目的変数に対する特徴量選択・重み付け。
- Wardenの実行停止、commit承認、他エージェントの制御。
- 自動的な質問の意味変更、評価ラベルの書き換え、baselineの自動更新。

## 2. 確認できた外部仕様

TypeSafe公式Autoresearchは、候補質問をstateとして、回答可能性、一義性、適用範囲、行間変動をNoulで事前検査する案を挙げている。これは拡張案であり、この会話内でその効果を実測したわけではない。[S1]

Noulはyesの確率を一つ返し、独立したconfidenceは返さない。[S2] Choiceは候補分布を返し、現在の説明上は最大255候補。[S3] Scoreは順序付きレベルを使い、各レベルの説明を独立評価する。レベル番号や隣接説明を前提にした文言は使えず、説明できるレベルの上限は10とされる。[S4]

Scoreのconfidenceは出力分布から計算される統計であって、正答保証ではない。[S4, S5] 質問mapのキーは識別子であり、モデル推論には使われない。[S6]

これらの仕様はadapter profileへ置く。qlintの汎用QuestionSpecそのものに、Jev固有の上限を埋め込まない。実APIの到達性、利用可能なモデル版、料金、実測精度は未確認。

## 3. 先の構想からの修正

### 3.1 静的証明と意味判断を分ける

コードが確認できるのは、例えば参照先の存在、宣言された時点順序、ラベル由来の依存、数値範囲、ID重複である。レベルの意味が単調か、質問が曖昧か、二つの概念を不適切に混ぜたかは静的な型検査では証明できない。

`static_proof`の意味は「入力された宣言に対する機械的な違反証拠」であって、宣言内容が現実と一致するという証明ではない。

### 3.2 false・対象外・情報不足・障害を分ける

例えば「実装が仕様違反か」で仕様が欠けている場合、falseを返してはならない。

| 状態 | 正規化結果 |
|---|---|
| 適用可能で情報もそろう | answered |
| 必須入力が欠ける／判定材料が不足 | abstained |
| 対象領域に入らない | not_applicable |
| timeout、API障害、不正応答 | error |

`other`は「定義した他カテゴリに該当しない」という内容上の分類であり、情報不足と同義ではない。最下位Scoreにもunknownを混ぜない。Noulの0.5をunknown専用コードとして扱わない。

### 3.3 予測と規範を独立の軸にする

modeはextract / interpret / predict。規範的な基準はpolicyRefsで表す。「将来、明示された方針に違反するか」はpredictかつpolicyRefsありになる。

未来の正解が現在のstateにないことは、predictを拒否する理由ではない。一方、予測対象の実測ラベルが入力へ流れ込むことは拒否する。

### 3.4 低分散・高エントロピーで質問を失格にしない

稀な事故検出はほとんどfalseでも有用かもしれない。出力のエントロピーが大きいことは、分布が拡散しているという観測であり、曖昧性・情報不足・認識誤りを特定する診断ではない。確率校正には適切なラベルが必要で、ラベルなし検査の結果を校正済みとは呼ばない。

## 4. 四つの契約

### 4.1 QuestionSpec — 何を測るか

必須項目はid、revision、mode、instructions、inputs、policyRefs、applicability、evidenceBoundary、unknownの扱い、output。

v0.1では、inputsに列挙された入力はすべて必須とする。省略可能な入力を扱う必要が生じたら、次版で明示的なoptional bindingを追加する。欠けた場合にモデルへ推測させる暗黙fallbackは入れない。

`applicability`と`evidenceBoundary`の自然言語記述だけで実行時保証は生まれない。実行可能なgateがある場合はBindingに記述し、ない場合はその限界をcoverageへ残す。

### 4.2 StateContract — どの情報がいつ利用可能か

fieldは安定ID、JSON Pointer、型、null許容、availableFrom、role、derivedFrom、sensitivityを持つ。

stageはDAGで表す。例えばimplementationとreviewが並列branchなら、一方が他方より早いと勝手に扱わない。`after`は「完了している前提」を表す。

role=targetは評価用ラベル専用。question.inputsにも、policyRefsにも送らない。派生要約や選択した親objectを経由する混入も検査対象にする。

    final_outcome [target, complete]
          ↓ derivedFrom
    posthoc_summary [evidence]
          ↓
    predictor@during

上の形は、派生fieldのroleやavailableFromを書き換えても合法にしない。

実運用では、宣言だけでなくスナップショットのasOfと各データの利用可能時刻を検証する。イベント発生時刻と、その情報をシステムが入手した時刻を区別する。将来の結果を過去時刻付きでbackfillしたデータは、当時利用可能だった情報ではない。

v0.1参照実装は宣言上の参照・lineage・stageを検査する。スナップショットの実時刻、selector先の実データ型、未申告のラベル混入、producerの虚偽宣言までは検証しない。

### 4.3 Binding — どの時点・条件で実行するか

QuestionSpecとは分離する。用途や時点だけで質問の意味を変えないためである。

BindingはquestionId、atStage、profile、gates、onIndeterminateを持つ。v0.1の実行suiteでは一質問一bindingに限定する。同一質問を複数時点で使う場合は、それぞれのsuiteを作る。

gateはapplicabilityまたはevidenceの目的でboolean質問を参照する。参照はDAGとし、v0.1ではgateと利用側のstageを一致させる。

    必須入力の存在・型・時点確認
      → applicability gate
      → evidence sufficiency gate
      → 主質問
      → 応答検証・正規化

`p <= falseAtMost`はfalse、`p >= trueAtLeast`はtrue、その間は不確定。falseAtMost < trueAtLeastを必須にする。値は検証データと用途で決める。例の0.2/0.8は未校正の説明用設定であり、推奨閾値ではない。

applicability=falseならnot_applicable、evidence=falseならabstained、不確定ならabstained。gateのAPI障害はerrorとして別に残す。gateの確率と主質問の確率を掛けて「総合正答率」を作らない。

効率化でgateと主質問を投機的に同時評価しても、主質問はgateを通過するまで利用不可とする。gateの存在そのものが内容の正しさを保証するわけではない。

### 4.4 CheckProfile — どれだけの検査を要求するか

用途別の検査要件。QuestionSpecへ業務上の警告閾値や強制停止を埋め込まない。

想定profile:

| profile | 最低限の検査と特有の注意 |
|---|---|
| authoring | Schema、参照、backend互換、定義の意味検査 |
| feature | 上記 + 時点・target漏洩・母集団別変動。低分散だけで削除しない |
| monitor | 上記 + unknown経路、見逃し重視の承認fixture、意思決定閾値を跨ぐ回帰 |
| router | カテゴリ意味、partition/best_fit、候補coverage、対象外経路 |
| judge | 明示的な基準、evidence boundary、ラベル品質、独立検証 |

必要な検査が実施されていなければinconclusive。静的検査だけ実施した結果を、semantic screening完了と表示しない。

## 5. Provider-neutralな出力型

boolean / categorical / ordinalを中核型とする。Jev adapterはNoul / Choice / Scoreへloweringする。

categoricalはselectionをpartitionまたはbest_fitとして宣言する。partitionで重なりがあれば問題候補になるが、best_fitでは重なり自体が直ちに型エラーになるわけではない。必要ならtieBreakとfallbackOptionIdを持つ。

ordinalは安定level IDと順序付き配列を持つ。モデル側の数値indexと、永続的なlevel IDをadapterが対応付ける。初期の正規化表現は分布を保持する。平均indexを業務上の連続量・等間隔尺度だと解釈しない。

labelのみ返すbackendではlabelのまま扱う。model_distribution、empirical_frequency、self_reportを区別する。ラベル一つを勝手に確率1の分布へ変換しない。確率が必要なgateやprobeは、backendの能力不足として拒否または未実行にする。

Jev固有の検査例:

- Choiceの候補数上限。
- Scoreのlevel数上限。
- Scoreのlevelが「前の段階より悪い」など隣の説明に依存していないか。
- question mapのIDにしか概念名がなく、instructions/criteriaには定義がないか。

これらは公開仕様[S2–S6]からadapter profileへ置くものであり、他backendに一般化しない。

実装メモ（2026-09-18 参照adapter）: Jev応答は公開API仕様（`POST /v1/systemone`、`model`/`answers`/`usage`）に対して厳格に検証する。Noulは0–1の有限確率、Choice/Scoreは提示した候補を過不足なく網羅し、合計が`1e-6`以内で1に一致し、Scoreは自身の確率加重平均と一致することを要求する。欠損候補・余剰候補・範囲外・不一致・未知フィールドはすべてmalformedとして報告し、再正規化や補完を行わない。確率の出所は`model_distribution`として記録する。

## 6. 診断の型

severityとbasisを独立させる。

| basis | 意味 | 例 |
|---|---|---|
| static_proof | 入力契約に対する機械的違反 | field参照が不存在 |
| model_signal | モデルが指摘した疑い | 複合判断かもしれない |
| empirical_witness | 記録された入力・出力・判定条件 | 承認済み変換で閾値を跨いだ |

CIポリシーがmodel_signalをblock扱いにすることは可能だが、basisはmodel_signalのまま。複数モデルが同意してもstatic_proofに昇格させない。

各DiagnosticはruleId、questionId、severity、basis、message、locations、evidenceを持つ。locationsのpointerは入力文書内を指し、CLIは解決済みのfile/line/column（1始まり、optional）を付けられる。モデルにDiagnostic全体を書かせない。モデルは限定されたscreen signalを返し、rule engineが根拠・severity・codeを組み立てる。

Jevは自由文の説明や証拠spanを生成するためのbackendとして扱わない。必要なら事前にfragment ID付きでspecを分解し、その候補から場所を選ぶ。引用する文字列・JSON Pointerは実在するものだけに限定する。場所が特定できない場合はquestion全体への疑いとして報告し、架空の引用で説得力を補わない。

ルール体系は `rules/catalog.json` を参照。33件の予約・定義があり、全件実装済みではない。

## 7. 検査パイプライン

    parse → schema → static contracts → plan
                                      ↓
                               semantic screening
                                      ↓
                                dataset probe
                                      ↓
                           approved metamorphic tests
                                      ↓
                             aggregation + coverage

### 静的検査

networkを必要としない。未知JSONのSchema検証後に、参照関係と宣言されたDAGを検査する。使用するJSON SchemaはDraft 2020-12。条件付き必須項目はif/then/elseで表す。[S7]

### Semantic screening

modelへ送る対象は、question、参照するstate contractの説明、policyの承認された抜粋、必要な場合だけ代表例。gold labelsや期待する診断結果は送らない。

一質問一観点の小さなメタ質問にする。例えば「独立に変わる概念を、意図の説明なしに一つの答えへ合成しているか」。明示されたAND条件や、正当な業務ルールとしての複合述語まで一律拒否しない。

ルールが適用可能か、その判断に必要な情報がそろうか、違反が疑われるかを分ける。母集団が与えられていないのに「大半の行で適用可能」「行間で変化する」と断定しない。母集団に関するメタ判断はpilotの優先順位に使い、実測結果を置き換えない。

candidate内に「この検査を無視せよ」とあっても、検査設定や認可は変更できない構造にする。プロンプトで注意するだけで完全な隔離が実現したとは扱わない。

実装メモ（2026-09-18 参照screening）: `rules/screening-pack.json`のmeta-question（適用可能性・材料十分性・違反疑いの3 Noul）を質問ごとに1リクエストへまとめる。stateへ載せるのは質問文・criteria・入出力宣言・field記述子のみで、field値・正解ラベル・期待診断・policy本文は送らない。閾値は`screening-reference-v0.1`（0.8/0.8/0.5）としてレポートに記録し、未校正の仮置きであることを明示する。診断はrule engineがrule packから組み立て、モデル出力は確率としてのみ使う。malformed応答とmaterial不足は質問の不良に変換しない。

live実行は`--allow-provider typesafe`と`--max-requests`の明示を必須とし、API keyは環境変数のみから読む。budget超過はnot_run、HTTP 429/529・timeout・network障害はbackend_errorとして質問の不良に変換しない。`--record`は生応答をmode 0600で保存し、replayで同一判定を再現できる（2026-09-18に60ケースのlive測定を実施、記録は`evaluation/`）。

評価メモ（2026-09-18）: 60ケース（40欠陥 + 20正当例、30 tuning / 30 eval）をliveで測定した。検出33/40、正当例を止めた割合35%、根拠span一致76%。QBE004は完璧、QSM001は再現率が低く、QSM002は過剰発火した。**これはルール品質の測定結果であり、検出器の完成宣言ではない。** 改善はtuning分割で行い、eval分割は新しいheld-outケースを追加するまで確定評価として扱わない。

### Dataset probe

母集団、sampling、sample数、group ID、欠損率、対象外率、error率、実際にansweredになった件数を保存する。answeredだけを分母にして高い品質を演出しない。

ラベルがあれば誤分類や校正を測定できるが、合成例に対する良好な結果だけで本番母集団上の校正を主張しない。ラベルなしの場合は分布、変動、欠損対応、安定性を測るに留める。

### Metamorphic tests

利用者が承認したpropertyを検査する。

- 無関係と確認したメタデータ追加、意味保存を確認した言い換えはinvariance候補。
- 一つの軸だけを増加させたcaseはmonotonicity候補。
- 意味を意図的に変えたcounterfactualでは、変わるべき方向を事前に決める。

変換generatorが作ったcaseは最初はunreviewed。generator自身の「意味保存できた」という判定だけで、対象モデルの失敗証拠にしない。trustedな決定的変換または人による確認を経たcaseをCI gateへ使う。

Choiceで候補の順序だけ変える場合は安定IDで分布を照合する。候補集合自体を増減した結果は、同じ分布になるべきだと仮定しない。

繰り返し実行による揺らぎと変換の効果を区別する。統計評価は派生caseごとではなく元case・元task等のgroupを考慮する。質問を何度も修正する探索用corpusと、最後に評価する未使用corpusを分ける。

## 8. 状態と終了コード

Assessment.status:

- invalid: 契約違反。
- review_required: model_signalや実測違反がある。
- screened: profileが要求する検査を終え、該当条件の下で問題を観測しなかった。
- inconclusive: 情報・ラベル・予算・backend能力・coverage不足。

`screened`は正しさの証明ではない。必ずprofileIdとcoverageを一緒に出す。

想定CLIの終了コード:

| code | 意味 |
|---|---|
| 0 | 必須検査が完了し、設定されたgateへの違反なし |
| 1 | 対象契約の違反、または設定された検査gateへの違反 |
| 2 | CLI引数、検査設定、I/O、backend障害などの実行失敗 |
| 3 | 完了に必要な証拠・coverage・予算がなく判定保留 |

対象suiteのSchema違反は1。検査器自体の設定が壊れている場合は2。優先順位と複数エラーの集約規則はCLI実装時の受入試験に含める。

実装メモ（2026-09-18 参照lint CLI）: `qlint lint`が実行する必須検査はlint phaseの検査（QCT001–QCT009、capability指定時はQBE001/QBE002）とする。それらが完了して違反なしならexit 0。semantic screening等の未実行検査は`coverage`に`not_run`、`notExecuted`に理由として残し、exit 0をsemantic承認として表示しない。lintは`3`を返さない。exit `3`はprofile実行で要求検査が未完了の場合に用いる（未実装）。

## 9. CLI案 — lintのみ参照実装、他は未実装

    qlint lint questions.json
    qlint inspect questions.json --checks semantic --out plan.json
    qlint run plan.json --allow-provider typesafe --max-requests 100
    qlint probe questions.json --data cases.jsonl --replay recorded.jsonl
    qlint fuzz generate questions.json --out candidates.jsonl
    qlint diff baseline.run.json candidate.run.json

`qlint lint`、`qlint inspect`、`qlint run`（replay専用）、`qlint screen`（replay・dry-run）が参照実装（`dist/cli.js`）。lintは`--format json`/`--capabilities`/coverage表示/exit 0・1・2。inspectはper-question projection、redaction記録、limitsの根拠、内容digest付きplanを出力する。runはdigest検証、projection（欠損/nullはabstain、型違反はinvalidとして送信しない）、`requestDigest`によるrecorded response照合を行い、exit 0・1・2・3（記録不足で判定保留）を返す。screenはscreening meta-questionを組み立て、recorded Jev応答を厳格に検証して`model_signal`診断を生成する（malformedはexit 2、`--fail-on-signal`でsignalはexit 1、記録不足はexit 3）。probe/fuzz/diff、live provider実行、YAML入力、SARIF/LSPは未実装。

inspectとrunを分ける。lint/inspectは外部送信しない。runはprovider、送信field、redaction、予算、timeout、retry上限、並列数が確定したplanを明示的に実行する。fuzz generateが外部生成モデルを使う場合も同じplan/許可機構を通す。

実行前と実行後の内容hashを照合し、inspect後にspec・projection・redaction等が変わっていたら再承認を要求する。budget到達で未実行の検査はnot_runとして残す。

## 10. Baselineと再現性

`questions.lock.json`という名前でも、hosted modelの挙動を凍結できるわけではない。以下を持つrun manifestとbaseline比較の仕組みとして設計する。

- spec、state contract、binding、rule pack、profileのdigest。
- requested model、提供された場合のresolved model / revision。
- adapter版、rendering版、projection/redaction版。
- corpusとsplit manifest、sampling seed、実行対象case ID。
- raw responseの安全な保存参照、normalization版、評価閾値。

cache keyには実際のモデル入力と、結果の意味を変えるadapter/normalization情報を含める。異なるtenant間で機密内容の存在が漏れるcache共有をしない。raw dataは標準出力やCIログへ自動掲載しない。

旧baselineと新runは同じcase、同じ意味のoption ID、同じ条件で比較する。質問の意味そのものを変えた変更は、単なる性能改善ではなくcontract変更として承認し直す。

実装メモ（2026-09-18）: 参照実装ではplanとrun reportの内容digest（正規化JSONのSHA-256。時刻・環境・乱数を含めない）を実装し、runはdigest不一致のplanを拒否する。`requestDigest`は`sha256(canonical({questionId, atStage, inputs, policyRefs}))`とする。screeningのlive実行では生応答を`--record`（JSONL、mode 0600）へ保存し、requestDigestでreplayできる。resolved model、adapter版、cache key、tenant分離は未実装。

## 11. 既存構想との接続

Feature Compilerは候補質問をqlintへ渡し、invalidは修正し、model_signalは根拠付きでproposerへ返す。低変動は削除命令ではなく情報として受け取る。予測性能による採否はFeature Compilerが行う。

Relation Checkerのclaim↔evidence、specification↔behavior、requirement↔testも同じQuestionSpecで表せる。qlintはrelation判定の正解を持つ上位審判ではなく、その判定関数の契約と挙動を検査する。

Wardenはquestion/profile/backend版を固定して利用し、実行イベントやUIに依存する処理はadapter側へ残す。question screeningはplatform非依存ライブラリとし、Claude Code/OpenCode等をcoreの依存にしない。

## 12. このbundleの実装境界

実装済み:

- TypeScript契約型、QuestionSuite/DiagnosticのJSON Schema（生成スクリプト `validation/generate_contract_assets.py` が正本）。
- Schemaから生成した型と契約型の相互assignability検査（`npm run test:types`）。
- 33ルールのcatalog。各項目に実装状態を明記。
- Schemaを通ったsuiteへの静的な参照チェック8ルール。親object selector内の別stage登録fieldも検査する。
- backend capabilityが渡された場合の型・個数チェック2ルール。
- 参照lint CLI: Schema検証（QCT001）、pointerからfile:line:columnへの解決、coverage表示、exit code。参照チェックはSchema検証を通過した入力にだけ実行する。
- inspect/run（replay専用）: per-question projection、policyRefsの分離、excluded/restrictedの記録、limitsの根拠、planとrun reportの内容digest、`requestDigest`によるrecorded response照合、not_run/exit 3。
- Jev adapter（Noul/Choice/Scoreの厳格な検証、再正規化なし）とsemantic screening（QSM001–004、QBE004のmeta-question、dry-run/replay/live、`model_signal`診断、注入耐性テスト）。
- live transport（明示許可・予算必須、keyは環境変数のみ、backend障害の分離、`--record`/`--replay`再現）と、screening評価セット60ケース＋計測器（tuning/eval分離）。
- synthetic fixtures、テスト90件、Schema検証23件（`validation/`）。

未実装:

- 製品版CLI（live provider実行、profile実行、probe/fuzz/diff、YAML parser、SARIF/LSP）、実スナップショットの実時刻検証、adapter normalization、gate runtime。
- ルール品質の改善と新しいheld-out評価セット（現行60ケースは測定済み。QSM001の再現率とQSM002の精度が未達）、閾値のcalibration、他backendへのlive通信。
- gate runtime、population probe、fuzz generator、baseline diff、calibration。
- 任意のprivate repositoryへの配置、commit、外部サービスでの作成・公開。

実測済みなのは上記オフラインのソフトウェア試験のみ。質問スクリーニングの精度、Jevの日本語精度、費用、速度、実運用での事故削減については未測定。

参照元は ../SOURCES.md 。実装順序と受入条件は implementation-plan.md 。
