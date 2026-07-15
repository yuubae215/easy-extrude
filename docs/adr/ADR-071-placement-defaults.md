# 071. 物理的妥当性の配置既定 — アシスト既定 vs ハード拘束

- Status: **Accepted**(2026-07-15 実装済 — 推奨どおり **A. アシスト既定** で確定)
- Date: 2026-07-15
- Deciders: yuubae215, Claude
- 関連: ADR-069(UX パリティ・パス Phase 3)、GrabOperationHandler の stack/snap、PHILOSOPHY #11/#14/#25/#30

## Context — Goal と力学(§1.2 Goal)

ユーザ観察(UX 評価 #5, #6):
- 「地面以下にオブジェクトを配置することは実際ないのではないか？」
- 「物体が重なり合うことは実際はないだろうから、デフォルトがスタック配置操作でいい気がする」

現状(Explore で確認):
- **地面下**: `AppController._groundPlane`(Z=0)は raycast の的としてのみ使われ、**Z<0 を
  禁じるクランプはどこにも無い**。ドラッグで自由に地面下へ行ける。
- **重なり/スタック**: `GrabOperationHandler` の `stackMode` は既定 **OFF**。`_applyStackSnap`
  は下方レイで直下面に載せる処理を持つが、`S` キー/モバイル Stack ボタンでの **opt-in**、
  かつジェスチャごとに OFF にリセット。既定では自由に重なれる。

**Goal**: *配置の既定が実世界の物理的妥当性(地面の上・非貫入)を初期状態で表現し、
ユーザが「正しく置く」ために毎回モードを切り替えなくてよいこと。* ただしエディタの
自由度(意図的な自由配置・下部構造)を殺さないこと。

**決定を左右する設計テンション(#5 vs #8)**: 基礎・杭・フーチングは *literally 地面下*で
あり、`IfcFooting`/`IfcPile` は IFC レジストリに既に存在する(ADR-070 で活用予定)。
つまり **ハード Z≥0 クランプは #8 が強化したい産業モデリングを壊す**。この矛盾が本 ADR の
核心。

## Options considered

**A. アシスト既定(推奨)** — 既定を「物理的に妥当」へ寄せるが、拘束はしない:
- スタックスナップを既定 ON にする(`S`/モバイルボタンは今後「無効化」トグル =
  意図的な自由/重なり配置の脱出口)。
- 地面下に着地しそうなドラッグは、**警告トースト + 地面スナップ補助**を出す(ハード
  クランプしない)。基礎/杭は警告を無視して下げられる。
- 非ブロッキングな grab 体験(#14 optimistic)を維持。

**B. ハード拘束** — Z≥0 をクランプし、重なりを能動的に防ぐ。
- 心的モデルは単純だが、(1) 下部構造の正当なケースをブロック、(2) 文書化された既定
  (`stackMode:false`)を反転しつつ *逃げ場を消す*、(3) optimistic grab を pessimistic 化。
- #5 単独なら魅力的だが #8 と両立しない。

**C. 現状維持 / 後送り** — 変更しない。

## 判断(推奨 = A アシスト既定)

**「物理的妥当性は *既定と補助*で導き、*拘束*では強制しない」**。理由:
- #5 と #8 の矛盾は、ハードルールでなく **assistive default + 明示的脱出口**でしか
  同時に満たせない。基礎/杭は #8 の中核ユースケース。
- PHILOSOPHY #11(沈黙の失敗禁止): 地面下を黙ってクランプ = ユーザの操作を黙って
  書き換える = 最悪。**警告 + 補助**で可視化し、判断はユーザに残す。
- PHILOSOPHY #25(ガードはサービス述語に): 地面下/スタックの前提判定は
  `GrabOperationHandler` にインライン early-return せず、命名された述語に置く。
- PHILOSOPHY #30 / ADR-065: 地面スナップの係合は既存の **SnapFlash**(スタック係合
  フラッシュ)機構に乗せられる — 新しい演出を発明しない。

## Strategy(実装方針 — Accepted 後に着手)

- **#6 スタック既定 ON**: `GrabOperationHandler` の grab 状態初期化で `stackMode: true`。
  `S` キー/モバイル Stack ボタンは「スタック無効化(自由配置)」トグルへ意味反転
  (ラベル/ステータス文言も反転)。ジェスチャごとリセットも既定 ON 起点に。既存
  `_applyStackSnap`(公開 `Solid.move()` 経由・ADR-040)はそのまま再利用。
- **#5 地面下アシスト**: ドラッグ着地が Z<0 になるとき、`SceneService` の新しい純述語
  (例 `checkGroundClearance(ids, proposedZ)` → `{belowGrade, suggestedZ}`)で判定し、
  ハンドラは (a) 地面スナップ補助を提示 + (b) 警告トーストを一度出す(#11)。**クランプ
  しない** — ユーザは無視して下げられる(基礎/杭)。ガードはサービス述語に(#25)。
- **演出**: 地面/スタック係合は既存 `SnapFeedbackMath`/`SnapFlash` の対象を拡張(新規
  演出クラスを作らない)。reduced-motion は静的リング(既存挙動)。
- **docs**: `docs/STATE_TRANSITIONS.md`(grab サブステート = stack 既定・地面アシスト)、
  CODE_CONTRACTS(grab/stack 既定反転 + ground clearance 述語)、EVENTS(`S` キー意味反転)、
  本 ADR を Accepted 化。

## Consequences

- 初期状態が「地面の上・重ならない」= 産業/建築モデリングの直感に一致。自由配置は
  1 キー(`S`)で戻れる。
- 下部構造(基礎/杭)は警告を伴いつつ可能 = #8 と非対立。
- 文書化された既定(`stackMode:false`, ADR/EVENTS)の反転を伴うため、STATE_TRANSITIONS/
  EVENTS/CODE_CONTRACTS の同時更新が必須(#19 ドリフト禁止)。
- 契約・schema・DSL 版・BFF 無改変(純クライアント挙動)。

## Open question → 決定(2026-07-15)

- **A(アシスト既定)で確定**(ユーザ指示「最新の ADR の意思決定に従って実装」= 推奨案の承認)。

## 実装記録(2026-07-15)

- **スタック既定 ON**: `GrabOperationHandler.state.stackMode` 初期値 `true`。
  `confirm()`/`cancel()` が **true にリセット**(ジェスチャ終端で既定 ON へ復帰)。
  `start()` ではリセット **しない** — モバイルの object-mode Stack/Free ボタンは
  `start()` の前にトグルするため、入口リセットはその選択を握り潰す。
- **地面 = 暗黙の着地面**: `_applyStackSnap` は `highestHitZ = max(hit ?? -∞, 0)` —
  下に何も無ければ地面(Z=0)に載る。下方オブジェクトが地面より下なら地面が勝つ。
- **Z 軸明示移動は除外**: `apply()` の `stackApplies = stackMode && axis !== 'z'` —
  G→Z の垂直intent をアシストが黙って上書きしない(#11 系)。
- **述語**: `SceneService.checkGroundClearance(ids, tol=1mm)` →
  `{belowGrade, lowestZ, suggestedLift}`(純リード・クランプなし — #25)。
- **警告**: `GrabOperationHandler.warnIfBelowGrade()` — ジェスチャ 1 回だけ warn トースト
  (`groundWarned` フラグ; grab start / confirm / cancel / quick-drag start でリセット)。
  G-grab の自由/Z 拘束経路と quick-drag の stack-off 経路の双方から呼ぶ。
- **意味反転の可視化**: ステータスバーは stack-off 時 `Free (S: stack)` を表示、
  モバイルボタンはラベル `Stack`/`Free` で現モードを示す。infoBar `G > S` 文言反転。
- **演出**: 地面着地は既存 `stackSnapshot`/`SnapFlash`(緑)にそのまま乗る — 新規演出なし。
- E2E: stack テストを既定 ON 前提に反転(S 押下で `Free (S: stack)` 表示を検証)。
  unit 640 pass / typecheck clean / build clean / E2E 10 pass。契約・schema・BFF 無改変。
