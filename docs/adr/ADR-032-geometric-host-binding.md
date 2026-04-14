# ADR-032 — Geometric Host Binding: Spatial Constraint Vocabulary for SpatialLink

| Field | Value |
|-------|-------|
| **Status** | Proposed |
| **Date** | 2026-04-13 |
| **References** | ADR-029, ADR-030, ADR-016, ADR-018, ADR-019 |

---

## Context

### 発端となった問題

Map要素（`AnnotatedLine` / `AnnotatedRegion` / `AnnotatedPoint`）を Grab すると
Z 方向に浮いてしまい、「この経路は装置の上面に貼られている」という意味が失われる。
「対象物の上に Map 要素を置く」という操作ニーズが起点。

### SpatialLink の本質的な再解釈

ADR-030 は `SpatialLink` を「意味的なアノテーション（非拘束）」と定義したが、
設計を深掘りすると、`linkType` とは**英語の前置詞に対応する空間的・論理的拘束の種別**
であることが分かる。

| 前置詞 | linkType | 拘束の性質 |
|--------|----------|-----------|
| on, at | `mounts` | 幾何学的（座標変換） |
| attached to | `fastened` | 幾何学的（剛体結合） |
| aligned with | `aligned` | 幾何学的（回転） |
| in, inside | `contains` | 位相的（包含） |
| beside | `adjacent` | 位相的（境界共有） |
| above | `above` | 位相的（Z方向） |
| along, between | `connects` | 位相的（経路） |
| derived from | `references` | 意味的（基準参照） |
| depicts | `represents` | 意味的（表現） |

SpatialLink は Map 要素専用ではない。トレーに入ったスマホ、
機器に取り付けられたセンサー、壁に接する棚——あらゆるエンティティ間の
空間的関係を記述できる。

### CoordinateFrame がリンクの単位

「Solid に対してマウントする」では曖昧。Solid は複数の基準点を持てる
（重心、穴の中心、コーナーなど）。**リンクの両端は CoordinateFrame** であるべき。

```
Phone.Bottom ──mounts──> Tray.Interior
     ↑                        ↑
CoordinateFrame         CoordinateFrame
```

これにより「どの面に対して」が明示され、同一 Solid の異なるフレームへの
複数リンクも自然に表現できる。

### 5NF とフレームの遅延生成

「全ての考えられる特徴フレームを事前に生成する」ことは 5NF に反する。
`CoordinateFrame` エンティティは**関係を表現する必要が生じたときのみ**作成する。

```
悪い例（事前生成）:
  Solid_Tray → 自動生成: Origin, Interior, LeftWall, RightWall, Bottom ...
  → 関係を作らなくてもエンティティが増殖

良い例（遅延生成）:
  Solid_Tray → Origin のみ自動生成
  「スマホを入れる」関係を作るとき → Interior フレームを命名・作成
  「スマホを入れない」なら Interior フレームは存在しない
```

フレームが必要になるのは「その位置を参照する具体的な関係が生まれるとき」。
それ以前に存在する理由はない。これが 5NF の本質的な適用。

### 5NF で整理したデータの事実（facts）

| 事実 | 格納場所 |
|------|---------|
| 「AフレームとBフレームの間に拘束 X がある」 | SpatialLink(id, sourceId, targetId, linkType) |
| 「AフレームのローカルX座標は 1.5 m」 | CoordinateFrame.translation |
| 「エンティティEのローカル空間における頂点座標」 | AnnotatedLine/Region/Point の頂点データ |
| 「エンティティEのワールド座標（導出値）」 | SceneService._worldPoseCache |

マウント時の逆行列スナップショット（`hostToLocal`）は導出可能な時刻依存値であり、
SpatialLink に格納しない。

### 座標空間はグラフ構造で決まる

`mounts` グラフのルートノード（親なし）＝ワールド空間。
親ありノード＝親フレームのローカル空間。
`coordinateSpace` フラグをエンティティに持たせる必要はない—グラフが真実源。

```
CoordinateFrame_Tray.Interior  ← worldPose 既知
         ↑  mounts
AnnotatedPoint_001              ← 頂点は Tray.Interior のローカル空間
```

これは CoordinateFrame の `parentId` 階層と同一パターン。
SceneService の `_worldPoseCache` 合成ロジックを共有できる。

---

## Decision

### 1. SpatialLink データ構造（変更なし）

```js
class SpatialLink {
  constructor(id, sourceId, targetId, linkType) {
    this.id       = id
    this.sourceId = sourceId   // 推奨: CoordinateFrame ID
    this.targetId = targetId   // 推奨: CoordinateFrame ID
    this.linkType = linkType
  }
}
```

