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
Grab でZ方向に動かすと平面から浮いてしまい、
「この経路は装置の上面に貼られている」「このアンカーは機器上の基準点を指す」
といった意味が失われる。

### ユーザーが表現したいもの

- Solidオブジェクト（床、装置、壁など）の**表面**にMap要素を貼り付けたい
- ホストSolidを移動・回転させると、Map要素が**追随**してほしい
- Grab時はホストの表面内（ローカルXY平面）に拘束したい
- ホストは Solid に限らず、worldPose が計算可能な任意のエンティティ

### SpatialLinkの再解釈

ADR-030 は SpatialLink を「意味的なアノテーション（非拘束）」と定義し、
幾何学的拘束を Out of scope とした。

しかし根本を見直すと、`linkType` とは**論理的な拘束条件の種別**であり、
SpatialLink は元来「エンティティ間の拘束関係の記録」として設計されている。
`mounts` はその拘束の一種——「ソースの頂点座標がターゲットのローカル空間で定義される」
という拘束——であり、ad-hoc な拡張ではなく `linkType` 語彙の自然な延長である。

### 5NF の原則

データ構造は第五正規形（5NF）で設計する。

| 事実（fact） | 格納場所 |
|---|---|
| 「AとBの間に拘束関係 `mounts` がある」 | SpatialLink(id, sourceId, targetId, linkType) |
| 「A の頂点座標（ローカル空間）」 | AnnotatedLine/Region/Point 自身の頂点データ |
| 「A のワールド座標（導出値）」 | SceneService._worldPoseCache |

マウント時のホスト逆行列（`hostToLocal`）は別エンティティから導出可能な
時刻スナップショットであり、SpatialLink に格納しない。

### 座標空間はグラフ構造で決まる

Map要素が「ワールド空間にあるか／ホストローカル空間にあるか」は、
SpatialLink の `mounts` グラフを見れば分かる。

```
Solid_003 ← worldPose 既知
    ↑  mounts
AnnotatedPoint_001  ← 頂点はSolid_003ローカル空間
```

- **mounts 親なし（グラフのルート）** → 頂点はワールド空間
- **mounts 親あり** → 頂点は親エンティティのローカル空間

これは CoordinateFrame の `parentId` 階層と同一のパターンであり、
SceneService の `_worldPoseCache` 合成ロジックの自然な延長である。
`coordinateSpace` フラグを別途エンティティに持たせる必要はない。

---

## Decision

### 1. SpatialLink の `linkType` 語彙拡張

`SpatialLink` エンティティのデータ構造は変更しない：

```js
class SpatialLink {
  constructor(id, sourceId, targetId, linkType) {
    this.id       = id
    this.sourceId = sourceId   // Map要素
    this.targetId = targetId   // ホストエンティティ（Solid等）
    this.linkType = linkType
  }
}
```

`mounts` を語彙に追加する：

| linkType   | 有向？ | 意味                                              | 幾何学的拘束 |
|------------|--------|---------------------------------------------------|------------|
| `references` | yes  | ソースがターゲットの位置基準を参照する            | なし       |
| `connects`   | no   | ルートがソース・ターゲットを論理的に結ぶ          | なし       |
| `contains`   | yes  | 領域ソースがエンティティターゲットを内包する      | なし       |
| `adjacent`   | no   | 隣接・境界共有                                    | なし       |
| **`mounts`** | **yes** | **ソースの頂点座標がターゲットのローカル空間で定義される** | **あり** |

`mounts` は有向（source = Map要素、target = ホストエンティティ）。

### 2. ホストエンティティの要件

ターゲット（ホスト）になれるエンティティは、SceneService が
worldPose（位置・回転）を計算できるものに限る。

初期実装のホスト対象：
- `Solid` — 重心 + 上面法線から pose を導出
- `CoordinateFrame` — 明示的な pose を持つ

