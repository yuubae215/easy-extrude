# 導入手順書 — 設計・作業の不変核 一式

Claude Code に「プロジェクトを越えて引き継ぐ設計メンタルモデル」を導入する。
構成は三層: **常時 load の核** / **強制(hook)** / **on-demand(skill・command)**。
テンプレは単一の源(§1.1)として `~/.claude/templates/` に集約し、command がそれを参照する。

---

## 0. 同梱物と配置先

`home-claude/` の中身が、そのまま `~/.claude/` 配下の配置を表している。

| 同梱ファイル | 配置先 | 役割 |
|---|---|---|
| `home-claude/CLAUDE.md` | `~/.claude/CLAUDE.md` | 不変核(常時 load)。方法・規律・レンズ・選択規則 |
| `home-claude/templates/CLAUDE.project-template.md` | `~/.claude/templates/` | 各プロジェクトの CLAUDE.md の雛形 |
| `home-claude/templates/architecture.template.mermaid` | `~/.claude/templates/` | 各プロジェクトの概念図(トポロジ)雛形 |
| `home-claude/templates/state-machine.template.mermaid` | `~/.claude/templates/` | 状態機械(§1.4)雛形 |
| `home-claude/templates/concept-map.mermaid` | `~/.claude/templates/` | 核そのものの見取り図(参照用) |
| `home-claude/commands/scaffold-project.md` | `~/.claude/commands/` | `/scaffold-project` コマンド本体 |
| `home-claude/skills/adr/SKILL.md` | `~/.claude/skills/adr/` | ADR 作成 skill(プロンプトで起動) |
| `home-claude/hooks/evidence-before-commit.sh` | `~/.claude/hooks/` | §5 強制: テスト不通過なら commit を中止 |
| `home-claude/settings.hook-snippet.json` | `~/.claude/settings.json` へ**マージ** | 上の hook の配線 |

> 注意: `settings.hook-snippet.json` はマージ用の断片であり、既存 `settings.json` を上書きしない。

---

## 1. 前提

- Claude Code がインストール済みであること。
- hook は JSON 解析に `python3` を使う(多くの環境に既存)。
- auto memory を併用するなら Claude Code v2.1.59 以降(`claude --version` で確認)。任意。

---

## 2. インストール(新規環境向け一括)

解凍したディレクトリ直下で:

```bash
cd claude-kernel-bundle
mkdir -p ~/.claude/commands ~/.claude/hooks ~/.claude/skills/adr ~/.claude/templates

# 不変核(既存があれば上書きせずマージ。-i で確認プロンプト)
cp -i home-claude/CLAUDE.md ~/.claude/CLAUDE.md

# テンプレ(単一の源)
cp home-claude/templates/* ~/.claude/templates/

# command / skill
cp home-claude/commands/scaffold-project.md ~/.claude/commands/
cp home-claude/skills/adr/SKILL.md ~/.claude/skills/adr/

# hook(実行権限を付与)
cp home-claude/hooks/evidence-before-commit.sh ~/.claude/hooks/
chmod +x ~/.claude/hooks/evidence-before-commit.sh
```

### settings.json のマージ

`~/.claude/settings.json` が**無い**場合:

```bash
cp home-claude/settings.hook-snippet.json ~/.claude/settings.json
```

**既にある**場合は手で `hooks.PreToolUse` に追記する。既存の PreToolUse hook があるなら
配列に要素を足す(下の jq は既存 hook が無い時のみ安全。`*` は配列を置換するため):

```bash
jq -s '.[0] * .[1]' ~/.claude/settings.json home-claude/settings.hook-snippet.json > /tmp/m.json \
  && mv /tmp/m.json ~/.claude/settings.json
```

---

## 3. プロジェクト側の準備(リポジトリごと・任意)

hook を有効にするには、テストコマンドの**単一の源**を各リポジトリに置く(§1.1):

```bash
echo 'npm test' > .claude/test-command   # 例。pytest / cargo test / make test など
```

未設定で自動検出も効かない場合、hook は警告のみでブロックしない(fail-open)。
`git commit --no-verify` で意図的にバイパス可能。

---

## 4. プロジェクトへの本体導入

対象リポジトリのルートで Claude Code を起動し:

```
/scaffold-project
```

`~/.claude/templates/` を読み、実コードを探索して、論理→物理の順で
`./CLAUDE.md` と概念図(`docs/architecture.mermaid`、§1.4 を満たす実体の `docs/state-<entity>.mermaid`)を生成する。
書き込み前にレビュー提示が出るので承認する。既存 `CLAUDE.md` があれば上書きせず差分提案になる。

> `/init` は使わない。自前探索と二重になり、ビルド/テストの記載が二箇所に出て §1.1 違反になる。

---

## 5. 動作確認

1. **核の load:** セッション内で `/memory` を実行し、`~/.claude/CLAUDE.md` が一覧にあること。
2. **skill 起動:** 「ADR を書いて」と入力し、adr skill が立ち上がること。
   起動語が弱ければ `SKILL.md` の description にあなたの言い回しを足す。
3. **command:** 小さなリポジトリで `/scaffold-project` を回し、レビュー提示まで来ること。
4. **hook 強制:** わざとテストを落とした状態で `git commit` を試み、中止されること。

---

## 6. 注意・既知の前提

- CLAUDE.md は **context**(助言)であり強制ではない。確実に止めたいものだけ hook/settings に置く。
- 旧 `structure-lenses.rule.md` は本一式に**含めない**。§1.3 を核に戻したため廃止(併置すると §1.1 違反)。
- Claude Code の仕様(hook スキーマ、custom command の frontmatter、skill/command の置き場所)は
  バージョンで変わり得る。挙動が合わなければ現行ドキュメントで確認すること。

---

## 付録: 単一の源マップ(どれが何の正準か)

- 方法・規律・選択規則 → `~/.claude/CLAUDE.md`(核)
- 生成テンプレ → `~/.claude/templates/`(command はここを参照)
- プロジェクトのトポロジ → `docs/architecture.mermaid`(図)
- プロジェクトの意味・不変条件・goal → `./CLAUDE.md`(テキスト。トポロジは再掲しない)
- 実体の状態 → `docs/state-<entity>.mermaid`
- 設計判断の根拠 → `docs/adr/`(ADR)
- テストコマンド → `<repo>/.claude/test-command`
- 発見した学習(ビルド癖・デバッグ知見) → auto memory(手で複製しない)
