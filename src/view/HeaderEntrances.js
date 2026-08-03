/**
 * HeaderEntrances — ヘッダの入口の**宣言表** (ADR-108 D1 / D2 / D3 / D4)。
 *
 * ## なぜ表が要るのか
 *
 * 入口が「動詞 × 対象」の直積で生えていた。`{持ち出す, 持ち込む} × {シーン, サーバ,
 * Context 文書}` が 6 つの平坦なボタンになり、`{始める} × {レイアウトテンプレ,
 * Context テンプレ, 物語, クエスト, 誘導フォーム}` が 5 つの入口になっていた。
 * **対象ごとに入口を生やすと、対象が増えるたびにヘッダが伸びる** — 伸びは有界でない。
 * ADR-060 が契約について禁じた「`optional` 兄弟を生やさない」の UI 版である。
 *
 * したがって:
 *
 *   - **入口は動詞で数える** (`HEADER_VERB`)。対象は入口ではなく**引数**
 *     (`FILE_TARGETS_BY_VERB` / `START_ENTRY_BY_KIND`) で、成長は入口の個数ではなく
 *     引数の値域に吸収される。
 *   - **未宣言の種で throw する** (`startEntryFor` / `fileTargetsFor` /
 *     `requirementReason`)。`EXPLICIT_DEFAULTS` (ADR-096) / `PLACEMENT_BY_KIND`
 *     (ADR-097) / `SELECTION_SHAPE_BY_KIND` (ADR-107) と同じ既定表の規律 —
 *     「今日の 5 種は全部到達できる」は事実であって規則ではない。
 *   - **住所の根拠は動詞であって表示条件ではない** (D4)。`Nodes` (Geometry DAG の
 *     編集器) が `Save` / `Load` の隣に居たのは「BFF 接続時のみ表示」という条件が
 *     一致していたからで、持ち出し / 持ち込みの動詞を持っていたからではない。
 *     ここでは `TOGGLE_SURFACE` (作業面を出し入れする) として分類する。
 *
 * ## 条件つき表示をやめた (実装で決めたこと)
 *
 * `Save` / `Load` / `Nodes` は BFF 未接続だと**消えていた**。消える入口は
 * 入口の個数を接続状態の関数にするので、D2 の上界が「どちらの数のことか」を
 * 持ってしまう。ここでは消さず `requires` を宣言し、満たされないときは
 * **理由つきで disabled** にする (原則 #15 固定スロット / 原則 #11 無言禁止)。
 * 判定と理由は同じ返り値から出る (`availabilityOf`)。
 *
 * 純粋: THREE も DOM も React も読まない — node の test runner が直接読める。
 *
 * @see docs/adr/ADR-108-entrances-are-verbs-not-objects.md
 * @see src/HeaderEntranceCensus.test.js (個数を問う場所)
 * @module view/HeaderEntrances
 */

// ── 動詞 (入口の個数はこの enum の大きさに従う) ────────────────────────────

/**
 * ヘッダの常設入口が担う**動詞**。
 *
 * 対象 (シーン / サーバ / Context 文書、レイアウトテンプレ / 物語 / …) はここに
 * 現れない — 対象は引数であって動詞ではない。ここに行を足すことがヘッダを
 * 伸ばす唯一の正当な経路であり、そのとき D2 の ratchet に当たる。
 */
export const HEADER_VERB = Object.freeze({
  /** モードを切り替える (Object / Edit — ADR-008)。 */
  SWITCH_MODE: 'switch-mode',
  /** 始める (種は `START_KIND` の引数)。 */
  START: 'start',
  /** 持ち出す (対象は `FILE_OBJECT` の引数)。 */
  EXPORT: 'export',
  /** 持ち込む (対象は `FILE_OBJECT` の引数)。 */
  IMPORT: 'import',
  /** 場を開く (交渉・作図・ゴースト・把持探索 — ADR-050 §4.4)。 */
  OPEN_FLOOR: 'open-floor',
  /** 発見の集約を読む (ADR-105 — 読みが主で、クリックはその出口)。 */
  READ_DISCOVERY: 'read-discovery',
  /** 作業面を出し入れする (Outliner / N パネル / Node Editor)。 */
  TOGGLE_SURFACE: 'toggle-surface',
  /** 一手戻す。 */
  UNDO: 'undo',
  /** 一手進める。 */
  REDO: 'redo',
  /** 狭い画面で入口そのものを畳む (モバイルの `⋯`)。 */
  OVERFLOW: 'overflow',
})

