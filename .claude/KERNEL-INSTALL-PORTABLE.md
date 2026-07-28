# 導入手順書 — ポータブル版

`~/.claude`(マシン側のグローバル設定)に一切触らず、すべてをリポジトリ内 `.claude/` に置いて
**git で持ち運ぶ**版。新しいマシンでも `git clone` → ワークスペース信頼 → 実行権限付与 だけで効く。
チーム共有もそのまま(コミットされるため)。

> グローバル版との違いは配線3点のみ。中身(規律・テンプレ・skill・hook ロジック)は同一:
> 1) 核を `.claude/rules/00-kernel.md` として launch 時自動 load
> 2) hook をプロジェクト `.claude/settings.json` から相対パス(`$CLAUDE_PROJECT_DIR`)で配線
> 3) `/scaffold-project` が `.claude/templates/` を相対参照

---

## 0. 同梱物(`dot-claude/` が `<repo>/.claude/` になる)

| 同梱パス | 配置先 | 役割 |
|---|---|---|
| `dot-claude/rules/00-kernel.md` | `<repo>/.claude/rules/00-kernel.md` | 不変核(launch 時 自動 load) |
| `dot-claude/templates/*` | `<repo>/.claude/templates/` | 生成テンプレ(単一の源) |
| `dot-claude/commands/scaffold-project.md` | `<repo>/.claude/commands/` | `/scaffold-project`(相対参照版) |
| `dot-claude/skills/adr/SKILL.md` | `<repo>/.claude/skills/adr/` | ADR skill |
| `dot-claude/hooks/evidence-before-commit.sh` | `<repo>/.claude/hooks/` | §5 強制 hook |
| `dot-claude/settings.json` | `<repo>/.claude/settings.json` | hook 配線(相対) |
| `dot-claude/test-command.example` | `<repo>/.claude/test-command` にリネーム | テストコマンドの単一の源 |
| `dot-claude/VERSION` | `<repo>/.claude/VERSION` | バージョン刻印(ドリフト検知) |

---

## 1. インストール(対象リポジトリのルートで)

```bash
# 解凍ディレクトリから、リポジトリ直下へ .claude/ を展開
cp -R /path/to/claude-kernel-portable/dot-claude  ./.claude

# hook に実行権限(zip で失われることがあるため明示)
chmod +x ./.claude/hooks/evidence-before-commit.sh

# テストコマンドの単一の源を作る(例。プロジェクトに合わせて編集)
cp ./.claude/test-command.example ./.claude/test-command
$EDITOR ./.claude/test-command

# コミット(チームと共有・他マシンへ持ち運び)
git add .claude && git commit -m "chore: vendor design kernel (portable)"
```

既存の `.claude/` がある場合は上書きせず、`rules/00-kernel.md`・`templates/`・`commands/`・
`skills/adr/`・`hooks/` を個別にコピーし、`settings.json` は `hooks.PreToolUse` を手でマージする。

---

## 2. 信頼と有効化

- 初回起動時、ワークスペースの信頼(trust)ダイアログを承認する。プロジェクト `settings.json` の
  hook はこれを通って初めて有効になる。
- `$CLAUDE_PROJECT_DIR` を hook コマンドで使用している。これが使えない版では、`settings.json` の
  command をリポジトリ絶対パスに書き換えるか、`.claude/hooks/...` の相対指定に変える。

---

## 3. 使い方

対象リポジトリで Claude Code を起動し:

```
/scaffold-project
```

`.claude/templates/` を読み、実コードを探索して論理→物理の順で
`.claude/CLAUDE.md` と概念図(`docs/architecture.mermaid`、§1.4 を満たす実体の `docs/state-<entity>.mermaid`)を生成。
書き込み前にレビュー提示。

---

## 4. 動作確認

1. `/memory` で `rules/00-kernel.md` が load 一覧にあること。
2. 「ADR を書いて」で adr skill が起動すること。
3. `/scaffold-project` がレビュー提示まで来ること。
4. テストを落とした状態で `git commit` がブロックされること(`.claude/test-command` 設定済みのとき)。

