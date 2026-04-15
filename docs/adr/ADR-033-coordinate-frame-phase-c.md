# ADR-033 — CoordinateFrame Phase C: Interface Contract Model

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-04-15 |
| **Supersedes (partially)** | ADR-018 §Auto-Origin, CODE_CONTRACTS §Auto Origin Frame |
| **References** | ADR-018, ADR-019, ADR-032, ADR-030 |

---

## Context

### Phase A / B で積み上げた設計負債

ADR-018（Phase A）は CoordinateFrame を「ジオメトリオブジェクトの原点に
名前付き座標フレームを割り当てる」ものとして設計した。その結果：

```js
// Phase A/B での実装 (CODE_CONTRACTS §Auto Origin Frame)
createCuboid()        → createCoordinateFrame(id, 'Origin')
extrudeSketch()       → createCoordinateFrame(id, 'Origin')
duplicateCuboid()     → createCoordinateFrame(id, 'Origin')
```

Solid を作ると必ず "Origin" フレームが生まれる。

### 問題：なぜ Origin が生まれるのか

「モデル作成者が作業の出発点として選んだ点」は、他エンティティとの
インタフェースとしての意味を持たない。

3D CAD の工程を分けて考えると：

| フェーズ | 内容 | CoordinateFrame は必要か |
|---------|------|------------------------|
| **外形定義** | 部品の形状・寸法を決める | **不要** — 原点は作業都合 |
| **アッセンブリ** | 部品間の取り付け関係を定義する | **必要** — ここで初めてインタフェースが生まれる |

auto-Origin は「外形定義フェーズ」に「アッセンブリフェーズ」の構造物を
持ち込んでいた。CoordinateFrame がない状態でフレームの位置をどう記述するか
という実装上の問題を解決するための妥協策であり、設計負債として認識する。

### 暗黙のローカル空間

Solid は `corners`（頂点の LocalVector3 配列）を持つ。
これがそのまま Solid の**暗黙のローカル座標系**を定義する。

```
Solid のローカル空間（暗黙、エンティティ化しない）:
  X軸 = corners[0] → corners[1] 方向
  Z軸 = 上面法線
  原点 = 重心（or corners[0]）

CoordinateFrame "TopCenter" を置く場合:
  translation = {x: 0, y: 0, z: height}  ← Solid のローカル空間で記述
  parentId = solid.id                      ← Solid に直接ぶら下がる
```

auto-Origin エンティティを「参照点」として必要とする理由はなくなる。

### CoordinateFrame の本質的な意味

CoordinateFrame は**空間的インタフェース契約**である。

- 「このエンティティのこの点/面において、別のエンティティと関係を持つ」
  という事実を幾何学的に仕様化したもの
- SpatialLink (`mounts`, `fastened`, `aligned` …) の**端点**として機能する
- 関係が生まれる（アッセンブリ）ときにのみ作成する動機が生じる
- 関係と独立して存在する意味を持たない（ただし削除は強制しない — 後述）

---

## Decision

### 1. Auto-Origin の廃止

`createCuboid()` / `extrudeSketch()` / `duplicateCuboid()` は
CoordinateFrame を自動生成しない。

**移行方針：**
- 既存シーン（シリアライズ済み）の "Origin" フレームはそのまま読み込む
- 新規作成 Solid には Origin フレームを付けない
- シリアライザはバージョンを問わず "Origin" フレームを保持する
  （後方互換性のため削除しない）

**CODE_CONTRACTS §Auto Origin Frame は本 ADR により Supersede。**

### 2. CoordinateFrame の作成動機

CoordinateFrame を新規作成する正当な動機は以下に限る：

| 動機 | 例 |
|------|---|
| **SpatialLink の端点として** | "Mount on Interior" — `mounts` リンクを張るために作成 |
| **アセンブリ基準点として** | "Datum Hole A" — 設計者が意図する基準点を命名 |
| **ユーザーの明示的な操作** | N パネルの「Add Frame」ボタン |

「とりあえず原点に置く」という動機での自動生成は行わない。

### 3. parentId の制約（Phase C）