// ── 引数 1/2: ファイルの対象 (2 動詞 × 3 対象 → 2 入口) ────────────────────

/** 持ち出す / 持ち込む の**対象**。入口ではなく引数である。 */
export const FILE_OBJECT = Object.freeze({
  /** シーンの raw ジオメトリ (`.json` — ADR-050)。 */
  SCENE: 'scene',
  /** BFF が持つサーバ側のシーン。 */
  SERVER: 'server',
  /** Context 文書 (`.ctx.json` が正準 — ADR-050)。 */
  CONTEXT: 'context',
})

/** 引数が使える前提。満たされないとき入口は**消えず**理由を出す。 */
export const REQUIRES = Object.freeze({
  /** BFF に接続していること。 */
  BFF: 'bff',
  /** Context 文書を採択済みであること。 */
  CONTEXT_DOC: 'context-doc',
  /** 細かいポインタ (デスクトップ) であること。 */
  FINE_POINTER: 'fine-pointer',
})

/**
 * 前提ごとの**理由文**。未宣言の前提で throw する — 理由を持たない前提は
 * 「無言で押せないボタン」になり、原則 #11 が名指しする最悪の形になる。
 */
const REQUIREMENT_REASON = Object.freeze({
  [REQUIRES.BFF]:          'Not connected to the geometry server — start the BFF to use this target.',
  [REQUIRES.CONTEXT_DOC]:  'No context document adopted yet — start from a template or import one first.',
  [REQUIRES.FINE_POINTER]: 'The quest tour is a fine-pointer surface — on touch the one-shot gesture overlay covers it.',
})

/**
 * 前提 → 満たされないときの理由。
 *
 * @param {string} requirement `REQUIRES` の値
 * @returns {string} 人が読む理由
 * @throws {Error} 未宣言の前提
 */
export function requirementReason(requirement) {
  const reason = REQUIREMENT_REASON[requirement]
  if (!reason) {
    throw new Error(
      `[HeaderEntrances] undeclared requirement "${requirement}". ` +
      'Add a row to REQUIREMENT_REASON — a gate without a printable reason is a silent no-op (原則 #11).',
    )
  }
  return reason
}

/**
 * **宣言表 1/2** — 動詞ごとの対象。ここが「6 入口」を「2 入口 × 3 引数」に
 * 変えている本体である。
 *
 * `shortcut` は熟練者の近道 (ADR-108 の受け入れコスト: `Export` が 1 手から
 * 2 手になる)。**直近の対象を既定にはしない** — 既定を持つと「前回と違う対象へ
 * 保存したいのに気づかず上書きした」が起きるので、答えは既定を持たないこと。
 * 近道はキーバインドで持ち、対象は毎回明示する。
 */
