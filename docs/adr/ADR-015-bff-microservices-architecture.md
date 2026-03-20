# ADR-015: BFF + マイクロサービスアーキテクチャ

- **Status**: Proposed
- **Date**: 2026-03-20
- **References**: ADR-011, ADR-012, ADR-013

---

## Context

現在の easy-extrude はブラウザ完結のシングルページアプリケーションである。
ドメインエンティティ（Cuboid / Sketch / Vertex / Edge / Face）の生成・計算・状態管理を
すべてクライアント側の JavaScript で行っている。

この設計には以下の課題がある：

1. **UX 劣化リスク**: ジオメトリグラフ評価・STEP インポートなど計算量の多い処理が
   メインスレッドをブロックし、Three.js レンダーループの FPS を低下させる。

2. **フロントエンドの肥大化**: ドメインロジックが View / Controller と同一プロセスに
   混在することで、責務の分離が崩れやすい。ADR-011 の ApplicationService 層を設けても
   「重い計算をどこで走らせるか」という問題は解決されない。

3. **将来機能への対応困難**:
   - **Node Editor 風ジオメトリグラフ編集**: ノード間の依存伝播・再評価を
     ブラウザ内でリアクティブに行うと、複雑なグラフでは顕著に遅くなる。
   - **STEP / IGES インポート**: CAD カーネルの処理は数十〜数百 MB のメモリを要し、
     ブラウザ内 WASM で対応するより専用サービスに委ねる方が現実的。
   - **永続化・共有**: シーンデータや計算済みジオメトリをサーバー側 DB に保存し、
     URL 共有・履歴管理・将来のコラボレーションを可能にしたい。

4. **リポジトリロジックの排除**: フロントエンドに CRUD・楽観的ロック・排他制御などの
   永続化ロジックを持たせたくない。View と Controller の役割に専念させる。

---

## Decision

### 1. BFF (Backend for Frontend) を中間層として導入する

フロントエンドは **BFF のみ** を知る。マイクロサービスへの直接アクセスは行わない。

```
┌─────────────────────────────────────────────────────────────┐
│  Browser — easy-extrude                                      │
│  View (Three.js) + Controller (AppController)               │
│  ドメイン計算・DB・排他制御の知識をゼロにする                  │
└───────────────┬─────────────────────────────────────────────┘
                │  REST (CRUD)
                │  WebSocket (Geometry Stream)
                ▼
┌─────────────────────────────────────────────────────────────┐
│  BFF Server (Node.js)                                        │
│  ・JWT 認証ゲートウェイ                                       │
│  ・REST ルーティング → 各マイクロサービスへプロキシ            │
│  ・WebSocket セッション管理 → Geometry Service へ委譲         │
│  ・レスポンス形状をフロントエンド用に整形（アグリゲーション）   │
│  ・楽観的ロック（ETag / If-Match）の検証                      │
└──────┬──────────────┬──────────────┬───────────────────────┘
       │              │              │
       ▼              ▼              ▼
┌────────────┐ ┌────────────┐ ┌──────────────────────────────┐
│  Scene     │ │  User      │ │  Geometry Service             │
│  Service   │ │  Service   │ │  ・ジオメトリグラフ評価        │
│  シーン    │ │  認証 /    │ │  ・Node Editor グラフ計算     │
│  CRUD + DB │ │  プロファイ│ │  ・STEP / IGES インポート     │
│            │ │  ル        │ │  ・OBJ / GLTF エクスポート    │
└────────────┘ └────────────┘ └──────────────────────────────┘
```

### 2. 通信プロトコルの使い分け

