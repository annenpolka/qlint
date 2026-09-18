# qlint — Question Contract Checker

自然言語で定義された判定関数の **契約・観測可能性・backend適合性・挙動** を検査するための設計パッケージ。

**状態: v0.1の設計 + オフライン参照実装。lint / inspect / run（replay）/ screen（replay・dry-run）は動くが、製品版qlintコマンドではない。** 実Jevへの送信、probe、fuzzはまだない。名称は仮称。

## 読む場所

| ファイル | 内容 |
|---|---|
| `docs/design-v0.1.md` | 責務、型、欠損/棄権、診断、CLI、backend、再現性 |
| `docs/implementation-plan.md` | 実装順序と各段階の受入条件 |
| `src/contracts.ts` | QuestionSpec、StateContract、Binding、Diagnostic等 |
| `schemas/` | QuestionSuiteとDiagnosticのJSON Schema（正本。`validation/generate_contract_assets.py`が生成） |
| `src/static-checks.ts` | Schema検証済み入力への純粋な参照関係チェック |
| `src/lint-suite.ts` / `src/cli.ts` | 参照CLI（lint/inspect/run）の検査順序と入出力 |
| `src/locate.ts` | JSON Pointer → 元ファイルの行・列の解決 |
| `src/plan.ts` / `src/projection.ts` / `src/replay.ts` | 実行計画、per-question projection、replay runner |
| `src/adapter.ts` / `src/screening.ts` / `rules/screening-pack.json` | Jev応答の厳格な検証とsemantic screeningのmeta-question |
| `schemas/execution-plan.schema.json` | runが受理するplanの構造制約（digest付き） |
| `rules/catalog.json` | 33ルール。実装状態付き |
| `examples/` | 合成fixture。実データでも実モデル測定でもない |
| `SOURCES.md` | 設計時に確認した公式資料 |

## 動く範囲

TypeScript coreは未知参照、stage/lineage/gate循環、入力時点、target漏洩、選択肢ID、gate型/閾値、binding、roleを検査する。capabilityを渡した場合は出力型と候補数上限も検査する。親object selectorが別stageの登録済みfieldを含む場合はQCT004として報告する。

**文意は検査しない。** `semantic-ambiguity.suite.json`が静的チェックを通過しても、それは意味が正しいという結果ではない。reportはsemantic screeningが未実行であることを明示する。

### 参照lint CLI

```sh
node dist/cli.js lint examples/scope-monitor.suite.json
node dist/cli.js lint examples/target-leak.suite.json --format json
node dist/cli.js lint tests/fixtures/categorical.suite.json --capabilities tests/fixtures/capabilities-small.json
```

- 検査順は JSON parse → JSON Schema（QCT001）→ 参照関係（QCT002–QCT009）。Schemaを通らない入力には参照チェックを実行しない。
- 診断は元ファイルの `file:line:column` と JSON Pointer を持つ。行・列は1始まり。
- 実行しなかった検査は coverage に `not_run` として残り、passとunknownを混同しない。
- exit code: `0` lintが実行する検査の完了・違反なし、`1` 契約/Schema違反、`2` 引数・I/O・設定の失敗。`3` はprofile実行用に予約（lintは使わない）。
- lintが実行する必須検査はlint phaseのものだけである。semantic screening等が未実行でもexit 0になり得るが、その事実はreportの `coverage` / `notExecuted` / `note` に必ず表示される（`docs/design-v0.1.md` section 8 の実装メモ）。
- network、API key、model呼び出しは使わない。

### inspect と run（replay専用）

```sh
node dist/cli.js inspect examples/scope-monitor.suite.json --out plan.json
node dist/cli.js run plan.json --cases cases.jsonl --replay recorded.jsonl --format json
```

- `inspect`は質問ごとのprojectionを確定する。payloadに入るのはその質問の `inputs` と `policyRefs`（承認済み文書として別枠）だけで、他のfield（評価ラベルを含む）は `excludedFieldIds` に列挙される。input集合のunionを全質問へ流さない。
- planは `sensitivity: restricted` のfieldをデフォルトで拒否し、`--allow-restricted` を要求する。`--max-requests` / `--max-bytes` / `--max-tokens` は根拠つきでplanに記録される。
- planとrun reportは内容のSHA-256 digestを持ち、時刻や環境に依存しない。`run`はdigest不一致のplanを拒否する（exit 2）。
- `run`はplanの全質問×全caseをprojectionし、`requestDigest = sha256(canonical({questionId, atStage, inputs, policyRefs}))` でrecorded responseを照合する。欠損/null/型はprojectionで検出し、欠損・nullはabstain、型違反はinvalidとして送信しない。
- 記録が無いrequestは `not_run` のまま残し、exit 3（判定保留）。invalidがあればexit 1。全部replayできればexit 0で、同じ入力の2回実行はバイト単位で一致する。
- adapter normalization、gate runtime、live providerは実装していない。runはnetworkへ出ない（`requestsSent: 0`）。