export const FILE_TARGETS_BY_VERB = Object.freeze({
  [HEADER_VERB.EXPORT]: Object.freeze([
    Object.freeze({
      object: FILE_OBJECT.SCENE, label: 'Scene as JSON', callback: 'onExportJson',
      shortcut: 'Ctrl+E', requires: null,
      why: 'raw ジオメトリの持ち出し。ADR-050 が「Context を伴わないシーンは .json」と決めた対象。',
    }),
    Object.freeze({
      object: FILE_OBJECT.SERVER, label: 'Scene to server', callback: 'onSaveScene',
      shortcut: null, requires: REQUIRES.BFF,
      why: '同じ「持ち出す」で、宛先がファイルではなく BFF。動詞は同じなので入口も同じ。',
    }),
    Object.freeze({
      object: FILE_OBJECT.CONTEXT, label: 'Context document (.ctx.json)', callback: 'onExportCtxJson',
      shortcut: null, requires: REQUIRES.CONTEXT_DOC,
      why: '.ctx.json が正準 (ADR-050)。UI の都合でシーンと統合しない — 却下案 C。',
    }),
  ]),
  [HEADER_VERB.IMPORT]: Object.freeze([
    Object.freeze({
      object: FILE_OBJECT.SCENE, label: 'Scene from JSON', callback: 'onImportJson',
      shortcut: 'Ctrl+I', requires: null,
      why: '持ち出しの逆写像。対象が同じなので同じ引数名で並ぶ。',
    }),
    Object.freeze({
      object: FILE_OBJECT.SERVER, label: 'Scene from server', callback: 'onLoadScene',
      shortcut: null, requires: REQUIRES.BFF,
      why: 'BFF 未接続でも**消さない** — 消える入口は入口の個数を接続状態の関数にする。',
    }),
    Object.freeze({
      object: FILE_OBJECT.CONTEXT, label: 'Context document (.ctx.json)', callback: 'onImportCtxJson',
      shortcut: null, requires: null,
      why: '文書の採択そのものなので、文書が無い状態こそが正しい起点 (前提を持たない)。',
    }),
  ]),
})

/**
 * 動詞 → その対象たち。未宣言の動詞で throw する。
 *
 * @param {string} verb `HEADER_VERB.EXPORT` / `HEADER_VERB.IMPORT`
 * @returns {ReadonlyArray<object>} 対象 (引数) の並び
 * @throws {Error} ファイル動詞として宣言されていない動詞
 */
export function fileTargetsFor(verb) {
  const targets = FILE_TARGETS_BY_VERB[verb]
  if (!targets) {
    throw new Error(
      `[HeaderEntrances] "${verb}" is not a declared file verb. ` +
      'Add a row to FILE_TARGETS_BY_VERB — a new verb is a new entrance and must hit the D2 bound deliberately.',
    )
  }
  return targets
}

// ── 引数 2/2: 「始める」の種 (5 入口 → 1 入口) ─────────────────────────────

/**
 * 「始める」の**種**。5 つはそれぞれ正しい理由で作られた (ADR-089 / 051 / 047 /
 * 065 / 063) — 中身も演出も目的も変えない。変えるのは並べ方だけである。
 */
export const START_KIND = Object.freeze({
  /** レイアウトテンプレ (HomeScreen — ADR-089)。 */
  LAYOUT_TEMPLATE: 'layout-template',
  /** Context テンプレ (TemplateGallery — ADR-051 Phase 2)。 */
  CONTEXT_TEMPLATE: 'context-template',
  /** 6 ステップの物語 (ADR-047)。 */
  STORY: 'story',
  /** 5 クエストのツアー (ADR-065 Phase 6)。 */
  QUESTS: 'quests',
  /** 誘導インテーク (ADR-063 Phase 3)。 */
  GUIDED_INTAKE: 'guided-intake',
})

/**
 * **宣言表 2/2** — 種ごとの始め方。6 種目を足す人はここに行を足さねばならず、
 * そのとき D2 の上界に当たる (= 意図的な版上げ行為になる)。
 *
 * `START_KIND` の枝を足して行を足さなければ `src/HeaderEntranceCensus.test.js`
 * が落ちる (母集団は enum から導出する — 手書きのリストではない)。
 */