---

## 5. もう一つのポータブル形態(detached / `--add-dir`)

リポジトリに commit したくない・複数リポジトリで核だけ使い回したい場合、`.claude/` を
リポジトリ外の持ち運びフォルダ(USB/クラウド)に置き、起動時にアタッチできる:

```bash
CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1 claude --add-dir /path/to/portable
```

ただしこの形態で追加ディレクトリから load されるのは **CLAUDE.md / .claude/CLAUDE.md /
.claude/rules/*.md / CLAUDE.local.md** に限られる(doc 既定)。つまり **核(規律)は効くが、
commands・skills・hook は読まれない**。「核だけ持ち運ぶ軽量版」と割り切る用途向け。
フル機能(scaffold・ADR・commit 強制)が要るなら §1 の in-repo 版を使う。

---

## 6. §1.1 との折り合い(重要)

ポータブル版は核を各リポジトリへ **vendoring(複製)** する。これは「真実の源は一つ」と
本質的に緊張する。受け入れ方:

- canonical(配布元の bundle)を**唯一の源**とし、各リポジトリの `.claude/` はそのピン留めコピーと位置づける。
- 更新は canonical 側を直し、`VERSION` を上げて各リポジトリへ再コピー(または git subtree/submodule で取り込む)。
- `VERSION` でドリフトを検知する。古い刻印のリポジトリは再同期の対象。

グローバル版(`~/.claude`)を既に入れているマシンでは、**同じ核を repo にも置かない**こと。
両方 load されると核が二重化し、まさに §1.1 が防ぎたい状態になる。1 マシン/1 リポジトリにつき
どちらか一方のモードに統一する。

---

## 注意

Claude Code の仕様(rules の自動 load、プロジェクト settings の hook、`$CLAUDE_PROJECT_DIR`、
`--add-dir` の load 対象)はバージョンで変わり得る。挙動が合わなければ現行ドキュメントで確認すること。

## 追補 (v2 / 2026-07-18)
- `dot-claude/kernel-log.md` → `<repo>/.claude/kernel-log.md`: 核の改訂記録(§6)。load されない。
  portable では核改訂は canonical 側で行い(§6/§1.1)、ログも canonical が正準。VERSION と共に各 repo へ再同期。
- 核に追加: §6 自己メンテナンス / §2 一拍俯瞰 / §1.4 台帳による累積判定(台帳スロットは project template 側)。

## 追補 (v3): 一発インストール
手順書 §1 の手作業の代わりに、解凍ディレクトリで:
```bash
bash install.sh /path/to/repo    # 省略時カレント
```
非破壊(既存は SKIP)・冪等。test-command の雛形生成と次の手順の案内まで行う。

## 追補 (v4 / 2026-07-27)
- 核 §1.2 に gsn-meta-framework skill へのエスカレーションを追記。
- `dot-claude/skills/animation-fx/` を同梱(v3.2: Step 1.5 モーション・アイデンティティ)。
  不要なリポジトリでは skills/animation-fx を削除してから commit してよい。

## 追補 (v5 / 2026-07-27)
- 核 §0 に三位一体の表現(テキスト/図(Mermaid)/式)を追加。§1.2・§3・adr skill に接続。

## 追補 (v6 / 2026-07-28): 実運用からのバックポート
- easy-extrude の 2026-07-25 先行改訂(§1.4 累積器実在の明文化・基数・§4 名指し委譲)を
  canonical に取込。運用中リポジトリはこの版へ再同期すると v4(GSNエスカレーション)/
  v5(三位一体)/animation v3.2(Step 1.5)も同時に入る。ローカル拡張(追加 command/hook/rules)は保持してよい。

## 追補 (v7 / 2026-07-28): 結晶化した原則レーン
- `dot-claude/rules/10-principles.md` を同梱。原産(easy-extrude)側は既存の自リポジトリ版を保持
  してよい(§写像つき)。他リポジトリはこの版を使い、写像節を各自ローカル追記。
