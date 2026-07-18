# templates/ (レイヤ C: 売り物テンプレ = 2a)

完成した bin-picking 把持姿勢探索テンプレ群。手で書ききった完成 DSL。

各テンプレに必須:
- 対応 `version` (例: "layout/1.0") を埋め込む。
- 手検証の注記「IK 可 / 干渉なし / リーチ内を確認済み」(将来 core/ の受け入れテストになる)。
- OpenQuestion (現場で必ず聞かれる曖昧点) を添える。

配布は Booth/Gumroad の zip。ソース管理はここ。

## テンプレ一覧

- `bin-picking-thin-container/` - 薄型コンテナ + ランダム平置きワークの grasp search
  (上面 top-down 把持。壁・隣接ワークは球近似)。
