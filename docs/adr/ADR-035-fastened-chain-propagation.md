# ADR-035 — Fastened Constraint CF-Chain Propagation and Cycle Detection

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-05-02 |
| **References** | ADR-032, ADR-033, ADR-030, ADR-018, ADR-019 |

---

## Context

### 発端となった問題

`fastened` 拘束を CF の孫（grandchild CF）同士に設定した場合、片方の親 Solid を移動しても
もう一方の親 Solid が追従しないという動作が確認された。

```
親Solid → 子CF_A → 孫CF_A  (TARGET)
                       ↕ fastened
子Solid → 子CF_B → 孫CF_B  (SOURCE)
```

親Solid を移動すると 孫CF_A（TARGET）は追従するが、`_updateFastenedFrames` が
`source.translation` を更新するだけで 子Solid には伝わらない。
その結果 子Solid は静止したまま、拘束は見かけ上「維持」されているが
ユーザーの意図（fastened = 剛体結合）が実現できていない。

### 根本原因

`_updateFastenedFrames` には SOURCE の直接の親に応じた 2 分岐がある。

| SOURCE の直接の親 | 現在の処理 |
|-------------------|-----------|
| Solid | Solid.corners に translation delta を適用 → **Solid が動く ✓** |
| CoordinateFrame | `source.translation` を更新するだけ → **delta が CF 内に吸収され root Solid に届かない ✗** |

「親が CF」の分岐が delta を CF chain の中に吸収してしまうのが問題。

### グラフ構造としての整理

現在の関係表現は 2 種類のエッジからなる有向グラフである。

```
エッジ A: CoordinateFrame.parentId (ツリー辺, 親→子)
  Solid ──▶ 子CF ──▶ 孫CF

エッジ B: SpatialLink (任意有向辺, source→target)
  孫CF_B ──[fastened]──▶ 孫CF_A
```

fastened 拘束は Solid 同士を「CF チェーンを介して」接続する。
SOURCE を CF チェーンに沿って根方向にたどれば root Solid に辿り着く。
root Solid に delta を適用すれば、チェーン全体が連動する。

---

## Decision

### § 1 — CF チェーン伝播アルゴリズム

`_updateFastenedFrames` の「SOURCE の親が CF」分岐を以下に置き換える。

#### ヘルパー: `_findAncestorChain(sourceId)`

```
入力:  SOURCE CF の id
出力:  {
         rootSolid: Solid | null,   // チェーンの根となる Solid
         chain: CF[]                 // [rootSolid の直子CF, ..., SOURCE の直接親CF]
       }                             // 根から葉の順 (re-propagation 用)
```

実装方針:
```
chain = []
node = source.parent
while node instanceof CoordinateFrame:
  chain.unshift(node)   ← 根側に追加 (結果: 根から葉の順)
  node = node.parent
rootSolid = node.corners が存在すれば node、それ以外は null
return { rootSolid, chain }
```

#### 修正後の分岐ロジック

```
case SOURCE.parent instanceof CoordinateFrame:
  { rootSolid, chain } = _findAncestorChain(source.id)

  if rootSolid:
    // 1. root Solid を平行移動
    dx, dy, dz = constrainedWorldPos − source.currentWorldPos
    for corner of rootSolid.corners: corner += (dx, dy, dz)
    rootSolid.meshView.updateGeometry()
    rootSolid.meshView.updateBoxHelper()

    // 2. CF チェーンをインライン再伝播 (根→葉)
    parentPos = centroid(rootSolid.corners)
    for cf in chain:
      cf.worldPos = parentPos + cf.translation   // translation は変更しない
      _worldPoseCache[cf.id].position = cf.worldPos
      cf.meshView.updatePosition(cf.worldPos)
      cf.meshView.updateConnectionLine(parentPos)
      parentPos = cf.worldPos

    parentWorldPos = chain.last.worldPos   // connection line 描画用
    // source.translation は変更しない

  else:
    // fallback: root Solid が見つからない場合は旧動作
    source.translation = constrainedWorldPos − parent.worldPos
```

**source.translation を変えない理由**: root Solid を delta だけ動かすと、
CF チェーンの再伝播によって SOURCE の world pos が自動的に `constrainedWorldPos` に
等しくなる。translation の変更は不要であり、かえって次フレームのずれを招く。

### § 2 — サイクル検出

fastened 拘束のグラフには **A → B → A** のようなサイクルが生じ得る。
サイクルがあると制約が毎フレーム振動し、どの Solid も正しい位置に収束しない。

