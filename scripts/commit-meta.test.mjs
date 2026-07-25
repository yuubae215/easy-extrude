// commit-meta の純粋関数のテスト。
//
// CLAUDE.md 「After fixing a bug」Q3 の答えがここ: 「タスク種別とは何か」は
// 散文で約束するのではなく、規則を実行可能にして CI で問う。分類規則が
// 静かに変わると 7 月分の遡及分類と新規分類がズレる — それを検知する層。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import {
  parseConventionalType,
  layersForPaths,
  deriveTaskClass,
  readSessionModelEffort,
  buildTrailers,
  stripHeredocs,
  tokenizeCommand,
  detectsCommitPushChain,
} from './commit-meta.mjs';

test('conventional type — scope 付き・破壊的変更・型なしを見分ける', () => {
  assert.equal(parseConventionalType('feat(robot): 同一性を実体へ'), 'feat');
  assert.equal(parseConventionalType('fix: hidden row now says so'), 'fix');
  assert.equal(parseConventionalType('chore(governance)!: 原則を降ろす'), 'chore');
  assert.equal(parseConventionalType('Merge pull request #351 from x'), 'other');
  assert.equal(parseConventionalType(''), 'other');
  assert.equal(parseConventionalType(undefined), 'other');
});

test('レイヤ写像は CLAUDE.md のスコープ境界表に一致する', () => {
  assert.deepEqual(layersForPaths(['src/domain/Solid.js']), ['front']);
  assert.deepEqual(layersForPaths(['core/recommendation/lane.py']), ['core']);
  assert.deepEqual(layersForPaths(['server/src/openapi.js']), ['bff']);
  assert.deepEqual(
    layersForPaths(['packages/grasp-contract/grasp-response.schema.json']),
    ['contract'],
  );
  assert.deepEqual(layersForPaths(['docs/adr/ADR-092-x.md']), ['docs']);
  assert.deepEqual(layersForPaths(['.claude/hooks/commit-trailers.sh']), ['governance']);
  assert.deepEqual(layersForPaths(['scripts/commit-meta.mjs']), ['build']);
  assert.deepEqual(layersForPaths(['package.json']), ['build']);
});

test('ルート直下は「その他」ではない — 統治 / 文書 / ビルドに正しく落ちる', () => {
  // CLAUDE.md はルート変更の大半を占める統治文書。root に落とすと最大バケツが
  // 無意味になり、分類が読めなくなる (実データで発見した欠陥の回帰テスト)。
  assert.deepEqual(layersForPaths(['CLAUDE.md']), ['governance']);
  assert.deepEqual(layersForPaths(['README.md']), ['docs']);
  assert.deepEqual(layersForPaths(['LICENSE']), ['docs']);
  assert.deepEqual(layersForPaths(['pnpm-lock.yaml']), ['build']);
  assert.deepEqual(layersForPaths(['vite.config.js']), ['build']);
  assert.deepEqual(layersForPaths(['.gitignore']), ['build']);
  assert.deepEqual(layersForPaths(['public/robot/skeleton_arm.urdf']), ['front']);
  assert.deepEqual(layersForPaths(['e2e/smoke.spec.js']), ['front']);
  assert.deepEqual(layersForPaths(['.vscode/settings.json']), ['build']);
  assert.deepEqual(layersForPaths(['vendor/grasp-contract']), ['contract']);
  // 未知の拡張子のルートファイルだけが root に残る (推測せず宣言する枠)。
  assert.deepEqual(layersForPaths(['Makefile']), ['root']);
});

test('追跡中の全ファイルが宣言済みレイヤに落ちる (未分類 = 0 を検査)', () => {
  // 分類の網羅性は「在るものを辿る」検査では見えない — 落ちこぼれたパスは
  // どのバケツにも現れず、ただ root を膨らませるだけで気付けない (原則 #31)。
  // *必要な種別を列挙して個数を検査*する形にする: 未分類の個数はゼロであること。
  //
  // git log ではなく working tree を見るのは、CI が shallow clone (fetch-depth 1)
  // でも成立させるため。新しいトップレベルディレクトリが増えたらここで落ちる。
  const paths = execFileSync('git', ['ls-files'], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  }).split('\n').map((s) => s.trim()).filter(Boolean);

  assert.ok(paths.length > 0, 'git ls-files が空 — 検査が空振りしている');
  const unmapped = [...new Set(paths.filter((p) => layersForPaths([p])[0] === 'root'))];
  assert.deepEqual(
    unmapped, [],
    `未分類のパスがある。LAYER_RULES に行を足すこと:\n  ${unmapped.join('\n  ')}`,
  );
});

test('contract は packages/ の一般規則より先に判定される (具体 → 一般)', () => {
  // 順序が壊れると contract レイヤが root に落ち、契約変更が分析から消える。
  assert.deepEqual(layersForPaths(['packages/grasp-contract/contract-version.json']), ['contract']);
});

test('複数レイヤは重複排除してソート結合される (順序は入力に依存しない)', () => {
  const a = deriveTaskClass({
    subject: 'feat(grasp): score 層',
    paths: ['src/a.js', 'core/b.py', 'src/c.js'],
  });
  const b = deriveTaskClass({
    subject: 'feat(grasp): score 層',
    paths: ['core/b.py', 'src/c.js', 'src/a.js'],
  });
  assert.equal(a, 'feat/core+front');
  assert.equal(a, b, '同じ変更集合は入力順に依らず同じ分類になること');
});

