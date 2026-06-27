<!--
配置: 各リポジトリの ./CLAUDE.md (または ./.claude/CLAUDE.md)。版管理しチームで共有する。
これは §4「設計された契約」チャネル。user CLAUDE.md の不変核(方法)に対する、本プロジェクトの
*インスタンス*(グラフ・層マップ・契約・goal ツリー)を入れる場所。
方針:
  - 200 行未満を維持(超えると adherence が落ちる)。詳細は別ファイルへ @import するか docs/ へ。
  - 真実の源は一つ(§1.1)。ビルド手順・デバッグ知見など Claude が自分で見つける類は
    ここに書かず auto memory に委ねる。ここには「人が設計して決めたこと」だけ。
  - HTML コメント(この囲み)は context 注入前に除去されるので token を食わない。記入後は消してよい。
  - [TODO] は埋めるか、未定なら行ごと削除する(空欄を残さない)。
-->

# <PROJECT_NAME>

一行要約: [TODO 何のための系か / 解いている Goal は何か]
詳細: @README.md

## ビルド・テスト
<!-- 真実の源は一つ。テストコマンドは .claude/test-command に置き、ここからは指さない方が安全
     (重複回避)。ここにはエントリポイントだけ。 -->
- 開発起動: [TODO]
- テスト: `.claude/test-command` に定義(evidence-before-commit hook が参照)

## 層マップ(OSI 流 / §1.3)
<!-- 関心の層と、各境界の「契約」。実装ではなく契約に依存させる。 -->
- [TODO 層 A]  ── 契約 → [TODO 何を保証/要求するか]
- [TODO 層 B]  ── 契約 → [TODO]
- [TODO 層 C]
<!-- 例:
- App 層      ── 契約 → 共有メモリの読み書き規約(スキーマ vN, ロック方針)
- RT 周期層   ── 契約 → 周期 T 以内に snapshot 更新、欠測時は前回値を保持
-->

## ドメイン境界・依存方向(§1.1 DDD / Clean Architecture)
<!-- bounded context = モデルの所有境界。依存はドメインへ内向き、ドメインは infra に依存しない。 -->
- 文脈境界: [TODO context 名 → 何を所有するか / aggregate root]
- 同名異義の切り分け: [TODO 例: "Order" は注文文脈と請求文脈で別モデル]
- 依存方向: [TODO ドメインが依存してよいもの / 依存してはならないもの(DB/framework)]

## 依存グラフ(§1.3)
<!-- 主要ノードと依存/データフロー辺。「ここを変えると何が壊れる?」に即答できる粒度で。
     大きいなら図を docs/architecture.md に置き、ここからは要点だけ。 -->
- [TODO node] → [TODO node]   (依存の向き / データの向きを明記)
- [TODO node] → [TODO node]
- 全体図: @docs/architecture.md  <!-- 無ければこの行を削除 -->

## 境界の契約(§1.3 黒箱)
<!-- 黒箱として扱うコンポーネントの 入力→出力 と不変条件。内部実装には立ち入らせない。 -->
- [TODO component]: in=[…] out=[…] 不変条件=[…]
- [TODO component]: in=[…] out=[…] 不変条件=[…]

## プロセス様態(§1.3 BPMN vs CMMN)
<!-- 主要フローが「決め打ち逐次(BPMN)」か「状態+事象の裁量処理(CMMN)」か。取り違え防止。 -->
- [TODO フロー名]: [BPMN | CMMN] — [TODO 一言根拠]

## 状態機械(§1.4)
<!-- lifecycle/mode/status を持つ実体ごとに。クラス定義より先の論理設計。
     状態は型/enum、不正状態は表現不能に。複雑なら図を docs/ へ。 -->
- [TODO 実体名]
  - 状態: [TODO S1, S2, S3 …]
  - 遷移: [TODO S1 --event[guard]--> S2 …]
  - 禁止遷移: [TODO 起きてはならない遷移]
  - 状態の権威: [TODO どこが source か(§1.1)]

## Goal ツリー(GSN / §1.2)
<!-- Goal ← Strategy ← Evidence。設計判断はこの鎖で説明できること。
     大きくなったら docs/goals.md へ。 -->
- **G1** [TODO 望む性質]
  - S: [TODO どう達成するか]
  - E: [TODO 根拠: test / type / bench / 参照]
- **G2** [TODO]
  - S: [TODO]
  - E: [TODO]

## 不変条件(§1.1)
<!-- このリポジトリで「壊してはならない」真実の源。Claude が冗長な第二の源を作らないための明示。 -->
- 真実の源: [TODO 例: スキーマ定義は db/schema.sql のみ。型は generate で導出]
- [TODO]

## このプロジェクト固有の上書き
<!-- 不変核(user CLAUDE.md)の既定をこのリポジトリで変える点があれば、ここに少数だけ。
     矛盾は任意に解決されるので、衝突する指示を増やさない。 -->
- [TODO / 無ければ削除]
