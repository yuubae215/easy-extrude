# ADR-032 — Geometric Host Binding: Map Elements Mounted on Scene Objects

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Date** | 2026-04-13 |
| **References** | ADR-029, ADR-030, ADR-016, ADR-018, ADR-019 |

---

## Context

### 問題

Map要素（`AnnotatedLine` / `AnnotatedRegion` / `AnnotatedPoint`）は現在、
ワールドXY平面（Z=0）上に置かれることを暗黙的に前提としている。
しかし Grab でZ方向に動かすと平面から浮いてしまい、
「この経路は装置の上面に貼られている」「このアンカーは機器上の基準点を指す」
といった意味が失われる。

### ユーザーが表現したいもの

- Solidオブジェクト（床、装置、壁など）の**表面**にMap要素を貼り付けたい
- 貼り付け先のSolidを移動・回転させると、Map要素が**追随**してほしい
- Grab時はSolidの表面内（ローカルXY平面）に拘束したい

### 意味的 vs 幾何学的

この「ホスト上に置く」という関係は **両面** を持つ：

- **意味的**：「この Anchor はこの装置上にある」（SpatialLink と同じ性質）
- **幾何学的**：「この Map 要素の座標は、ホストのローカル空間で定義される」（新しい性質）

ADR-030 は SpatialLink を意味的な記録に限定し、幾何学的な拘束解決を
「別途 constraint-solver ADR が必要」として明示的に Out of scope とした。
本 ADR がその constraint-solver ADR である。

### CoordinateFrame との比較

`CoordinateFrame` は `parentId` により座標系の親子階層を持つ。
これはフレーム同士の階層構造であり、意味はない（純粋に幾何学的）。

Geometric Host Binding は逆で、**意味を持った関係が幾何学的制約を伴う**。
「装置上の点」という意味が先にあり、その結果として座標がホスト空間で定義される。

---

## 設計上の選択肢

### A. SpatialLink の `linkType` を拡張して `mounts` を追加

```js
{
  id:        'link_007',
  sourceId:  'annot_point_001',   // Map要素
  targetId:  'solid_003',         // ホストSolid
  linkType:  'mounts',
  // mounts専用の幾何データ：
  hostToLocal: Float32Array[16],  // マウント時のhost.worldPose.inverse
}
```

- SpatialLinkの既存インフラ（作成UI、Undo/Redo、シリアライズ、Outlinerbadge）を再利用できる
- ADR-030 の "separate constraint-solver ADR" という設計方針と整合する
- `mounts` のみ `hostToLocal` を持つ異質なフィールドが生まれる（PHILOSOPHY #2 の懸念）

### B. 新エンティティ型 `GeometricBinding` を作成

```js
class GeometricBinding {
  constructor(id, sourceId, hostId, hostToLocal) { ... }
}
```

