#!/usr/bin/env node
// commit-meta.mjs — コミットの観測メタデータ (Model-Effort / Task-Class) の
// **導出規則の正本**。
//
// なぜ shell hook ではなくここに導出を置くか (§1.1 真実の源は一つ):
//   書き込み側 (.claude/hooks/commit-trailers.sh) と読み出し側 (report) が
//   別々に「タスク種別とは何か」を実装すると、同じ事実の第二の源になり、
//   既存履歴の遡及分類と新規コミットの分類が静かにズレる。両者はこの
//   モジュールを呼ぶだけにして、規則は一箇所に置く。
//
// 純粋 / 副作用の分離 (原則 #3):
//   - 上段の export は**純粋関数** — 文字列を受け取り文字列を返す。テスト対象。
//   - 下段の CLI だけが git / fs を触る。
//
// CLI:
//   node scripts/commit-meta.mjs derive --transcript <path> [--rev HEAD]
//       → トレーラ行を stdout に出す (hook が使う)
//   node scripts/commit-meta.mjs report [--since <date>] [--until <date>]
//       → モデル × effort × タスク種別の集計 (Task-Class は未記録分を遡及導出)

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// 純粋計算
// ---------------------------------------------------------------------------

/** Conventional Commit の型。判定不能は 'other' (推測しない)。 */
export function parseConventionalType(subject) {
  const m = /^([a-z]+)(\([^)]*\))?!?:/.exec(String(subject ?? '').trim());
  const known = new Set([
    'feat', 'fix', 'docs', 'chore', 'refactor', 'perf',
    'test', 'style', 'build', 'ci', 'revert',
  ]);
  return m && known.has(m[1]) ? m[1] : 'other';
}