### screen（semantic screening）

```sh
node dist/cli.js screen examples/scope-monitor.suite.json --dry-run
node dist/cli.js screen examples/scope-monitor.suite.json --replay recorded-signals.jsonl --format json
```

- `--dry-run`は送信予定のmeta-questionを表示するだけ。networkへ出ない。
- 質問ごとに1リクエスト、適用可能なルール（QSM001–QSM004、QBE004）ごとに applicability / sufficiency / violation の3つのNoul質問をまとめる。
- stateに載るのは質問文・criteria・入出力の宣言（field名/pointer/型）だけ。**fieldの値、正解ラベル、期待診断は送らない。** policyRefsの値も送らず、記述子だけを送る（未実装項目としてreportに明記）。
- `src/adapter.ts`がJev応答（Noul/Choice/Score）を厳格に検証する。候補の欠落・余剰、確率の範囲外・非有限、合計が許容誤差（1e-6）を超える分布、scoreと確率分布の不一致、未知フィールドはすべてmalformedとして報告し、**黙って補正・再正規化しない**。
- 閾値は`screening-reference-v0.1`（applicability>=0.8, sufficiency>=0.8, signal>=0.5）としてreportに記録される。**未校正の既定値**であり、検証データで決めるまでの仮置き。
- 診断はrule engineがrule packから組み立てる`model_signal`（warning）。モデルの自由文は診断にならない。severityは`--fail-on-signal`を明示しない限りCIを落とさない。
- exit code: malformed応答あり→2（backend/検査器の障害。質問の不良とはしない）、`--fail-on-signal`でsignalあり→1、記録不足→3（判定保留）、それ以外→0。

## オフラインの試験

`dist/`は同梱済みなので、Node.jsから次をそのまま実行できる。

```sh
node --test tests/*.test.mjs
```

ビルドとSchema↔契約型の整合性検査を含む全体は次で実行する。検証時はNode v26.0.0 / TypeScript 5.8.3を使用した。

```sh
npm install
npm test
```

`npm test`は build → `scripts/generate-contract-types.mjs` でSchemaから型を生成し `src/contracts.ts` との双方向assignabilityをtscで検査 → node:test の順に実行する。Schemaを変えて手書き型が追随しなければ `npm run test:types` が失敗する。

JSON Schemaのfixture検証:

```sh
python3 -m pip install -r validation/requirements.txt
python3 validation/check_contracts.py
```

このbundleでの検証結果はテスト80件、Schema検証23件、型整合性検査、いずれも失敗0件。`validation/`に結果を収録。

## ライブラリ利用例

```js
import { lintValidatedSuite } from './dist/static-checks.js';

// 必須: unknown JSONを先にschemas/question-suite.schema.jsonで検証する。
// この関数自体はJSON Schema validatorではない。
const report = lintValidatedSuite(schemaValidatedSuite);
console.log(report.diagnostics);
console.log(report.notExecuted);
```

入力を変更しない純粋関数。network、API key、filesystemを使わない。CLI（`dist/cli.js`）がSchema validatorを入力境界へ配置し、Diagnosticの locations に元ファイルの行・列を付ける。

## 重要な境界

`false` / `abstained` / `not_applicable` / `error`を分ける。`static_proof` / `model_signal` / `empirical_witness`も分ける。severityを上げても証拠の種類は変わらない。

判定が役に立つかはFeature CompilerやWardenが決める。qlintは判定を実行してよいか、どの契約やテストで問題が見つかったか、何をまだ調べていないかを返す。

`inspect`（replay用plan生成）、`run`（replay実行）、`screen`（replay・dry-run）は参照実装がある。`probe/fuzz/diff`とlive provider実行（実Jevへの送信）は設計書の提案であり、このbundleでは実行できない。

## ライセンス

MIT。`LICENSE` を参照。
