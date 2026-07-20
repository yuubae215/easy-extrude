# templates/ (バックエンドレイヤ付属: core 受け入れフィクスチャ)

完成した bin-picking 把持姿勢探索テンプレ群。手で書ききった完成 DSL
(契約形式の grasp-search リクエスト実例 — `contractVersion` + `layoutVersion` 付き)。

役割と境界 (レイヤ規律の正準は ルート CLAUDE.md §スコープ境界):

- 消費者は `core/tests/test_templates.py` (受け入れテスト)。各テンプレの JSON を
  バックエンドの判定エンジン (`core/`) がそのまま実行し、README の手検証値を自動検証する。
- テンプレは「解法」を持たない。hardConstraints (`reachable`/`ik_solvable`/`collision_free`)
  は参照名の宣言のみで、解くのは `core/` (越境は契約経由)。
- フロントの `examples/` (Layout/Context DSL — intake ギャラリーの fork&tweak 種) とは
  別物。こちらはバックエンドに投げる契約リクエストの完成例。

各テンプレに必須:
- 対応 `version` (例: "layout/1.0") を埋め込む。
- 手検証の注記を **3 ドメイン** で: 「見える (可視) / 届く (リーチ・IK・干渉) / 掴める
  (開口幾何) を確認済み」(ADR-081。`core/tests/test_templates.py` が受け入れテストとして
  検証する)。
- scene 形式 (`pick-sequence.request.json`) を正本にし、obstacles を手書きしない
  (属性からの導出 — ADR-078/081。単発の `grasp-search.request.json` は導出値のピン留め)。
- OpenQuestion (現場で必ず聞かれる曖昧点) を添える。

## テンプレ一覧

- `bin-picking-thin-container/` - 薄型コンテナ + ランダム平置きワークの grasp search
  (上面 top-down 把持。壁・隣接ワークは球近似)。
