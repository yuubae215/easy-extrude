---
description: 不変核のプロジェクト・インスタンス(CLAUDE.md + 概念図)をリポジトリ内テンプレから生成(ポータブル)
argument-hint: "[任意: 重点領域 / 対象サブディレクトリ]"
allowed-tools: Read, Glob, Grep, Bash, Write, Edit
---

# プロジェクト・インスタンスの scaffold(ポータブル)

このリポジトリ内の `.claude/` に同梱された不変核(`.claude/rules/00-kernel.md`)の *方法*を、
本リポジトリの *インスタンス*へ落とす。テンプレもリポジトリ内にあるためマシン非依存。

## 入力テンプレ(単一の源 §1.1 — Read して参照、コピーしない)
- `.claude/templates/CLAUDE.project-template.md`
- `.claude/templates/architecture.template.mermaid`
- `.claude/templates/state-machine.template.mermaid`

追加の重点指定: $ARGUMENTS

## 手順
1. **既存確認.** `./CLAUDE.md` か `./.claude/CLAUDE.md` があれば上書きしない。差分提案にとどめる。
2. **探索 (Observe → Orient / §2).** Glob・Grep・Read で実状態から構成把握:
   言語、ビルド/テスト、ディレクトリ構造、主要モジュール、境界、状態を持つ実体。推測でなく実ファイルから。
3. **論理 → 物理の順 (§0).** 論理(状態・データ関係・ドメイン・不変条件)を先に起こし、実装構造へ対応づける。
4. **テンプレを埋める (§4 設計された契約).** project-template の各スロットを本リポジトリの事実で:
   - 層マップ+契約 / 依存グラフ / 黒箱の入出力・不変条件 (§1.3)
   - ドメイン境界・依存方向 (§1.1 DDD/Clean) / プロセス様態 BPMN/CMMN (§1.3)
   - 状態機械スロット (§1.4): **3 状態以上、または不正遷移が事故になる**実体だけ。閾値未満は載せない。
   - Goal ツリー (§1.2 GSN) / 不変条件 (§1.1)
   - ガイド HTML コメントと未使用の [TODO]/例は削除。200 行未満。
   - 出力先は **`.claude/CLAUDE.md`**(すべて `.claude/` 配下に集約)。
5. **概念図を生成 (§1.1 役割分担).** トポロジは図が正準、CLAUDE.md は意味と不変条件のみ。二重化しない:
   - `.claude/templates/architecture.template.mermaid` → `docs/architecture.mermaid`
   - §1.4 を満たす実体ごとに → `docs/state-<entity>.mermaid`
   - `.claude/CLAUDE.md` の層マップ/依存グラフ節は図を指し、トポロジを再掲しない。
6. **正当化 (§1.2).** 設計判断は Goal ← Strategy ← Evidence で説明できること。裏取り不能は `[TODO 根拠]` に。
7. **レビュー提示 → 承認後に Write.** 生成予定の全ファイル一覧と中身を提示し承認を得てから書く。

## ガードレール (§5)
- 過剰モデリング禁止 / 暗黙の冗長禁止(図と CLAUDE.md でトポロジ二重化しない)/ 証拠なき完了禁止(推測で埋めない)。
