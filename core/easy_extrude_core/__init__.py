"""easy-extrude コア (バックエンドレイヤ)。把持姿勢探索の判定エンジン。

- `easy_extrude_core.contract`: BFF <-> コアAPI の I/O 契約の型 (ADR-074)。
- `easy_extrude_core.engine`: 段階0 判定エンジン (ADR-075)。離散候補 + 安い順フィルタ
  (リーチ -> IK -> 干渉) + 加重和スコア -> 上位N件。素朴版 (全探索) を実装済み。
- `easy_extrude_core.recommendation`: 推薦/類似レーン (ADR-077)。等価性 *候補* を
  propose / rank する propose-only コア (decide はしない)。素朴版 (字面類似 + Protocol
  注入境界) を実装済み。本物の embeddings / ADR-056 wire 配線 / HTTP は後続に defer。
"""

__version__ = "0.1.0"
