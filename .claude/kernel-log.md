# kernel-log — 核の改訂記録(load しない / <repo>/.claude/kernel-log.md(portable: 正準は canonical 側))

形式: `日付 | シグナル(a追記/b締め/c根本欠落) | Goal ← Strategy ← Evidence(事例)`
月次で見返し、矛盾・死文を刈る(§6)。

- 2026-07-18 | c | Goal: reactive 素通しでも根本を見る ← Strategy: §2 に一拍俯瞰(3問)を必須化 ← Evidence: 症状対応→後日root fixの再発
- 2026-07-18 | b/c | Goal: 状態機械が実運用で発動する ← Strategy: §1.4 閾値をプロンプト単位から台帳(§4)累積判定へ ← Evidence: 指示が一度に2状態しか語らず発動ゼロ
- 2026-07-18 | a | Goal: 核の育成手順の統一 ← Strategy: §6 自己適用ループ+本ログ新設 ← Evidence: メンテ方針が未定義だった
