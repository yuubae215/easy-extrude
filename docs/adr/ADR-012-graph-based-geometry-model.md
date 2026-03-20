# ADR-012: グラフ基底ジオメトリモデル (Vertex / Edge / Face / Solid)

- **Status**: Proposed
- **Date**: 2026-03-20
- **References**: ADR-005, ADR-009, ADR-011

---

## Context

現在の `Cuboid` エンティティは 8頂点を `corners: Vector3[8]` として持ち、面は
`FACES[i].corners` (頂点インデックスの配列) で暗黙的に定義されている。
`Sketch` は `sketchRect: { p1, p2 }` という独自表現を持つ。

この設計では:
- 頂点・辺・面の選択が統一的に表現できない (G→V, G→E 等の操作が追加しにくい)
- `dimension` フィールドで型を切り替えるため、ステート遷移とメソッドセットの乖離が起きやすい
  (実際に発生したバグ: Sketch に `move()` / `extrudeFace()` が欠落)

---

## Decision

将来フェーズで、すべてのジオメトリエンティティをグラフ構造の上に構築する。

### 基底グラフ

```
Vertex  = { id, position: Vector3 }
Edge    = { id, v0: Vertex, v1: Vertex }
Face    = { id, vertices: Vertex[N] }   // N=4 for quads
```

### 次元エンティティ

| 次元 | エンティティ | 構成 |
|------|-------------|------|
| 0D | `Vertex` | 1点 |
| 1D | `Edge` | Vertex × 2 |
| 2D | `Face` | Edge の閉じたサイクル |
| 3D | `Cuboid` | Face の閉じた多面体 (6面 × 4頂点) |

### 動詞 (次元を上げる操作)

| 動詞 | 変換 | 説明 |
|------|------|------|
| `Sketch` | 1D → 2D | Vertex pair から Face を生成 |
| `Extrude` | 2D → 3D | Face から Cuboid を生成 |

動詞は元エンティティを突然変異させず、上位次元の新エンティティを返す。
`SceneService` が旧エンティティを削除し、同一 ID で新エンティティを登録する。

### 選択モデルの統一

```js
selection: Set<Vertex | Edge | Face>
```

G→V (頂点選択), G→E (辺選択), G→F (面選択) が同一の選択システムで動作する。
現在の Edit Mode の「face hover / face drag」はこのモデルの Face 選択の特殊ケースになる。

### 現状との対応

```
corners: Vector3[8]  →  Vertex[8]
FACES[i].corners     →  Face[i].vertices  (頂点インデックス参照)
（Edge は暗黙）      →  Edge[] として明示
```

---

## Consequences

**良い点**
- 頂点・辺・面レベルの選択・操作が統一的に実装できる
- `dimension` フィールドが不要になり、エンティティ型が振る舞いを決定する
- 「ステートが遷移したのにメソッドがついてこない」問題が構造上起こり得ない
- Blender の BMesh に近いモデルになり、将来的な機能拡張との整合性が高まる

**制約・コスト**
- 現行の `corners[8]` / `FACES` ベースのジオメトリ計算 (`CuboidModel.js`) を全面的に書き直す必要がある
- `MeshView` の `BufferGeometry` 構築ロジックも対応が必要
- 移行コストが大きいため、既存機能が安定した段階で着手する

## 実装タイミング

現行の Cuboid / Sketch エンティティが安定し、Edit Mode の基本操作 (面押し出し・Grab) が
完成した後のフェーズで着手する。それまでは現行モデルを維持する。