#### Solid-to-Solid fastened グラフ

各 fastened SpatialLink について、SOURCE の root Solid と TARGET の root Solid を
取り出すと、Solid を頂点・fastened link を有向辺とする部分グラフが得られる。

```
_fastenedTransforms を走査:
  SOURCE の root Solid  = _findAncestorChain(sourceId).rootSolid
  TARGET の root Solid  = _findAncestorChain(targetId).rootSolid
  辺: srcRoot → tgtRoot
```

#### 検出タイミングと手順

`_updateFastenedFrames` の先頭でフレームごとに O(V + E) DFS を実行する。

```
_detectFastenedCycles():
  visited = Set(), stack = Set()
  cyclic  = Set<linkId>()
  for each 辺 (src, tgt, linkId):
    if hasCycle(src, adj, visited, stack):
      cyclic.add(linkId)
  return cyclic
```

サイクル検出は fast-path として最初に実施し、cyclic な linkId を持つ
エントリはソルバーに渡さずスキップする。

#### ユーザーへの通知

サイクルが検出されたフレームで `showToast` を表示する。
毎フレーム出力しないよう、直前フレームと cyclic セットが変化した場合のみ表示。

```
toast メッセージ例:
  "Constraint cycle detected — some fastened links are inactive"
```

### § 3 — 変更しないこと

本 ADR は以下を変更しない。

| 項目 | 理由 |
|------|------|
| 回転の非伝播 | 既存制限として継続（ROADMAP バックログ参照）|
| 1 Solid あたり fastened source 1 つ制限 | multi-source は別課題（ROADMAP バックログ参照）|
| SOURCE/TARGET の向き（単方向） | fastened の意味論は変わらない |
| CoordinateFrame.parentId の構造 | Solid に parentId を追加しない |

---

## Consequences

### 正の影響

- CF が何段ネストされていても、fastened 拘束が root Solid まで伝播する
- 「剛体結合」という fastened の本来の意味論が深いネストでも成立する
- サイクルが検出されユーザーに通知される（サイレント振動の解消）

### 負の影響・制約

- `_findAncestorChain` の O(depth) コストが毎フレーム fastened constraint 数分かかる
  （典型的な深さ 2〜3 かつ constraint 数は少ないため無視できる）
- インライン再伝播は `_worldPoseCache` を部分的に書き換えるため、
  同一フレーム内で他の constraint がその CF の cache を読む場合に順序依存が生じる可能性がある。
  → 制約処理の順序は topological sort に従う（既存ルール）
- サイクル検出は每フレーム実行されるが、シーン変更時のみ再計算するようキャッシュ可能（実装判断に委ねる）

### 既知の未解決事項

1. **回転伝播** — TARGET CF が回転した場合、親 Solid の corner を回転させる処理は未実装
   （ROADMAP 🔴 High「fastened 拘束の回転伝播」に記載）
2. **multi-source** — 同一 Solid に複数の fastened source CF がある場合は
   last-write-wins のまま（ROADMAP 🟡 Medium「fastened 拘束: 同一 Solid に複数 source CF」）
3. **異なる Solid 間の孫 CF を fastened にした場合のサイクル検出精度** —
   root Solid が null の CF（Solid を持たない浮いた CF）はグラフの頂点として扱わない

---

## 実装ガイド（次セッション向け）

```
変更ファイル:
  src/service/SceneService.js
    - _findAncestorChain(sourceId) ヘルパーを追加
    - _detectFastenedCycles() ヘルパーを追加
    - _updateFastenedFrames() の "parent instanceof CoordinateFrame" 分岐を § 1 に従い修正
    - _updateFastenedFrames() の先頭で § 2 サイクル検出を呼び出す

完了後に更新するドキュメント:
  docs/CODE_CONTRACTS.md
    - "Fastened Constraint Limitations" 項目 (1) を更新 (chain propagation を追記)
    - 項目 (4)(5) を新規追加 (chain propagation / cycle detection)
  docs/code_contracts/architecture.md
    - 対応する詳細ルールを追記

テスト観点:
  - depth=1 (SOURCE 直親が Solid): 既存動作が壊れないこと
  - depth=2 (SOURCE 直親が CF): 子Solid が親Solid に追従すること
  - depth=3 以上: 同上
  - cycle (A→B→A): toast が表示され、cyclic な constraint が静止すること
  - cycle なし後に cycle 追加: toast が 1 度だけ表示されること
```