将来拡張（対象は `getSceneGraph()` のノード型に準じる）：
- `ImportedMesh` — バウンディングボックスから pose を導出

Map要素自身（AnnotatedLine 等）は初期実装ではホストにしない。
グラフが木構造（Tree）の範囲に留まる。

### 3. 座標変換の設計

#### マウント時（一度だけ）

1. SceneService がホストの `worldPose H` を取得
2. Map要素の全頂点を `localVertex = H.inverse × worldVertex` で変換し、上書き保存
3. `mounts` SpatialLink を作成（データ追加なし）

#### 毎フレーム（`_updateWorldPoses()` 内）

```js
// mounts リンクを持つ全Map要素について
const link = mountsLinkOf(entity)           // null なら世界空間
if (link) {
  const hostPose = worldPoseOf(link.targetId)
  entity.vertices.forEach(v => {
    worldVertex = hostPose.applyToVector3(v.local)
  })
}
```

CoordinateFrame 階層の合成と同じアルゴリズムを共有できる。

#### マウント解除時

1. ホストの現在の `worldPose H_current` を取得
2. 全頂点を `worldVertex = H_current × localVertex` で逆変換し、ワールド空間に戻す
3. `mounts` SpatialLink を削除

### 4. Grab の動作変更

マウント済みMap要素を Grab する場合：

- 移動平面をワールドXYではなく **ホストのローカルXY平面** に拘束
- ホストが傾いていれば、その傾きに沿って動く
- Grab 終了時：移動後のローカル頂点を確定値として保存

非マウント時の Grab はワールドXY平面に拘束（Z変化を防ぐ）。
これは `mounts` 実装に関係なく修正する（MAP要素が浮く問題の最小修正）。

### 5. 作成 UI — PC

既存の SpatialLink 作成フロー（`L` キー）を拡張する。

1. Map要素を選択 → `L` キー
2. ステータスバー「Click host object」
3. ホストをクリック → リンク種別ピッカーに **「Mount on surface ⊕」** ボタンを追加
4. 確定 → `MountAnnotationCommand` を Undo スタックに積む

Mount後、Outliner の該当行にバッジ「⊕」を表示。

### 5b. 作成 UI — Mobile

モバイルでは `L` キーが使えないため、コンテキストメニューと専用の
ホスト選択フローを用いる。既存の長押しコンテキストメニュー
（ADR-023 §2）を拡張する。

#### 5b-1. コンテキストメニュー拡張

`_showLongPressContextMenu()` において、対象エンティティが
`AnnotatedLine | AnnotatedRegion | AnnotatedPoint` の場合、
マウント状態に応じてアイテムを追加する：

| 状態 | 追加アイテム |
|------|------------|
| 未マウント | **「Mount on object ⊕」** |
| マウント済み | **「Unmount ⊗」** （ホスト名をラベルに表示） |

```
現在: [Grab, Rename, Delete]
拡張: [Grab, Mount on object ⊕, Rename, Delete]   ← 未マウント時
拡張: [Grab, Unmount ⊗ Solid_003, Rename, Delete] ← マウント済み時
```

#### 5b-2. マウントフロー（2フェーズ）

**フェーズ1 — ホスト選択**

「Mount on object ⊕」をタップすると：

1. コンテキストメニューを閉じる
2. AppController が `_mountPicking = { active: true, sourceId }` に入る
3. ステータスバー：「Tap host object (or tap empty space to cancel)」
4. 有効なホスト（Solid / CoordinateFrame）以外のオブジェクトを半透明（opacity 0.3）に
5. OrbitControls は**有効のまま**（タップとドラッグを区別するため）

**フェーズ2 — 確定 / キャンセル**

| ユーザー操作 | 結果 |
|-------------|------|
| 有効なホストをタップ | マウント確定 → `MountAnnotationCommand` |
| 無効なオブジェクトをタップ | 無視（ステータスバーでフィードバック） |
| 空白をタップ | キャンセル → `_mountPicking` リセット |
| ステータスバーの ✕ ボタン | キャンセル |