export const START_ENTRY_BY_KIND = Object.freeze({
  [START_KIND.LAYOUT_TEMPLATE]: Object.freeze({
    label: 'From a layout template', callback: 'onOpenHome', shortcut: null, requires: null,
    adr: 'ADR-089',
    why: '起動時のホーム画面と同じギャラリー。ADR-089 の**起動経路は畳まない** (D5) — '
       + 'ここに在るのは、スキップ設定を有効にした人のための**再入口**である。',
  }),
  [START_KIND.CONTEXT_TEMPLATE]: Object.freeze({
    label: 'From a context template (New Project)', callback: 'onOpenTemplateGallery', shortcut: null, requires: null,
    adr: 'ADR-051',
    why: '文書を採択して始める。発見カウンタの `unexamined` が名指しする出口と同じ先 (ADR-105)。',
  }),
  [START_KIND.STORY]: Object.freeze({
    label: 'Guided story (tutorial)', callback: 'onContextDemoClick', shortcut: null, requires: null,
    adr: 'ADR-047',
    why: '6 ステップの物語。`Context ▾` の奥に居たので「始める」として数えられていなかった '
       + '(03-implementation-order.md が「4 重導線」と書いた誤りの出所)。',
  }),
  [START_KIND.QUESTS]: Object.freeze({
    label: 'Quest tour (5 quests)', callback: 'onTourRestart', shortcut: null, requires: REQUIRES.FINE_POINTER,
    adr: 'ADR-065',
    why: '左下のカードは**初回だけ**種が撒かれ、✕ を押すと二度と戻らなかった = 入口が無かった。 '
       + '畳むにあたって再入口 (`onTourRestart`) を作った — 畳むことは消すことではない (原則 #16)。',
  }),
  [START_KIND.GUIDED_INTAKE]: Object.freeze({
    label: 'Guided intake (wizard)', callback: 'onWizardStart', shortcut: null, requires: REQUIRES.CONTEXT_DOC,
    adr: 'ADR-063',
    why: '文書の中を埋める順序つきの器なので、文書が要る。器は ADR-106 (Phase 3) で '
       + '`ContextLayer` のタブから `DocIntakeLayer` (**暫定住所**) へ移ったが、'
       + '**入口はここ 1 つのまま**である — 器が動いても入口は増えない、が両 ADR の接点。',
  }),
})

/**
 * 種 → 始め方。未宣言の種で throw する。
 *
 * @param {string} kind `START_KIND` の値
 * @returns {object} 始め方の宣言
 * @throws {Error} 未宣言の種
 */
export function startEntryFor(kind) {
  const entry = START_ENTRY_BY_KIND[kind]
  if (!entry) {
    throw new Error(
      `[HeaderEntrances] undeclared start kind "${kind}". ` +
      'Add a row to START_ENTRY_BY_KIND — an undeclared kind falling through would make "始める" ' +
      'silently do nothing for that kind (原則 #11 / #31).',
    )
  }
  return entry
}

// ── 場 (ADR-106 が器を動かすまでの現住所) ──────────────────────────────────

/**
 * `場を開く` の引数。ADR-106 (Phase 3) が器を右端 280px の縦ストリップから下部の
 * 展開パネルへ移した**後**の並び。この表が「Phase 3 で縮む」と予告していたとおり、
 * `grasp` は場を開かなくなった (住所は選んだロボットの隣 = N パネル — ADR-105 D5 /
 * ADR-106 D3) が、**入口としては残している**: 何も選んでいない状態から把持探索へ
 * 入る経路はここだけで、消せば原則 #16 が言う「移設ではなく無言の削除」になる。
 * したがって縮んだのは*行の数*ではなく**この行が意味すること**である — 分類の
 * 見直し (`open-floor` ではない動詞へ移すか) は入口の個数を動かす判断なので、
 * ADR-108 D2 の上界に当たる別の変更として起票する。
 */
export const FLOOR_TARGETS = Object.freeze([
  Object.freeze({ object: 'negotiate',     label: 'Negotiate',      callback: 'onContextNegotiate',   shortcut: null, requires: null,
    why: '衝突の解消 = 場そのもの (ADR-049 Phase 4)。' }),
  Object.freeze({ object: 'author',        label: 'Author regions', callback: 'onContextAuthor',      shortcut: null, requires: null,
    why: '許容領域を 3D で動かしながら交渉する (ADR-049 Phase 3)。' }),
  Object.freeze({ object: 'region-ghosts', label: 'Region ghosts',  callback: 'onContextRegionGhost', shortcut: null, requires: null,
    why: '未確定帯の表示 (ADR-050 §5.3)。ADR-107 で変数選択の 3D の姿にもなった。' }),
  Object.freeze({ object: 'grasp',         label: 'Grasp search…',  callback: 'onOpenGrasp',          shortcut: null, requires: null,
    why: '把持候補の探索 (ADR-057)。ADR-106 D3 の後、**パネルは場ではなく N パネルに開く** — '
       + 'ここはその入口であって器ではない。選択が無い状態からの唯一の経路。' }),
])

