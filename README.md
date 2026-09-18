# qlint — Question Contract Checker

自然言語で定義された判定関数の **契約・観測可能性・backend適合性・挙動** を検査するための設計パッケージ。

**状態: v0.1の設計 + オフライン参照実装。製品版qlintコマンドではない。** Jev API接続、semantic screening、probe、fuzzはまだない。名称は仮称。

## 読む場所

| ファイル | 内容 |
|---|---|
| `docs/design-v0.1.md` | 責務、型、欠損/棄権、診断、CLI、backend、再現性 |
| `docs/implementation-plan.md` | 実装順序と各段階の受入条件 |
| `src/contracts.ts` | QuestionSpec、StateContract、Binding、Diagnostic等 |
| `schemas/` | QuestionSuiteとDiagnosticのJSON Schema |
| `src/static-checks.ts` | Schema検証済み入力への純粋な参照関係チェック |
| `rules/catalog.json` | 33ルール。実装状態付き |
| `examples/` | 合成fixture。実データでも実モデル測定でもない |
| `SOURCES.md` | 設計時に確認した公式資料 |

## 動く範囲

TypeScript coreは未知参照、stage/lineage/gate循環、入力時点、target漏洩、選択肢ID、gate型/閾値、binding、roleを検査する。capabilityを渡した場合は出力型と候補数上限も検査する。

**文意は検査しない。** `semantic-ambiguity.suite.json`が静的チェックを通過しても、それは意味が正しいという結果ではない。reportはsemantic screeningが未実行であることを明示する。

## オフラインの試験

`dist/`は同梱済みなので、Node.jsから次をそのまま実行できる。

```sh
node --test tests/*.test.mjs
```

TypeScriptの再ビルドは次のとおり。検証時はNode v22.16.0 / TypeScript 5.8.3を使用した。

```sh
npm install
npm test
```

JSON Schemaのfixture検証:

```sh
python3 -m pip install -r validation/requirements.txt
python3 validation/check_contracts.py
```

このbundleでの検証結果は静的チェック23件、Schema検証15件、いずれも失敗0件。`validation/`に結果を収録。

## ライブラリ利用例

```js
import { lintValidatedSuite } from './dist/static-checks.js';

// 必須: unknown JSONを先にschemas/question-suite.schema.jsonで検証する。
// この関数自体はJSON Schema validatorではない。
const report = lintValidatedSuite(schemaValidatedSuite);
console.log(report.diagnostics);
console.log(report.notExecuted);
```

入力を変更しない純粋関数。network、API key、filesystemを使わない。JSONの外部境界にSchema validatorを組み込むことは製品CLIの実装計画に含む。

## 重要な境界

`false` / `abstained` / `not_applicable` / `error`を分ける。`static_proof` / `model_signal` / `empirical_witness`も分ける。severityを上げても証拠の種類は変わらない。

判定が役に立つかはFeature CompilerやWardenが決める。qlintは判定を実行してよいか、どの契約やテストで問題が見つかったか、何をまだ調べていないかを返す。

`inspect/run/probe/fuzz/diff`等のCLIは設計書の提案であり、このbundleで実行できるコマンドではない。

## ライセンス

MIT。`LICENSE` を参照。