#### 5b-3. アンマウントフロー

「Unmount ⊗」タップ → 確認なしで即時実行（Undo 可能なため）。
`UnmountAnnotationCommand` を Undo スタックに積む。

#### 5b-4. 状態変数

```js
// AppController に追加
_mountPicking = { active: false, sourceId: null }
```

`_mountPicking.active` が true の間：
- `_onPointerDown` のタップ判定を乗っ取り、ホスト選択ロジックを実行
- 長押しタイマーは起動しない

#### 5b-5. モバイルツールバースロット

マウント選択中（`_mountPicking.active`）はツールバースロットに変化なし
（ADR-024 §固定スロット原則を守る）。
キャンセルはステータスバーの ✕ ボタンのみで行う。

### 6. Undo / Redo

`MountAnnotationCommand(linkId, sourceId, hostId, verticesBeforeMount)` を新設：

- `execute()` — 頂点を変換、SpatialLink 作成
- `undo()` — `verticesBeforeMount` で頂点を復元、SpatialLink 削除

既存の `createSpatialLinkCommand` / `deleteSpatialLinkCommand` とは別に作る。
マウントは「頂点データ変換 + リンク作成」の不可分なアトミック操作であるため。

### 7. シリアライズ

`mounts` SpatialLink は既存のシリアライズ形式で保存される（追加フィールドなし）：

```jsonc
{
  "type": "SpatialLink",
  "id": "link_007",
  "sourceId": "annot_point_001",
  "targetId": "solid_003",
  "linkType": "mounts"
}
```

ロード時の注意：マウント済みMap要素の頂点はローカル空間にある。
ホストSolid の worldPose が確定した後に `mounts` リンクを処理する
（CoordinateFrame の parentId 解決と同じ deferred パターン）。

---

## グラフ構造の整合性

### 木構造（初期実装）

各Map要素は高々1つの `mounts` 親を持つ。SceneService は：

1. `mounts` エッジを収集してトポロジカルソート
2. 親から子の順にワールド座標を合成

### 循環検出

`mounts` グラフに循環が発生した場合（A→B→A）、SceneService は
循環エッジを無視してコンソール警告を出す。

---

## Consequences

### Benefits

- `SpatialLink` のデータ構造に変更なし
- CoordinateFrame 階層と同一のアルゴリズムで worldPose を合成
- Map要素が Solid に追随するシナリオが自然に表現できる
- ホスト対象はインターフェースを満たす任意エンティティに拡張可能

### Constraints

- マウント時に頂点データが書き換わる（非マウント時とローカル空間が異なる）。
  座標空間はグラフ構造を見れば判断可能。
- Undo で `verticesBeforeMount` を保持する必要があり、大きなRegionではメモリコストが増える。
  （コマンドスタック上限 MAX=50 で自然に上限が決まる）
- ホストSolid が削除された場合は dangling — 最後のワールド位置で静止（ADR-030 既存ポリシー）。

### Out of scope

- **多段マウント（Map要素 → Map要素 → Solid）** — DAG対応は将来拡張
- **フェイス指定** — 初期実装はSolidのトップフェイスのXY平面のみ
- **broken-mount インジケータ** — ダングリング可視化は将来拡張

---

## References

- ADR-029 — Spatial Annotation System（AnnotatedLine/Region/Point）
- ADR-030 — SpatialLink（`mounts` を Out of scope として予告）
- ADR-016 — Transform Graph（座標変換の基本設計）
- ADR-018, ADR-019 — CoordinateFrame（parentId/deferred解決の先例）
- PHILOSOPHY #2 — Type Is the Capability Contract
- PHILOSOPHY #3 — Separate Pure Computation from Side Effects
- PHILOSOPHY #21 — Coordinate Spaces Are Statically Distinguished