// ── 作業面のトグル (D4 — Node Editor の住所) ───────────────────────────────

/** ヘッダから出し入れできる**作業面**。対象を選ぶ流れではないので直積にならない。 */
export const SURFACE = Object.freeze({
  /** Geometry DAG の編集器 (ADR-032)。 */
  NODE_EDITOR: 'node-editor',
})

/**
 * 作業面ごとのトグル。**ファイル動詞ではない** — ここに居る根拠は
 * 「BFF 接続時のみ表示」という表示条件の一致ではなく、`切り替える` という
 * 動詞を持つことである (D4)。
 */
export const SURFACE_TOGGLES = Object.freeze({
  [SURFACE.NODE_EDITOR]: Object.freeze({
    label: 'Nodes', icon: 'nodes', callback: 'onNodeEditorToggle', activeFlag: 'nodeEditorOpen',
    requires: REQUIRES.BFF,
    title: 'Toggle the Node Editor (Geometry DAG) — a second editor, not a file action',
    why: '第二の編集器。`Save`/`Load` の隣に居たのは表示条件が同じだったからで、'
       + '動詞を共有していたからではない。**表示条件は住所の根拠ではない** (ADR-108 D4)。',
  }),
})

/**
 * 作業面 → トグルの宣言。未宣言の面で throw する。
 *
 * @param {string} surface `SURFACE` の値
 * @returns {object}
 * @throws {Error} 未宣言の作業面
 */
export function surfaceToggleFor(surface) {
  const toggle = SURFACE_TOGGLES[surface]
  if (!toggle) {
    throw new Error(
      `[HeaderEntrances] undeclared surface "${surface}". ` +
      'Add a row to SURFACE_TOGGLES — a toggle without a declaration is an entrance nobody counted.',
    )
  }
  return toggle
}

// ── 入口の登録簿 (D2 の母集団と突き合わせる宣言) ───────────────────────────

/** 入口が現れるレイアウト。 */
export const LAYOUT = Object.freeze({ DESKTOP: 'desktop', MOBILE: 'mobile' })

/**
 * **ヘッダの常設入口の登録簿。**
 *
 * キーは `Header.jsx` の JSX から**構文で導出**できる形にしてある —
 * `要素名` か `要素名:判別子` (判別子は `verb={HEADER_VERB.X}` /
 * `surface={SURFACE.X}` / `label="…"` の最初に見つかったもの)。手書きの入口
 * リストにしない (それは `place-list` で、ADR-102 が語彙から消した形) ため、
 * `src/HeaderEntranceCensus.test.js` は母集団を JSX 側から数え、この表と
 * **両方向に**突き合わせる。
 */