// レイヤ写像は CLAUDE.md の「スコープ境界」表がすでに宣言している境界をそのまま使う。
// ここで新しい境界を発明しない — 発明すると分析結果が repo の統治語彙と食い違う。
// 判定は上から順、最初に一致したもの (具体 → 一般)。
// ルート直下のファイルを一律 'root' にすると分類が壊れる: `CLAUDE.md` は 7 月の
// ルート変更 34/74 を占めるが、これは「その他」ではなく統治文書そのもので、
// `.claude/` と同じレイヤに属する。ビルド設定とロックファイルも同様に build。
// (最初の実装はこれを root に落として最大バケツを無意味にした — 実データで発見。)
const LAYER_RULES = [
  [/^packages\/grasp-contract\//, 'contract'],
  [/^core\//, 'core'],
  [/^templates\//, 'core'],
  [/^server\//, 'bff'],
  [/^(src|schema|examples|cli|public|e2e)\//, 'front'],
  [/^vendor\/grasp-contract/, 'contract'],
  [/^docs\//, 'docs'],
  [/^(\.claude\/|CLAUDE\.md$)/, 'governance'],
  [/^(scripts|\.github|\.vscode|wasm-engine|robotics-wasm)\//, 'build'],
  [/^[^/]+\.(md|txt)$|^LICENSE$/, 'docs'],
  [/^[^/]+\.(json|yaml|yml|js|html|toml)$|^\.[^/]+$/, 'build'],
];

/** 変更パス集合 → 触れたレイヤ (ソート済み・重複排除)。 */
export function layersForPaths(paths) {
  const hit = new Set();
  for (const raw of paths ?? []) {
    const p = String(raw).trim();
    if (!p) continue;
    const rule = LAYER_RULES.find(([re]) => re.test(p));
    hit.add(rule ? rule[1] : 'root');
  }
  return [...hit].sort();
}

/**
 * タスク種別 = `<conventional type>/<触れたレイヤ>`。
 *
 * 意図的に**コミットから決定的に導出**する — モデルの自己申告にしない。
 * 理由は二つ: (1) 自己申告はプロンプト負荷を増やし、この作業の目的である
 * 希釈低減と逆行する。(2) 決定的なら**既存履歴にも遡及適用**できる
 * (7 月分の母集団が今日から読める)。
 */
export function deriveTaskClass({ subject, paths }) {
  const layers = layersForPaths(paths);
  return `${parseConventionalType(subject)}/${layers.length ? layers.join('+') : 'none'}`;
}

/**
 * セッション transcript (JSONL 文字列) → 最後の assistant 応答の {model, effort}。
 *
 * これが model の**根拠ある源**。コミットの `Co-Authored-By:` はモデルが散文で
 * 書く申告なので、忘れ・取り違えがありうる (report がこの二つを突き合わせる)。
 */
export function readSessionModelEffort(transcriptText) {
  let found = null;
  for (const line of String(transcriptText ?? '').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let d;
    try { d = JSON.parse(s); } catch { continue; }
    if (d?.type !== 'assistant') continue;
    const model = d?.message?.model;
    if (!model) continue;
    found = { model, effort: d.effort ?? 'unknown' };
  }
  return found;
}

/**
 * トレーラ行を組み立てる。
 *
 * model が読めなくても `unknown/unknown` を**宣言**する — hook が走った時点で
 * 「Claude が作ったコミット」であることは確定しており、トレーラを省くと
 * 人間のコミットと区別がつかなくなる。不在を推論させず宣言させる (原則 #31)。
 */
export function buildTrailers({ session, taskClass }) {
  const model = session?.model ?? 'unknown';
  const effort = session?.effort ?? 'unknown';
  return [`Model-Effort: ${model}/${effort}`, `Task-Class: ${taskClass}`];
}

// ---------------------------------------------------------------------------
// 副作用 (CLI)
// ---------------------------------------------------------------------------

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function cmdDerive(argv) {
  const transcript = argFor(argv, '--transcript');
  const rev = argFor(argv, '--rev') ?? 'HEAD';
  const cwd = argFor(argv, '--repo') ?? process.cwd();

  const subject = git(['show', '-s', '--format=%s', rev], cwd).trim();
  const paths = git(['show', '--name-only', '--format=', rev], cwd)
    .split('\n').map((s) => s.trim()).filter(Boolean);

  let session = null;
  if (transcript) {
    try { session = readSessionModelEffort(readFileSync(transcript, 'utf8')); } catch { /* fail-open */ }
  }

  process.stdout.write(
    buildTrailers({ session, taskClass: deriveTaskClass({ subject, paths }) }).join('\n') + '\n',
  );
}

const RS = '\x1e';
const US = '\x1f';

function cmdReport(argv) {
  const range = [];
  const since = argFor(argv, '--since');
  const until = argFor(argv, '--until');
  if (since) range.push(`--since=${since}`);
  if (until) range.push(`--until=${until}`);

  // `separator=%x2c` は必須。既定の trailers 展開は値ごとに改行を足すので、
  // Co-Authored-By を持つコミットではトレーラ本文が meta 行からはみ出し、
  // 続く行が **ファイルパスとして** 読まれる (実測でレイヤ 'root' を偽造していた)。
  const tr = (key) => `%(trailers:key=${key},valueonly,separator=%x2c)`;
  const raw = git([
    'log', '--no-merges', ...range,
    `--format=${RS}%H${US}%s${US}${tr('Model-Effort')}${US}` +
      `${tr('Task-Class')}${US}${tr('Co-Authored-By')}${US}`,
    '--name-only',
  ], process.cwd());

  const rows = [];
  for (const chunk of raw.split(RS)) {
    if (!chunk.trim()) continue;
    const [meta, tail] = splitOnce(chunk, '\n');
    const [sha, subject, modelEffort, taskClass, coAuthor] = meta.split(US);
    const paths = (tail ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
    rows.push({
      sha: sha.slice(0, 8),
      subject,
      // 記録済みなら記録を、無ければ**遡及導出**。effort は遡及できない (記録が源)。
      taskClass: taskClass?.trim() || deriveTaskClass({ subject, paths }),
      recorded: Boolean(modelEffort?.trim()),
      model: modelEffort?.trim() ? modelEffort.trim().split('/')[0] : null,
      effort: modelEffort?.trim() ? modelEffort.trim().split('/').slice(1).join('/') : null,
      coAuthor: (coAuthor ?? '').split(',')[0].replace(/\s*<.*/, '').trim() || null,
    });
  }

  const total = rows.length;
  const recorded = rows.filter((r) => r.recorded);
  console.log(`commits (no-merges): ${total}   with Model-Effort: ${recorded.length}`);

  console.log('\n— effort (記録があるコミットのみ) —');
  tally(recorded.map((r) => `${r.model} / ${r.effort}`));

  console.log('\n— task class (全件・未記録は遡及導出) —');
  tally(rows.map((r) => r.taskClass));

  console.log('\n— model (Co-Authored-By 申告・全件) —');
  tally(rows.map((r) => r.coAuthor ?? '(none)'));

  // 申告と根拠の食い違いは、母集団の信頼性そのものに関わるので黙らせない。
  const drift = recorded.filter(
    (r) => r.coAuthor && r.model && !normalize(r.coAuthor).includes(normalize(r.model).replace(/^claude/, '')),
  );
  if (drift.length) {
    console.log(`\n⚠ Co-Authored-By と transcript の model が食い違うコミット: ${drift.length}`);
    for (const r of drift.slice(0, 10)) console.log(`   ${r.sha}  ${r.coAuthor} vs ${r.model}`);
  }
}

const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function tally(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const width = Math.max(0, ...[...counts.keys()].map((k) => k.length));
  for (const [k, v] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`  ${k.padEnd(width)}  ${String(v).padStart(4)}`);
  }
}

function splitOnce(s, sep) {
  const i = s.indexOf(sep);
  return i === -1 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)];
}

function argFor(argv, name) {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const [, , sub, ...rest] = process.argv;
  if (sub === 'derive') cmdDerive(rest);
  else if (sub === 'report') cmdReport(rest);
  else {
    console.error('usage: commit-meta.mjs derive --transcript <path> [--rev HEAD] [--repo <dir>]');
    console.error('       commit-meta.mjs report [--since <date>] [--until <date>]');
    process.exit(2);
  }
}