test('空の変更集合は none を宣言する (推測で埋めない)', () => {
  assert.equal(deriveTaskClass({ subject: 'chore: empty', paths: [] }), 'chore/none');
});

test('transcript から最後の assistant 応答の model と effort を読む', () => {
  const jsonl = [
    JSON.stringify({ type: 'user', message: { role: 'user' } }),
    JSON.stringify({ type: 'assistant', effort: 'low', message: { model: 'claude-sonnet-5' } }),
    JSON.stringify({ type: 'assistant', effort: 'high', message: { model: 'claude-opus-5' } }),
    JSON.stringify({ type: 'queue-operation' }),
  ].join('\n');
  assert.deepEqual(readSessionModelEffort(jsonl), { model: 'claude-opus-5', effort: 'high' });
});

test('transcript が壊れた行を含んでも読める行だけを使う (fail-open)', () => {
  const jsonl = [
    '{ not json',
    '',
    JSON.stringify({ type: 'assistant', effort: 'high', message: { model: 'claude-opus-5' } }),
  ].join('\n');
  assert.deepEqual(readSessionModelEffort(jsonl), { model: 'claude-opus-5', effort: 'high' });
});

test('effort が無い版の transcript でも model は拾い、effort は unknown と宣言する', () => {
  const jsonl = JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-4-8' } });
  assert.deepEqual(readSessionModelEffort(jsonl), { model: 'claude-opus-4-8', effort: 'unknown' });
});

test('assistant 応答が無ければ null (捏造しない)', () => {
  assert.equal(readSessionModelEffort(JSON.stringify({ type: 'user' })), null);
  assert.equal(readSessionModelEffort(''), null);
});

test('session 不明でも unknown/unknown を宣言する — 人間のコミットと区別可能に保つ', () => {
  // 原則 #31: 不在は検査対象のノードを持たない。トレーラを省くと
  // 「人間が書いた」と見分けがつかず、母集団の分母が静かに狂う。
  assert.deepEqual(buildTrailers({ session: null, taskClass: 'fix/front' }), [
    'Model-Effort: unknown/unknown',
    'Task-Class: fix/front',
  ]);
});

test('commit && push の連鎖を検出する (刻む隙間が無い形)', () => {
  assert.equal(detectsCommitPushChain('git commit -m x && git push'), true);
  assert.equal(detectsCommitPushChain('git add -A; git commit -m x; git push -u origin main'), true);
  assert.equal(detectsCommitPushChain('git commit -m x || git push'), true);
});

test('連鎖でないものを連鎖と言わない', () => {
  assert.equal(detectsCommitPushChain('git commit -m x'), false);
  assert.equal(detectsCommitPushChain('git push -u origin main'), false);
  // push が先・commit が後は「刻む隙間が無い」形ではない。
  assert.equal(detectsCommitPushChain('git push && git commit -m x'), false);
  assert.equal(detectsCommitPushChain('git log --oneline -15'), false);
});

test('引用の中の語をコマンドとして読まない', () => {
  // メッセージが push に**言及**しているだけで発火してはいけない。
  assert.equal(
    detectsCommitPushChain('git commit -m "explain why git commit && git push is bad"'),
    false,
  );
  assert.equal(detectsCommitPushChain("git commit -m 'do not git push here'"), false);
});

test('heredoc 本体の文面で発火しない (ADR-092 導入コミット自身が踏んだ誤発動)', () => {
  // 実際に起きた形: -F - + heredoc のコミットメッセージが
  // 「`git commit && git push` の連鎖」と説明していたため助言が誤発火した。
  const cmd = [
    "git commit -q -F - <<'MSG'",
    'chore(governance): 観測をコミットへ刻む',
    '',
    '塞げない穴: `git commit && git push` の連鎖は刻む隙間が無い。',
    'MSG',
    "echo '--- committed ---'",
  ].join('\n');
  assert.equal(detectsCommitPushChain(cmd), false);
});

test('heredoc の外にある本物の連鎖は heredoc があっても検出する', () => {
  const cmd = ["git commit -F - <<'MSG'", 'subject line', 'MSG', 'git push -u origin main'].join('\n');
  assert.equal(detectsCommitPushChain(cmd), true);
});

test('改行はコマンド区切り — 別行の push も同一呼び出しなら連鎖', () => {
  // 1 回の Bash 呼び出しに収まっている限り、`&&` でも改行でも刻む隙間は無い。
  assert.equal(detectsCommitPushChain('git commit -m x\ngit push'), true);
  // 行継続は区切りではない。
  assert.equal(detectsCommitPushChain('git commit \\\n  -m x'), false);
});

test('stripHeredocs / tokenizeCommand の単体挙動', () => {
  assert.equal(stripHeredocs("a <<'E'\nbody\nE\nb").split('\n').includes('body'), false);
  assert.deepEqual(tokenizeCommand('git commit -m "a b" && git push'), [
    'git', 'commit', '-m', 'a b', '&&', 'git', 'push',
  ]);
  // 空の引用は 1 トークンとして残る (欠落させない)。
  assert.deepEqual(tokenizeCommand('git commit -m ""'), ['git', 'commit', '-m', '']);
});

test('トレーラ行は git interpret-trailers が読める key: value 形式', () => {
  const [me, tc] = buildTrailers({
    session: { model: 'claude-opus-5', effort: 'high' },
    taskClass: 'feat/core+front',
  });
  assert.equal(me, 'Model-Effort: claude-opus-5/high');
  assert.equal(tc, 'Task-Class: feat/core+front');
  for (const line of [me, tc]) assert.match(line, /^[A-Za-z-]+: \S.*$/);
});