export const HEADER_ENTRANCES = Object.freeze({
  'ModeDropdown': Object.freeze({
    verb: HEADER_VERB.SWITCH_MODE, layouts: [LAYOUT.DESKTOP, LAYOUT.MOBILE],
    why: 'Object / Edit の切替。対象を持たない動詞なので引数も持たない。',
  }),
  'VerbMenu:START': Object.freeze({
    verb: HEADER_VERB.START, layouts: [LAYOUT.DESKTOP],
    why: '5 種を引数に落とした「始める」1 入口 (D1 / D3)。',
  }),
  'VerbMenu:EXPORT': Object.freeze({
    verb: HEADER_VERB.EXPORT, layouts: [LAYOUT.DESKTOP],
    why: '3 対象を引数に落とした「持ち出す」1 入口 (D1)。',
  }),
  'VerbMenu:IMPORT': Object.freeze({
    verb: HEADER_VERB.IMPORT, layouts: [LAYOUT.DESKTOP],
    why: '3 対象を引数に落とした「持ち込む」1 入口 (D1)。',
  }),
  'VerbMenu:OPEN_FLOOR': Object.freeze({
    verb: HEADER_VERB.OPEN_FLOOR, layouts: [LAYOUT.DESKTOP],
    why: '場への入口。ADR-106 が器を動かすまでの現住所を宣言しておく。',
  }),
  'SurfaceToggle:NODE_EDITOR': Object.freeze({
    verb: HEADER_VERB.TOGGLE_SURFACE, layouts: [LAYOUT.DESKTOP],
    why: 'D4 — Geometry DAG の**第二の編集器**。`Save`/`Load` の隣に居たのは表示条件が '
       + '一致していたからで、持ち出し / 持ち込みの動詞を持つからではない。',
  }),
  'DiscoveryCounters': Object.freeze({
    verb: HEADER_VERB.READ_DISCOVERY, layouts: [LAYOUT.DESKTOP, LAYOUT.MOBILE],
    why: '読みが主で、クリックはその読みが名指しする出口 (ADR-105 D1)。',
  }),
  'IconBtn:Toggle outliner': Object.freeze({
    verb: HEADER_VERB.TOGGLE_SURFACE, layouts: [LAYOUT.MOBILE],
    why: '作業面のスイッチ。畳めない理由は `MULTI_ENTRANCE_VERBS` に宣言してある。',
  }),
  'IconBtn:Toggle properties panel': Object.freeze({
    verb: HEADER_VERB.TOGGLE_SURFACE, layouts: [LAYOUT.MOBILE],
    why: '同上 (N パネル)。',
  }),
  'IconBtn:Undo': Object.freeze({
    verb: HEADER_VERB.UNDO, layouts: [LAYOUT.MOBILE],
    why: '一手戻す。Redo とは逆向きの別の動詞なので、畳むと向きが引数になってしまう。',
  }),
  'IconBtn:Redo': Object.freeze({
    verb: HEADER_VERB.REDO, layouts: [LAYOUT.MOBILE],
    why: '一手進める。',
  }),
  'MoreMenu': Object.freeze({
    verb: HEADER_VERB.OVERFLOW, layouts: [LAYOUT.MOBILE],
    why: '狭い画面では動詞そのものを畳む。中身は同じ宣言表から出るので、'
       + 'デスクトップとモバイルで入口の集合がズレない。',
  }),
})

/**
 * **同じ動詞に入口が複数在ってよい**と宣言したもの (D1 の例外)。
 *
 * 例外を許すと「じゃあ全部例外にすればいい」になるが、そこは D2 の上界が
 * 受け止める — 例外を宣言しても入口の総数は増やせない。
 */
export const MULTI_ENTRANCE_VERBS = Object.freeze({
  [HEADER_VERB.TOGGLE_SURFACE]:
    'トグルは**その面の状態の表示そのもの**であって、対象を選んでから実行する流れではない。 '
  + 'メニューへ畳むと (a) 1 タップで可逆だった操作が 2 手になり、(b) 開いているか閉じているかが '
  + '画面から消える (原則 #15 固定スロット / 原則 #4 表示状態の所有者)。'
  + 'したがって面ごとに 1 スイッチが正しく、直積ではない — 「対象」は選ばれない。',
})

// ── 動詞 → メニュー (引数の並びは上の正準表から**導出**する) ───────────────

/**
 * 動詞ごとの引金 (trigger) の見た目。**引数の並びはここに複製しない** —
 * `menuFor()` が正準表から導出する (§1.1 第二の源にしない)。
 */