- SpatialLink とは明確に分離される
- 「型が能力を決める」(PHILOSOPHY #2) に完全に従う
- 新しいエンティティ型が増え、taxonomy が複雑になる

### C. Map エンティティ自体に `hostId` フィールドを追加

CoordinateFrame の `parentId` と同様に、Map エンティティ自体が
ホストへの参照を持つ。

- シンプルだが、Undo/Redo は「エンティティ更新」として扱う必要がある
- バインドとエンティティ作成が分離できない

---

## Decision（草案 — 議論中）

### 方針：A案（SpatialLink拡張）を採用

理由：

1. `linkType` の違いによる振る舞いの違いは **ドメイン層ではなくサービス層** で処理する。
   `SpatialLink` 自体は「関係の記録」に留まり、能力（geometric binding）は
   `SceneService` の constraint-solver が担う。これは PHILOSOPHY #3
   （Pure Computation / Side Effect の分離）と整合する。

2. PHILOSOPHY #2 の「型が能力を決める」は、エンティティの振る舞いメソッドについての原則。
   `SpatialLink` 自体には振る舞いメソッドがない（純粋なデータ記録）。
   サービス層が `linkType` を見て処理を分岐することは、ドメイン型の汚染ではない。

3. 作成 UI（`L` キー → 対象選択 → 種別選択）をほぼそのまま再利用できる。

### 1. SpatialLink `linkType` 語彙の拡張

| linkType | 意味 | 幾何学的拘束 |
|----------|------|------------|
| `references` | ソースがターゲットの位置基準を参照する | なし |
| `connects`   | ルートがソース・ターゲットを論理的に結ぶ | なし |
| `contains`   | 領域ソースがエンティティターゲットを内包する | なし |
| `adjacent`   | 隣接・境界共有 | なし |
| **`mounts`** | **ソースがターゲット表面上に幾何学的に固定される** | **あり** |

`mounts` は有向（source = Map要素、target = ホストSolid）。

### 2. SpatialLink のデータ拡張

`mounts` タイプのみ、追加フィールド `hostToLocal` を持つ。

```js
class SpatialLink {
  constructor(id, sourceId, targetId, linkType, hostToLocal = null) {
    this.id          = id
    this.sourceId    = sourceId
    this.targetId    = targetId
    this.linkType    = linkType
    // mounts 専用。他の linkType では null。
    // hostToLocal = マウント時の host.worldPose の逆行列（Float32Array[16]）
    this.hostToLocal = hostToLocal
  }
}
```

### 3. 座標空間の変換戦略

**マウント時（一度だけ）：**
- Map要素の全頂点をワールド空間 → ホストローカル空間に変換して上書き保存
- `hostToLocal = host.worldPose.clone().invert()` を SpatialLink に記録

```
localVertex = hostToLocal × worldVertex
```

**毎フレーム（`_updateWorldPoses()` 内）：**
- `mounts` リンクを持つ全Map要素について：

```
worldVertex = host.currentWorldPose × localVertex
```

**マウント解除時：**
- 逆変換で全頂点をワールド空間に戻す
- `mounts` SpatialLink を削除

### 4. Grab の動作変更

マウント済みMap要素を Grab する場合：

- 移動平面をワールドXYではなく **ホストのローカルXY平面** に拘束
- ホストが傾いていれば、その傾きに沿って動く

Grab終了時：移動後のローカル頂点を確定値として保存。

### 5. ホストSolidが削除された場合

- `mounts` リンクが dangling になる（ADR-030 の既存ポリシーと同じ）
- SceneService の `_updateWorldPoses()` はホストが存在しなければスキップ
- Map要素は最後の計算済みワールド位置で静止する
- Outliner に "broken mount" インジケータを表示する（将来拡張）

### 6. 作成 UI

既存の SpatialLink 作成フロー（`L` キー）を拡張：

1. Map要素を選択 → `L` キー
2. ステータスバー「Click host object」
3. Solidをクリック → リンク種別ピッカーに **「Mount on surface」** ボタンを追加
4. 確定 → `createSpatialLinkCommand` でUndoスタックに積む

Mount後、Map要素の選択ハイライトに「⊕」バッジ（mounted状態）を表示。

### 7. シリアライズ

`mounts` SpatialLink は `hostToLocal` を16要素の数値配列で保存：

```jsonc
{
  "type": "SpatialLink",
  "id": "link_007",
  "sourceId": "annot_point_001",
  "targetId": "solid_003",
  "linkType": "mounts",
  "hostToLocal": [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]
}
```

ロード時：`mounts` リンクを最後に処理（ホストSolidの `worldPose` が確定した後）。
これは CoordinateFrame の `parentId` 解決と同じ deferred パターン。

---

## 未解決の議論点

### Q1: ホスト対象をSolidに限定するか？

現設計：`targetId` は任意のシーンエンティティ。ただし初期実装では
Solidのみを有効なホストとする（UI側でガード）。

将来：ImportedMesh の特定フェイス、CoordinateFrame なども
ホストになりうるか？

### Q2: 「表面のどのフェイス」かを指定するか？

現設計：Solidのトップフェイス（+Z方向の面）をデフォルトとする。
フェイス指定は実装しない（V1）。

将来：フェイス選択ヒットテストで指定フェイスのローカルXY平面に拘束。

### Q3: 1つのMap要素が複数のホストに `mounts` できるか？

現設計：1対1（1つのMap要素に1つの `mounts` リンクのみ許可）。
複数の `mounts` リンクを持つ場合は最初の1つを使用。

### Q4: 名称について

「mounts」以外の候補：`hostedOn`, `attachedTo`, `boundTo`

---

## 影響範囲

### 追加

- `SceneService._resolveGeometricBindings()` — `_updateWorldPoses()` から呼ばれる constraint-solver
- `SceneService.mountAnnotation(sourceId, hostId)` — バインド作成
- `SceneService.unmountAnnotation(linkId)` — バインド解除

### 変更

- `SpatialLink` — `hostToLocal` フィールドを追加
- `SceneService._updateWorldPoses()` — `mounts` リンク処理を追加
- `SceneService._grab*()` — マウント済みエンティティの移動平面拘束
- `AppController._handleMobileTransform()` — 同上
- `SceneSerializer` / `SceneImporter` — `mounts` の `hostToLocal` を処理

### 変更しない

- `SpatialLink` のドメインメソッドはない（データ記録のまま）
- 既存の `linkType` の振る舞いはすべて維持

---

## 今後のステップ（実装フェーズ外）

- Phase M-1: constraint-solver + Grab拘束
- Phase M-2: 作成UI（L キーフロー拡張）
- Phase M-3: シリアライズ
- Phase M-4: ホストSolid削除時の broken-mount UI

---

## References

- ADR-029 — Spatial Annotation System（AnnotatedLine/Region/Point）
- ADR-030 — SpatialLink（`mounts` の Out of scope として予告）
- ADR-016 — Transform Graph（座標変換の基本設計）
- ADR-018, ADR-019 — CoordinateFrame（parentId/deferred解決の先例）
- PHILOSOPHY #2 — Type Is the Capability Contract
- PHILOSOPHY #3 — Separate Pure Computation from Side Effects
- PHILOSOPHY #21 — Coordinate Spaces Are Statically Distinguished
