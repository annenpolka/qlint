# qlint — Question Contract Checker

自然言語で定義された判定関数の **契約・観測可能性・backend適合性・挙動** を検査するための設計パッケージ。

**状態: v0.1の設計 + オフライン参照実装。参照lint CLIは動くが、製品版qlintコマンドではない。** Jev API接続、semantic screening、probe、fuzzはまだない。名称は仮称。

## 読む場所

| ファイル | 内容 |
|---|---|
| `docs/design-v0.1.md` | 責務、型、欠損/棄権、診断、CLI、backend、再現性 |
| `docs/implementation-plan.md` | 実装順序と各段階の受入条件 |
| `src/contracts.ts` | QuestionSpec、StateContract、Binding、Diagnostic等 |
| `schemas/` | QuestionSuiteとDiagnosticのJSON Schema（正本。`validation/generate_contract_assets.py`が生成） |
| `src/static-checks.ts` | Schema検証済み入力への純粋な参照関係チェック |
| `src/lint-suite.ts` / `src/cli.ts` | 参照lint CLIの検査順序と入出力 |
| `src/locate.ts` | JSON Pointer → 元ファイルの行・列の解決 |
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

このbundleでの検証結果は静的テスト47件、Schema検証19件、型整合性検査、いずれも失敗0件。`validation/`に結果を収録。

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

`inspect/run/probe/fuzz/diff`等のCLIは設計書の提案であり、このbundleで実行できるのは `lint` だけである。

## ライセンス

MIT。`LICENSE` を参照。
