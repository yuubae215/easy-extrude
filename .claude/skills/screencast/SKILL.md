---
name: screencast
description: >
  Record the real easy-extrude app (or any web page) into a polished GIF / MP4 / WebM
  from a declarative JSON scenario (screencast/1.0 DSL) — README hero, feature demo,
  PR before/after clip, release-note animation. Animated cursor, keycap HUD,
  lower-third captions, title cards and a virtual zoom camera are drawn for you;
  capture runs on virtual time so software-rendered WebGL still comes out at a
  smooth 30 fps. Use whenever the user asks for a demo GIF/video, "hero gif",
  "画面収録", "録画", "デモ動画", "操作動画", "スクショ動画", "GIF を作って",
  or to re-shoot / change the README animation. Do NOT write ad-hoc Playwright
  recording scripts — write or edit a scenario instead.
---

# screencast — シナリオを書き、仮想時間で撮る

道具の正本は `tools/screencast/` (DSL リファレンス = `tools/screencast/README.md`、
設計判断 = ADR-160)。このスキルは**撮る手順と演出の判断**を持つ。機構は書き直さない —
変えるのはシナリオ (WHAT)・style (HOW IT LOOKS)・outputs (WHERE) だけ。

## 0. 前提 (一度だけ)

```bash
pnpm install                 # @playwright/test, ajv
which ffmpeg                 # 無ければ入れる (apt-get install -y ffmpeg)
```
Chromium は Playwright の既定を使う (`PW_CHROMIUM=/path/to/chrome` で上書き可)。
dev server はシナリオの `app.server` が自動で起こす (既に 5173 が応答すればそれを使う)。

## 1. 物語を先に決める (コードの前に 3 行)

1. **一文の約束** — 見た人が何を持ち帰るか (例: 「ブラウザで描いて押し出すだけで立体になる」)。
2. **章 = caption** — 3〜4 章。1 章 = 1 つの動詞。章名は 2〜4 語の英語 (README の読者向け)。
3. **長さ** — hero は 12〜18 s。最初と最後を同じ title card にしてループの継ぎ目を消す
   (先頭 `enter:false` = GIF のポスターフレーム、末尾 `exit:false`)。

## 2. シナリオを書く

`tools/screencast/scenarios/<id>.screencast.json` を新規に作る (既存を手本に)。

- 製品の操作経路は **library の macro を使う** (`library/easy-extrude.screencast.json`:
  `ee/new-blank-project`・`ee/add`・`ee/sketch-rect`・`ee/extrude`・`ee/orbit`)。
  無い操作が要るなら**先に library に macro を足す** — シナリオにメニュー経路を直書きしない
  (UI が変わったとき直す場所が 1 つで済む)。
- 3D の点は `{ "world": [x, y, z] }` (mm, ROS frame: +X 前 / +Y 左 / +Z 上) で指す。
  `canvas` の比率はカメラが変わると黙って別の物を指す。
- 製品の雑音 (オンボーディング等) は `app.storage` で事前に閉じる (`ee_tour: dismissed`)。
  製品の見た目を `app.css` で作り替えない — 嘘の画面になる。
- core の種で言えないことだけ plugin (`x-<ns>/<name>`) にする。手本 `plugins/page-eval.mjs`。

## 3. 回す (安い順)

```bash
pnpm screencast validate <file>        # schema + macro 展開 + plugin payload
pnpm screencast plan <file>            # 時間割 (ブラウザ不要)。章の間隔とテンポをここで見る
pnpm screencast record <file> --stills 2500,6000,9000 --frames-dir /tmp/stills   # 構図確認
pnpm screencast record <file>          # 本番 (≈1 s/frame — 15 s で ≈10 分。background で回す)
```

stills は ffmpeg の `xstack` で 1 枚に並べて目視する (Read で画像を見る)。見るべき点:
- 字幕・キー HUD が製品の UI (outliner・status bar・メニュー) と重なっていないか
  → `style.captions.inset` / `style.keys.inset` を動かす。
- `focus` のクロップが UI の部品を途中で切っていないか → zoom を下げるか、端に clamp させる。
- 操作後にカーソルが新しい物の上に残って hover の色が付いていないか → 一歩どける `move`。

## 4. 演出の規律 (animation-fx の品質ゲートをこの道具に写したもの)

overlay の動きは道具が持つ (linear 不使用・スタッガー・押下の squash・HUD の outBack 入場)。
シナリオ側で守るのは **時間** だけ:
- 操作と操作の間に 250〜500 ms の「間」を置く (`wait`) — 見る人の目が結果に追いつく時間。
- 大きな動き (orbit・zoom) は 1.2〜2.4 s、`inOutSine`/`inOutQuint`。クリックは 0.6〜0.9 s。
- `focus` は 1 シナリオで「寄る → 引く」の 1 往復まで。寄りっぱなしにしない。
- 1 画面で同時に動く主役は 1 つ (カーソルが動く間はカメラを動かさない)。

## 5. 出力と README

- GIF は README 用 (GitHub は相対パスの mp4 を README で再生しない)。幅 800〜960、15 fps、
  目安 ≤ 8 MB。MP4 は Release / PR 説明 / SNS 用に同時に出す。
- 置き場所は `docs/media/<id>.{gif,mp4}`。README の埋め込みは
  `<img src="docs/media/<id>.gif" alt="…" width="880">`。
- 撮り直しは git 履歴を太らせる。シナリオが変わったとき・UI が目に見えて変わったときだけ。

## 6. 道具を育てるとき

- core の種・欄を足す = schema の minor 版上げ。`src/actions.mjs` (+ `CORE_ACTIONS`) と
  `schema/screencast-1.0.schema.json` を**同じコミット**で変える (`pnpm test:screencast` が
  二表現のズレを落とす)。意味を変えるなら major (`screencast/2.0`)。
- フレームの絵を決める計算は `src/plan.mjs` / `actions.mjs` の純関数に置く。
  `overlay.browser.js` は数値を当てるだけ (イージングや時刻をそこで決めない)。
