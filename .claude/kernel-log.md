# kernel-log — 核の改訂記録(load しない / <repo>/.claude/kernel-log.md(portable: 正準は canonical 側))

形式: `日付 | シグナル(a追記/b締め/c根本欠落) | Goal ← Strategy ← Evidence(事例)`
月次で見返し、矛盾・死文を刈る(§6)。

- 2026-07-18 | c | Goal: reactive 素通しでも根本を見る ← Strategy: §2 に一拍俯瞰(3問)を必須化 ← Evidence: 症状対応→後日root fixの再発
- 2026-07-18 | b/c | Goal: 状態機械が実運用で発動する ← Strategy: §1.4 閾値をプロンプト単位から台帳(§4)累積判定へ ← Evidence: 指示が一度に2状態しか語らず発動ゼロ
- 2026-07-18 | a | Goal: 核の育成手順の統一 ← Strategy: §6 自己適用ループ+本ログ新設 ← Evidence: メンテ方針が未定義だった
- 2026-07-27 | a | Goal: assurance級判断でフルGSNが確実に立つ ← Strategy: §1.2 に gsn-meta-framework へのエスカレーション明記 ← Evidence: 縮約GSNのみでは記法・evidence実行が不足する場面
- 2026-07-27 | a | Goal: 説明・証明がテキスト偏重にならない ← Strategy: §0 三位一体(テキスト/図/式・相補で正準は一媒体) + §1.2/§3/ADR skill へ接続 ← Evidence: 図表・式の欠けた説明は証明として不完全(ユーザ要求)
- 2026-07-28 | c(backport) | Goal: 規律が自分の前提(累積器の実在)を自分で保証する ← Strategy: easy-extrude 2026-07-25 先行改訂を canonical へ取込 — §1.4「台帳が実在しなければ発動しない」明文化+基数(0·1·N)追記対象化+図の置き場所をプロジェクト定義へ / §4 名指し委譲 / §3 基数行 ← Evidence: 台帳未設置で1週間発動ゼロ→未モデルの幽霊ロボット(easy-extrude ADR-090・実運用)
- 2026-07-28 | a(backport) | Goal: プロジェクト横断の設計法則に持ち運ぶレーンを与える ← Strategy: easy-extrude rules/10-principles.md を canonical へ取込(系譜 header で正本ポインタの宙吊りを解消・UI 節にスコープ注記・§写像 はローカル追記の規約化)+ §4 に第三チャネル「結晶化した原則」と昇格順(auto memory→原則→canonical)を明文化 ← Evidence: 31原則が easy-extrude 実運用(ADR 102本)から結晶化済み。うち22本は完全不変、UI 系 9 本はドメイン条件付き