`sourceId` / `targetId` は任意のエンティティ ID を受け付けるが、
**精度が必要な関係では CoordinateFrame エンティティの ID を使う**。
canonical origin で十分な場合はエンティティ自身の ID でよい。

### 2. linkType 語彙 — 空間前置詞体系

ADR-030 の 4 種を包含し、拡張する。

#### カテゴリ A — 幾何学的拘束
SceneService が `GEOMETRIC_LINK_TYPES` として認識し、毎フレーム座標変換を適用。

| linkType | 対応前置詞 | 意味 | 拘束の種類 |
|----------|-----------|------|-----------|
| `mounts` | on / at | source の頂点座標が target フレームのローカル空間で定義される | 位置 + 姿勢（完全束縛） |
| `fastened` | attached to / fixed to | source フレームが target フレームに剛体固定される | 6-DOF 剛体結合 |
| `aligned` | aligned with | source の主軸が target の主軸に一致する | 回転のみ |

#### カテゴリ B — 位相的拘束
空間的な構造関係を記録。変換なし。グラフクエリ・解析に使用。

| linkType | 対応前置詞 | 意味 |
|----------|-----------|------|
| `contains` | in / inside | source の領域 / 体積が target エンティティを包含する |
| `adjacent` | beside / next to | source と target が境界を共有または隣接する |
| `above` | above / over | source が target の上方にある（Z 方向） |
| `connects` | between / along | source 経路が source〜target 間を結ぶ |

#### カテゴリ C — 意味的拘束
幾何処理なし。可視化・ドキュメンテーション用途。

| linkType | 対応前置詞 | 意味 |
|----------|-----------|------|
| `references` | derived from | source が target の位置基準を参照する（公差チェーン） |
| `represents` | depicts | source エンティティが target の概念を表現する |

#### 論理的整合性（validation）

UI はリンク作成時に以下の組み合わせのみ許可する：

| linkType | source に有効な型 | target に有効な型 |
|----------|-----------------|-----------------|
| `mounts` | Annotated\* | CoordinateFrame / Solid |
| `fastened` | Solid / CoordinateFrame | Solid / CoordinateFrame |
| `aligned` | CoordinateFrame | CoordinateFrame |
| `contains` | AnnotatedRegion | 任意 |
| `adjacent` | 任意 | 任意 |
| `above` | 任意 | 任意 |
| `connects` | AnnotatedLine | 任意 |
| `references` | 任意 | 任意 |
| `represents` | 任意 | 任意 |

### 3. SceneModel — mounts インデックス

`addLink` / `removeLink` が `_mountsIndex`（sourceId → linkId）と
`_mountedByIndex`（targetId → Set\<sourceId\>）を自動維持。
（実装済み — 前コミット参照）

```js
getMountsLink(sourceId)     // → SpatialLink | null  O(1)
getMountedLinks(targetId)   // → SpatialLink[]        O(k)
```

### 4. CoordinateFrame の遅延生成フロー

関係作成 UI が CoordinateFrame 生成を兼ねる。

```
ユーザー操作:
  1. 「Solid_Tray に Interior フレームを追加」
     → CoordinateFrame を Solid_Tray の子として作成・命名
  2. AnnotatedPoint を選択 → 「Mount on frame ⊕」
     → Tray.Interior フレームをタップ
     → SpatialLink(source=AnnotatedPoint, target=CF_Interior, linkType='mounts') 作成
```

関係を作らないなら CF_Interior は存在しない。

### 5. 座標変換の設計

#### マウント時（一度だけ）

```
hostPose H = worldPoseOf(link.targetId)  // targetId = CoordinateFrame or Solid
localVertex = H.inverse × worldVertex    // 全頂点を上書き保存
```

#### 毎フレーム（_updateWorldPoses() 内）

```js
for (const link of model.getMountedLinks(frameId)) {
  const source = model.getObject(link.sourceId)
  const hostPose = worldPoseOf(link.targetId)
  source.vertices.forEach(v => {
    v._worldPosition = hostPose.applyToVector3(v.position)
  })
}
```

#### マウント解除時

```
worldVertex = hostCurrentPose × localVertex  // 全頂点をワールド空間に戻す
SpatialLink を削除
```

### 6. Grab の動作変更

マウント済み Annotated\* を Grab する場合、移動平面を
**host フレームのローカル XY 平面**に拘束する。
未マウント時は Z 変化を防ぐためワールド XY 平面に拘束（既存バグ修正も兼ねる）。

### 7. Undo / Redo

`MountAnnotationCommand(linkId, sourceId, targetId, verticesBeforeMount)` を新設。

