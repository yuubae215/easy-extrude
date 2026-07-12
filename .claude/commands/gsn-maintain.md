---
description: リポジトリ内の .gsn 論証木を棚卸しし、証拠を再実行して鮮度を更新(リリース前・大きめのマージ後に)
argument-hint: "[任意: 対象パス / 特定ADR番号]"
allowed-tools: Read, Glob, Grep, Bash, Write, Edit
---

# GSN 論証木のメンテナンス

ADR の相棒 `.gsn`(および `docs/assurance/` 等の検証木)は、書いた瞬間から古び始める。
このコマンドは §2 のループ(Observe → 検証 → 証拠で閉じる)を論証アーティファクトに適用し、
**証拠の鮮度を現実に同期**させる。実行タイミングの目安: リリース準備時、大きめのマージ後、
ADR を Supersede したとき。対象の絞り込み: $ARGUMENTS

前提知識は `.claude/skills/gsn-meta-framework/` を読む
(特に `references/verification-mode.md` の「Freshness and persistence」と「Evidence quality ladder」)。
ツール: `TOOL=.claude/skills/gsn-meta-framework/scripts/gsn_tool.py`

## 手順

1. **棚卸し (Observe).**
   ```bash
   git ls-files '*.gsn'
   python3 $TOOL lint  <見つかった全ファイル>
   python3 $TOOL stats <見つかった全ファイル>
   ```
   lint エラーは他の何より先に直す(壊れた論証木は保守できない)。
   stats の evidence debt(ToBeDeveloped 率)と stale(ToBeReviewed)件数を控える。

2. **鮮度判定.** 各 `.gsn` の Solution ノードは `summary` にコマンド、末尾に
   `(commit <hash>, <date>)` を刻んでいる(verification-mode の規約)。
   現 HEAD (`git rev-parse --short HEAD`) と突き合わせ:
   - 刻印コミット以降に、その論証の blast radius 内のファイルが変わっていれば **stale**。
     判定は `git diff --stat <hash>..HEAD -- <関連パス>` で機械的に。
   - 変更が無ければ fresh のまま。むやみに全再実行しない(§0 一番安いレンズ)。

3. **証拠の再実行 (Act → 再 Observe).** stale な Solution と、`ToBeDeveloped` のまま残る
   Assumption(当時実行できなかった検査)について:
   - summary に刻まれたコマンドをそのまま実行し、決定的な出力(件数・exit code・数値)を捕捉。
   - **合格:** summary の刻印を現コミット・今日の日付に更新、親 goal を `Approved` に。
     Assumption が実証拠に昇格できるなら `assumption` → `solution` に置換(§1.2 の成熟)。
   - **不合格:** これは *発見* であり隠さない。親 goal を `Disapproved` にし、
     対応する ADR の再検討(Supersede 候補)としてレポートに載せる。
   - **実行不能:** 理由を assumption の summary に追記し `ToBeDeveloped` を維持。

4. **Status 同期.** ADR 相棒の場合、ADR の Status と .gsn 最上位 state の対応
   (adr skill の対応表)がずれていないか確認し、ずれは .gsn 側でなく**判断が要る差分として報告**する
   (Status の変更は人の採択事項 — 勝手に Accepted にしない)。

5. **レポート → 承認後に Write.** 変更予定の全ファイルと差分を提示し、承認を得てから書く。
   レポート様式:

   ```
   # GSN maintenance report (HEAD <hash>, YYYY-MM-DD)
   | file | before → after (evidence debt) | re-run | passed | failed | still-open |
   |------|--------------------------------|--------|--------|--------|------------|
   ## Failures(要判断)
   - docs/adr/0007-….gsn G1.2 → Disapproved: <決定的出力>。ADR-0007 の再検討候補。
   ## Status ずれ(要判断)
   ```

## ガードレール(§5)
- 実行していない検査を fresh に塗り替えない(証拠なき完了禁止)。
- 失敗した証拠を握りつぶして `Approved` を維持しない(暗黙の冗長=現実との乖離)。
- 変更が無い枝の全再実行で時間を溶かさない(過剰モデリング禁止の実行版)。