const MENU_TRIGGER_BY_VERB = Object.freeze({
  [HEADER_VERB.START]:      Object.freeze({ label: 'Start',   icon: 'layouts', title: 'Start something — layout / context template, tutorial, tour, guided intake' }),
  [HEADER_VERB.EXPORT]:     Object.freeze({ label: 'Export',  icon: 'export',  title: 'Take it out — scene JSON, server, context document' }),
  [HEADER_VERB.IMPORT]:     Object.freeze({ label: 'Import',  icon: 'import',  title: 'Bring it in — scene JSON, server, context document' }),
  [HEADER_VERB.OPEN_FLOOR]: Object.freeze({ label: 'Context', icon: 'demo',    title: 'Context-first — requirements / conflicts / negotiation' }),
})

/** 動詞ごとの引数の**出所** (正準表を指すだけ — 中身を写さない)。 */
function itemsForVerb(verb) {
  if (verb === HEADER_VERB.START) {
    return Object.entries(START_ENTRY_BY_KIND).map(([kind, entry]) => ({ key: kind, ...entry }))
  }
  if (verb === HEADER_VERB.EXPORT || verb === HEADER_VERB.IMPORT) {
    return fileTargetsFor(verb).map(t => ({ key: t.object, ...t }))
  }
  if (verb === HEADER_VERB.OPEN_FLOOR) {
    return FLOOR_TARGETS.map(t => ({ key: t.object, ...t }))
  }
  return null
}

/**
 * 動詞 → その入口が開くメニュー。未宣言の動詞で throw する。
 *
 * @param {string} verb `HEADER_VERB` の値
 * @returns {{verb: string, label: string, icon: string, title: string, items: object[]}}
 * @throws {Error} メニューを持つ動詞として宣言されていないもの
 */
export function menuFor(verb) {
  const trigger = MENU_TRIGGER_BY_VERB[verb]
  const items   = itemsForVerb(verb)
  if (!trigger || !items) {
    throw new Error(
      `[HeaderEntrances] "${verb}" has no declared menu. ` +
      'A verb whose objects are arguments needs BOTH a trigger row and a canonical item table; ' +
      'a verb without objects (undo / toggle) must not be rendered as a VerbMenu.',
    )
  }
  return { verb, label: trigger.label, icon: trigger.icon, title: trigger.title, items }
}

/** モバイルの `⋯` が並べる動詞 (= デスクトップでヘッダに常設されている動詞と同じ集合)。 */
export const OVERFLOW_VERBS = Object.freeze([
  HEADER_VERB.START, HEADER_VERB.EXPORT, HEADER_VERB.IMPORT, HEADER_VERB.OPEN_FLOOR,
])

// ── 可用性 (判定と理由が同じ返り値から出る) ────────────────────────────────

/**
 * 引数が今使えるか。**判定と理由を同じ返り値**から出す (原則 #25 の名前付き述語 /
 * ADR-065 の disabled-as-quest と同じ形)。呼び手が理由を別経路で組み立てられない。
 *
 * @param {{requires: string|null}} target `FILE_TARGETS_BY_VERB` / `START_ENTRY_BY_KIND` の行
 * @param {{bffConnected: boolean, contextLoaded: boolean, finePointer: boolean}} facts
 * @returns {{enabled: boolean, reason: string|null}}
 */
export function availabilityOf(target, facts) {
  const req = target.requires
  if (!req) return { enabled: true, reason: null }
  const satisfied =
    req === REQUIRES.BFF          ? !!facts.bffConnected
  : req === REQUIRES.CONTEXT_DOC  ? !!facts.contextLoaded
  : req === REQUIRES.FINE_POINTER ? !!facts.finePointer
  : null
  if (satisfied === null) {
    // 未宣言の前提は「満たされている」にも「いない」にも倒さない — 既定値で
    // 埋めると「宣言された既定」と「誰も考えなかった前提」が区別不能になる (原則 #31)。
    throw new Error(
      `[HeaderEntrances] undeclared requirement "${req}" in availabilityOf. ` +
      'Add it to REQUIRES + REQUIREMENT_REASON + this dispatch, together.',
    )
  }
  return satisfied
    ? { enabled: true, reason: null }
    : { enabled: false, reason: requirementReason(req) }
}