- `execute()` — 頂点変換 + SpatialLink 作成（アトミック）
- `undo()` — `verticesBeforeMount` で頂点復元 + SpatialLink 削除

マウントは「頂点データ変換 + リンク作成」の不可分操作。
既存 `createSpatialLinkCommand` とは別コマンドとする。

### 8. 作成 UI — PC

`L` キーフロー拡張：

1. エンティティ選択 → `L` キー
2. ステータスバー「Click target frame or object」
3. CoordinateFrame / エンティティをクリック
4. linkType ピッカー（validation テーブルで有効な種別のみ表示）
5. 確定 → コマンドをプッシュ

### 9. 作成 UI — Mobile

#### コンテキストメニュー拡張

`_showLongPressContextMenu()` において、対象エンティティの型と
マウント状態に応じてアイテムを条件分岐：

| 対象型 | 状態 | 追加アイテム |
|--------|------|------------|
| Annotated\* | 未マウント | **「Mount on frame ⊕」** |
| Annotated\* | マウント済み | **「Unmount ⊗ \<フレーム名\>」** |
| Solid / CoordinateFrame | — | **「Link to... 🔗」**（汎用リンク作成） |

#### マウントフロー（2フェーズ）

**フェーズ1 — ターゲットフレーム選択**

「Mount on frame ⊕」タップ後：
- `_mountPicking = { active: true, sourceId }` に遷移
- シーン内の CoordinateFrame インジケータを強調表示（他は半透明）
- ステータスバー：「Tap target frame (or empty space to cancel)」
- OrbitControls は**有効のまま**

**フェーズ2 — 確定 / キャンセル**

| ユーザー操作 | 結果 |
|------------|------|
| CoordinateFrame / Solid をタップ | validation 通過 → `MountAnnotationCommand` |
| 空白をタップ | キャンセル |
| ステータスバー ✕ | キャンセル |

#### 汎用リンクフロー

「Link to... 🔗」タップ後：
- `_linkPicking = { active: true, sourceId }` に遷移（既存フロー）
- ターゲット選択後、linkType ピッカーを表示（validation 済みのもののみ）

#### アンマウント

「Unmount ⊗」タップ → 確認なしで即時実行（Undo 可）。

#### 状態変数

```js
_mountPicking = { active: false, sourceId: null }  // mounts 専用
// _linkPicking は既存（汎用リンク用）
```

### 10. シリアライズ（変更なし）

```jsonc
{
  "type": "SpatialLink",
  "id": "link_007",
  "sourceId": "annot_point_001",
  "targetId": "cf_tray_interior",
  "linkType": "mounts"
}
```

ロード時：`mounts` リンクはホストエンティティの worldPose 確定後に処理
（CoordinateFrame の parentId 解決と同じ deferred パターン）。

---

## グラフ構造の整合性

### 木構造（初期実装）

各 Annotated\* エンティティは高々 1 つの `mounts` 親を持つ。
SceneService はトポロジカルソートで親から子の順に worldPose を合成。

### 循環検出

`mounts` グラフに循環が検出された場合、SceneService は
循環エッジを無視してコンソール警告を出す。

---

## Consequences

### Benefits

- `SpatialLink` のデータ構造に変更なし
- linkType が英語前置詞体系として直感的に拡張可能
- Map 要素以外（Solid 間、CF 間）の空間関係も同一フレームワークで表現
- CoordinateFrame の遅延生成によりエンティティ爆発を防止（5NF）
- CoordinateFrame 階層と同一アルゴリズムで worldPose を合成

### Constraints

- マウント時に頂点データが書き換わる。座標空間はグラフ構造で判断可能
- Undo で `verticesBeforeMount` を保持（MAX=50 のスタック上限で自然に制約）
- ホスト削除時は dangling — 最後のワールド位置で静止（ADR-030 ポリシーを継承）

### Out of scope

- `fastened` / `aligned` の constraint-solver 実装（語彙は定義済み、実装は別フェーズ）
- 多段マウント（Annotated\* → Annotated\*）— 将来の DAG 対応
- broken-mount インジケータ — 将来拡張

---

## References

- ADR-029 — Spatial Annotation System
- ADR-030 — SpatialLink（意味的リンクとして設計; 本 ADR で幾何学的拘束を追加）
- ADR-016 — Transform Graph
- ADR-018, ADR-019 — CoordinateFrame（parentId 階層の先例）
- PHILOSOPHY #2 — Type Is the Capability Contract
- PHILOSOPHY #3 — Separate Pure Computation from Side Effects
- PHILOSOPHY #21 — Coordinate Spaces Are Statically Distinguished
