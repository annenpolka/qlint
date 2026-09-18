# 一次資料

確認日: 2026-09-18。以下は設計の外部根拠であり、このbundleの実測結果ではない。

- **S1** TypeSafe AI, Autoresearch feature discovery, “Next steps”. 候補質問の4観点screening、split分離の提案。https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery
- **S2** TypeSafe AI, Noul. trueの確率、独立confidenceなし。https://docs.typesafe.ai/primitives/noul
- **S3** TypeSafe AI, Choice. 候補分布、候補数、fallback。https://docs.typesafe.ai/primitives/choice
- **S4** TypeSafe AI, Score. 順序尺度、levelの独立評価、confidenceの限界。https://docs.typesafe.ai/primitives/score
- **S5** TypeSafe AI, Confidence. 分布由来の統計と用途ごとの閾値。https://docs.typesafe.ai/confidence
- **S6** TypeSafe AI, API reference. request/responseとquestion IDが推論へ送られないこと。https://docs.typesafe.ai/api
- **S7** JSON Schema, Conditional schema validation. 条件付き必須項目の記述。https://json-schema.org/understanding-json-schema/reference/conditionals

外部モデルの版固定は同じ挙動の完全再現を保証しない。API応答が提供するmodel/revision情報を実行記録へ残す設計とする。