| 用途 | プロトコル | 理由 |
|------|-----------|------|
| シーン保存・読み込み | REST (HTTP) | 単発リクエスト、キャッシュ制御が容易 |
| ユーザー認証 | REST (HTTP) | 標準的な JWT フロー |
| ジオメトリグラフ操作 | **WebSocket** | 操作→計算→結果のラウンドトリップが頻発するため |
| Node Editor ノード評価 | **WebSocket** | グラフ変更の伝播をストリームで受け取る必要がある |
| STEP / GLTF インポート | REST (multipart) + WebSocket progress | ファイル送信は REST、進捗は WebSocket |

### 3. フロントエンドの責務を View + Controller に限定する

```
現在 (クライアント完結)
  AppController → SceneService → Cuboid / Sketch / Vertex / Edge / Face
                                 ↑ ドメイン計算がここで走る

導入後 (Thin Client)
  AppController → SceneService → BFF (REST / WebSocket)
                  ↑ ローカルには「表示用キャッシュ」のみ保持
                    ドメイン計算・永続化の知識ゼロ
```

`SceneService` は HTTP / WebSocket クライアントとなり、
レスポンスから受け取ったジオメトリデータを `SceneModel` に反映する責務のみを持つ。
ドメインエンティティ（Cuboid / Sketch 等）はサーバー側で生成・評価される。

### 4. WebSocket メッセージ設計方針

メッセージは **操作ベース (Operation-based)** とする。

```jsonc
// フロント → BFF: グラフ操作
{ "op": "graph.node.connect", "sessionId": "...", "payload": { "from": "v3", "to": "e7" } }

// BFF → フロント: 計算結果（ジオメトリストリーム）
{ "type": "geometry.update", "objectId": "obj_0_xxx",
  "payload": { "positions": [...], "indices": [...], "normals": [...] } }

// BFF → フロント: 進捗通知
{ "type": "import.progress", "jobId": "...", "percent": 42 }
```

### 5. 段階的移行戦略

現在のクライアント完結動作を壊さず段階的に移行する。

| フェーズ | 内容 |
|---------|------|
| **Phase A** | BFF スケルトン構築。シーン保存・読み込みのみ REST で実装。フロント既存動作は維持 |
| **Phase B** | Geometry Service を分離。WebSocket セッション確立。Node Editor UI のプロトタイプ |
| **Phase C** | STEP インポートサービス追加。フロントのドメインエンティティをキャッシュ専用に縮小 |
| **Phase D** | フロントエンドを完全 Thin Client 化。Cuboid / Sketch のドメイン計算を全廃 |

---

## Consequences

### 良い点

- フロントエンドがドメイン計算から解放され、Three.js レンダリングに専念できる。
  FPS の安定性が向上し、複雑なシーンでも UX が落ちない。
- Geometry Service を独立スケールできる（重い STEP 変換だけ別インスタンスに振る等）。
- BFF がアグリゲーション・認証・形状整形を一手に引き受けるため、
  フロントのコードがマイクロサービスの内部変更に影響されない。
- STEP / IGES / GLTF など CAD ライブラリをサーバー側に閉じ込めることで、
  ブラウザバンドルを軽量に保てる。

### トレードオフ・制約

- **レイテンシ**: グラフ操作ごとにネットワークラウンドトリップが発生する。
  オフライン動作が必要な場合は別途検討する（現時点では対象外）。
- **移行コスト**: Phase D まで完全移行するには現在のフロントドメイン層の大幅な改修が必要。
  Phase A から段階的に進める。
- **WebSocket 状態管理**: サーバー側のセッション・グラフ状態を永続化する設計が別途必要。
  接続断・再接続時の整合性ポリシーは Phase B で ADR を追加する。
- **テスト戦略**: フロントの単体テスト対象が View / Controller に絞られる一方、
  Geometry Service のテストが重要になる。サービス境界での契約テストを検討する。

### 未決事項（Phase B で継続検討）

- Node Editor のグラフ状態はサーバー側 DB に持つか、セッション中のみインメモリか
- WebSocket 接続断時の再接続・差分同期プロトコル
- Geometry Service の計算グラフ表現（DAG）の永続化フォーマット
