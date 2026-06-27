---
description: 不変核のプロジェクト・インスタンス(CLAUDE.md + 概念図)をテンプレから生成
argument-hint: "[任意: 重点領域 / 対象サブディレクトリ]"
allowed-tools: Read, Glob, Grep, Bash, Write, Edit
---

# プロジェクト・インスタンスの scaffold

不変核(`.claude/kernel-CLAUDE.md`、グローバル運用時は `~/.claude/CLAUDE.md`)の *方法*を、
このリポジトリの *インスタンス*へ落とす。
`/init` はコードベースから独自に CLAUDE.md を生成するだけでテンプレを使わないため、本コマンドで行う。

## 入力テンプレ(単一の源 §1.1 — コピーせず Read して参照)
- .claude/templates/CLAUDE.project-template.md
- .claude/templates/architecture.template.mermaid
- .claude/templates/state-machine.template.mermaid

追加の重点指定: $ARGUMENTS

## 手順
1. **既存確認.** `./CLAUDE.md` か `./.claude/CLAUDE.md` があれば上書きしない。
   差分の提案にとどめる(/init と同方針)。
2. **探索 (Observe → Orient / §2).** Glob・Grep・Read で実状態から構成を把握:
   言語、ビルド/テスト、ディレクトリ構造、主要モジュール、境界、状態を持つ実体。
   記憶や推測でなく実ファイルから。
3. **論理 → 物理の順 (§0).** まず論理(状態・データ関係・ドメイン・不変条件)を起こし、
   それから実装構造へ対応づける。OOP から始めない。
4. **テンプレを埋める (§4 設計された契約).** project-template の各スロットを本リポジトリの事実で:
   - 層マップ + 契約 / 依存グラフ / 黒箱の入出力・不変条件 (§1.3)
   - ドメイン境界・依存方向 (§1.1 DDD / Clean)
   - プロセス様態 BPMN/CMMN (§1.3)
   - 状態機械スロット (§1.4): **3 状態以上、または不正遷移が事故になる**実体だけ。
     閾値未満は載せない(boolean のまま / §0)。
   - Goal ツリー (§1.2 GSN) / 不変条件 (§1.1)
   - ガイド用 HTML コメントと未使用の [TODO]/例は削除。200 行未満に保つ。
5. **概念図を生成 (§1.1 役割分担).** トポロジは図が正準、CLAUDE.md は意味と不変条件のみ。二重化しない:
   - architecture.template → `docs/architecture.mermaid` を埋める
   - §1.4 を満たす実体ごとに state-machine.template → `docs/state-<entity>.mermaid`
   - CLAUDE.md の層マップ/依存グラフ節は図を指し、トポロジ自体を再掲しない。
6. **正当化 (§1.2).** 埋めた設計判断は Goal ← Strategy ← Evidence で説明できること。
   裏取りできない箇所は捏造せず `[TODO 根拠]` として残す。
7. **レビュー提示 → 承認後に書く.** 書き込む前に、生成予定の全ファイル一覧と中身を提示し承認を得る
   (/init NEW と同方針)。承認後にのみ Write する。

## ガードレール (§5)
- 過剰モデリング禁止: 閾値未満の状態機械・不要な層を作らない。
- 暗黙の冗長禁止: 図と CLAUDE.md で同じトポロジを二重に持たない。
- 証拠なき完了禁止: 推測で埋めない。確認できない箇所は [TODO] にする。
