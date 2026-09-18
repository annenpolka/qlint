# 実装計画と受入条件

進捗（2026-09-18）: 第0節の型整合性検査を導入（`npm run test:types`）。第1節の参照lint CLIを実装（JSON Schema検証、元ファイル位置、coverage、exit 0/1/2）。第2節のinspect/plan・projection・replayを実装（plan digest固定、recorded response照合、networkなし、projection golden tests）。第3節のJev adapterと最小semantic rule pack（QSM001–004、QBE004）を実装し、live transport（明示許可・予算必須・key環境変数・backend_error分離・record/replay）まで接続した。第4節の評価セット60ケース（40欠陥 + 20正当例、30 tuning / 30 eval）と計測器を実装し、live測定を1回実施した（検出33/40、正当例停止35%、span一致76%）。ルール品質の改善と新しいheld-outケース、YAML parser、SARIF/LSPが次の作業。

## 0. 既にあるものを正本にする

構造制約の正本はschemas/以下。src/contracts.tsは対応するTypeScript表現。現時点では手動対応なので、Schema→TypeScript生成か型整合性テストを本体開発の最初に導入し、二重管理を恒久化しない。

参照実装lintValidatedSuite()は事前Schema検証を要求する純粋関数。未検証のJSONをas QuestionSuiteでcastして呼ぶ製品CLIにはしない。

## 1. CLIと静的契約検査

TypeScriptのcoreを維持し、JSON Schema validatorを入力境界へ配置する。JSONを先行し、YAMLはAST位置情報・重複key拒否・alias/サイズ制限を備えたparserを後から追加する。

受入条件:

- 有効/無効のfixture、unknown field、stage/lineage/gate循環をテストする。
- Schema違反と参照違反を元ファイル位置へ対応付ける。
- lintは鍵やnetworkなしで動き、semantic検査未実行を隠さない。
- 必要な前提がない場合にpassとunknownを混同しない。
- target selectorの祖先・子孫・派生元を経由する漏洩を拒否する。
- 親object selectorに、別stageの登録済みfieldが含まれるケースを追加検査する。未登録の隠れたデータまで静的検査が保証するとは主張しない。

成果物: lintコマンド、JSON diagnostics、coverage表示。SARIFやLSPは次段階。

## 2. Inspect/plan、projection、replay backend

外部通信より先に、モデルへ渡る最小stateを確定する。inputの欠損、null、型、時点、roleを検証し、policyRefsを承認済み文書として別に扱う。

受入条件:

- golden labels、lineage上のtarget、golden expected diagnosticsがモデルpayloadに入らない。
- 質問ごとに許可されたprojectionが異なる場合、入力集合のunionを全質問へ流さない。
- inspectでrequest数、field名、provider、redaction、token/byte上限の根拠を表示する。
- runが受理するplanはdigestで固定され、内容変更を検出する。
- recorded responsesを用いたreplayがnetworkなしで再現する。

成果物: 実行計画、projection golden tests、replay runner。まだ本番モデルは不要。

## 3. Jev adapterと最小semantic rule pack

Jev adapterはboolean→Noul、categorical→Choice、ordinal→Scoreをloweringする。model IDやAPI仕様は実装時点の公式資料で再確認する。

最初に実装するsemantic rules:

1. QSM001 compound-judgment
2. QSM002 underspecified-boundary
3. QSM003 unobservable-as-declared
4. QSM004 primitive-mismatch
5. QBE004 context-dependent-level

受入条件:

- 返却確率が有限、範囲内、必要な候補を網羅し、許容誤差内で正規化されていることを検査する。
- malformed responsesを黙って補正・renormalizeしない。許す補正は明示したadapter policyと記録付きに限定する。
- native分布とLLMの自己申告数値、labelのみの応答を区別する。
- 指摘はmodel_signalであり、根拠のない自由文説明を出さない。
- candidateに検査回避命令が入ったfixtureで、認可や出力Schemaを変更できないことを確認する。
- backend timeout/429/budget超過を、対象questionの不良と判定しない。

成果物: inspect→許可されたJev実行→根拠付き診断。precision等は未使用の評価caseで別に測定する。

## 4. Screening自体の評価セット

最初の提案目標は60ケース。件数は統計的な十分性の保証ではなく、実装時のカバレッジ目標。

- 6欠陥family × 8例 = 48例。
- 一見似ているが正当な例12例。明示的AND、source_onlyとpredictの違い、best_fitの重なり、稀な事故検出など。
- 日本語と英語を含め、言い換え由来のcaseを同じgroupへ束ねる。
- expected diagnostics、許容される代替診断、判定不能例、根拠spanを人が確認する。

取得する指標:

- rule別precision/recallとunknown率。
- 正当な質問を止めた割合。
- 誤りを検出していても、示した根拠spanが正しいか。
- 実行失敗、coverage、API usage、latency。

閾値調整用caseと最終評価用caseを分離する。検査器自身が生成したcaseで、検査器自身に採点だけさせて精度向上を宣言しない。

## 5. Probe → fuzz → diff

まず実データの欠損/適用範囲/出力分布を測り、その次に承認済みの変換caseを追加する。最後に同一corpus上の比較をCLIへ出す。

受入条件:

- labelなしでaccuracy/calibrationを表示しない。
- entropyをepistemic uncertaintyの推定値として表示しない。
- 元case単位で結果を対応付け、case重複で見かけのnを水増ししない。
- Choiceのoption順序差をIDで吸収し、option追加をinvarianceとして無条件にfailさせない。
- missing/abstained/not_applicable/errorの変化も回帰として表示する。
- model更新時の差をquestion改良の効果と混ぜない。

## 6. 自動修正は最後

proposerはpatchを提案するだけ。question、criteria、output schema、gold labels、baselineの変更権限を分離する。

採用には、元の測定概念を保っていることの確認、静的検査、固定corpus比較、未使用case評価を要求する。単にcheckerに引っかからなくなる方向へ文章を書き換えるループを、自己改善と呼ばない。