`CoordinateFrame.parentId` は**ジオメトリエンティティ（Solid / AnnotatedLine /
AnnotatedRegion / AnnotatedPoint / ImportedMesh）の ID** でなければならない。

Phase B で許可した CoordinateFrame → CoordinateFrame の入れ子チェーンは
Phase C では使用しない（既存データは読み込み可、新規作成は Solid 直結のみ）。

理由：
- インタフェース点は「このエンティティのこの場所」であり、
  「あるフレームの子フレームの子フレームの場所」ではない
- 入れ子チェーンが必要なユースケースは、別の SpatialLink チェーンで表現できる

> Phase D で DAG ベースの多段アセンブリが必要になれば、この制約を再考する。

### 4. CoordinateFrame のライフサイクル

#### 作成
- ユーザーが明示的に「この点にフレームを作る」操作をしたとき
- SpatialLink 作成 UI フロー内で端点として命名・作成するとき

#### 削除
CoordinateFrame を参照している SpatialLink が存在する場合、削除を**警告付きで許可**：

```
「Frame 'Interior' は 2 つの SpatialLink から参照されています。
  削除すると、それらのリンクは dangling になります。削除しますか？」
```

強制削除はしない。SpatialLink 側で dangling を表示する（ADR-030 ポリシー継承）。

#### 参照がなくなった場合
CoordinateFrame を参照する SpatialLink がなくなっても、フレームは残る。
ただし N パネル・Outliner に「参照なし」バッジを表示する。

### 5. CoordinateFrame の作成 UI

#### PC
- N パネル「Frames」セクション → 「+ Add Frame」ボタン
- SpatialLink 作成フロー（`L` キー）の中で「New frame at…」オプション

#### Mobile
- 対象エンティティを長押し → コンテキストメニュー →
  **「Add interface frame ⊞」**
- SpatialLink 作成フロー（「Link to…」）の中で
  「New frame on this object」オプション

### 6. entity の暗黙ローカル空間の定義

各エンティティ型における暗黙ローカル空間の原点と軸：

| エンティティ型 | 暗黙原点 | Z+ 方向 |
|--------------|---------|--------|
| `Solid` | corners の重心 | 上面法線 |
| `AnnotatedPoint` | 頂点位置 | world Z |
| `AnnotatedLine` | 頂点列の中点 | world Z |
| `AnnotatedRegion` | 頂点列の重心 | world Z |
| `ImportedMesh` | バウンディングボックス重心 | world Z |

CoordinateFrame の `translation` はこのローカル空間で記述される。
`SceneService._worldPoseCache` はこの暗黙空間をもとにワールド座標を合成する。

---

## Consequences

### Benefits

- Solid 作成がシンプルになる（自動生成エンティティなし）
- CoordinateFrame の存在が「何かとの関係がある」を意味するようになる
- Outliner が "Origin" だらけにならない
- SpatialLink の端点として CoordinateFrame を使う設計（ADR-032）と整合する

### Constraints

- 既存シーンの "Origin" フレームは legacy として残り続ける
- Phase B の CF → CF 入れ子チェーンは新規作成で使えなくなる
  （既存シーンの読み込みは継続対応）
- CoordinateFrame の「存在＝インタフェース契約」という意味の変化は、
  開発者の認知モデルの更新を要求する

### Migration

| 項目 | 対応 |
|-----|------|
| `createCuboid` 等からの `createCoordinateFrame` 呼び出し | 削除 |
| `CODE_CONTRACTS §Auto Origin Frame` | "Superseded by ADR-033" と明記して更新 |
| シリアライズ済みの "Origin" フレーム | 読み込み継続（削除しない） |
| Phase B の CF→CF 階層を使っている箇所 | 新規作成を Solid 直結に変更（既存は保持） |

---

## References

- ADR-018 — CoordinateFrame Phase A（本 ADR が §Auto-Origin を Supersede）
- ADR-019 — CoordinateFrame Phase B（Phase C は入れ子チェーンを新規作成で制限）
- ADR-032 — Geometric Host Binding（CoordinateFrame を SpatialLink 端点として使用）
- ADR-030 — SpatialLink（dangling ポリシー継承）
- PHILOSOPHY #19 — Documentation Drift Is a Bug
