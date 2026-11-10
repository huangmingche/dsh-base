import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const app = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const vite = createRequire(app.resolve('vite'));
const tinyglobby = createRequire(vite.resolve('tinyglobby'));
const fdir = createRequire(tinyglobby.resolve('fdir'));
const reactPlugin = createRequire(app.resolve('@vitejs/plugin-react'));
const babelPlugin = createRequire(reactPlugin.resolve('@rolldown/plugin-babel'));
const cf = createRequire(app.resolve('cf/package.json'));
const match = app('picomatch/posix');

test('the application and build tools resolve the reviewed matcher through the original package name', async () => {
  for (const consumer of [app, vite, tinyglobby, fdir, babelPlugin, cf]) {
    assert.equal(consumer('picomatch/package.json').name, '@ryotsu/picomatch');
    assert.equal(consumer.resolve('picomatch'), app.resolve('picomatch'));
  }
  for (const entry of ['picomatch', 'picomatch/posix']) {
    const esm = await import(pathToFileURL(app.resolve(entry)).href);
    assert.equal(esm.default, app(entry));
  }
});

test('cf migrate uses the reviewed matcher to discover local env files and ignore dependencies', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cf-migrate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = app('cf/package.json');
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'node_modules'));
  await Promise.all([
    writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', devDependencies: { cf: manifest.version } })),
    writeFile(join(root, 'wrangler.jsonc'), JSON.stringify({ name: 'fixture', main: 'src/index.js', compatibility_date: '2025-06-01' })),
    writeFile(join(root, 'src/index.js'), 'export default {};'),
    writeFile(join(root, 'src/.env.preview'), ''),
    writeFile(join(root, 'node_modules/.env.ignored'), ''),
  ]);

  const coverage = join(root, 'coverage');
  const cli = join(dirname(app.resolve('cf/package.json')), manifest.bin.cf);
  const result = spawnSync(process.execPath, [cli, 'migrate', 'wrangler.jsonc', '--dry-run', '--no-install', '--bundler', 'wrangler'], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: root, CI: '1', CF_SEND_METRICS: 'false', WRANGLER_SEND_METRICS: 'false', NODE_V8_COVERAGE: coverage },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /src[/\\]\.env\.preview/);
  assert.doesNotMatch(result.stderr, /\.env\.ignored/);

  // Resolving the dependency alone does not catch a CLI that still calls a bundled copy.
  const matcher = pathToFileURL(cf.resolve('picomatch')).href;
  const reports = await Promise.all((await readdir(coverage)).map(async name =>
    JSON.parse(await readFile(join(coverage, name), 'utf8')).result));
  assert.ok(reports.flat().some(script => script.url === matcher &&
    script.functions.some(fn => fn.functionName === 'picomatch' && fn.ranges[0].count > 0)));
});

test('resource globs support case-insensitive basenames, hidden files and full resource addresses', () => {
  const document = match('*.{md,mdx}', { nocase: true, dot: true, basename: true });
  assert.ok(document('/guides/.INTRO.MDX'));
  assert.equal(document('/guides/intro.pdf'), false);
  const file = match('file://**/*.md', { nocase: true, dot: true });
  assert.ok(file('file:///docs/.README.MD'));
  assert.equal(file('https://example.test/docs/README.md'), false);
});

test('the compatibility patch preserves 4.0.7 character classes and globstars', () => {
  assert.ok(match('[!ab]')('a'));
  assert.equal(match('[!ab]')('c'), false);
  assert.ok(match('[!ab]', { posix: true })('c'));
  assert.equal(match('[[:punct:]]')('\\'), false);
  assert.ok(match('[[:punct:]]')(';'));
  assert.equal(match('**/main.mjs')('lib\nitem/main.mjs'), false);
  assert.ok(match('**.js')('dir/util.js'));
});

test('scan and makeRe preserve ordinary extended globs and simplify repeated wildcard segments', () => {
  const parts = match.scan('src/**/@(lib|ui)/*.{ts,js}');
  assert.equal(parts.base, 'src');
  assert.equal(parts.isGlob, true);
  for (const options of [{}, { maxExtglobRecursion: false }]) {
    const repeated = match.makeRe('+(part-*.md)', options);
    assert.ok(repeated.test('part-api.mdpart-ui.md'));
    assert.equal(repeated.test('part-ui.ts'), false);
    // The wildcard already covers repetition, independent of the separate recursion limit.
    assert.doesNotMatch(repeated.source, /\)\+/);
  }
  assert.ok(match('+(ui|lib)')('uilibui'));
});

test('the Vite dev server retains default secret-file exclusions inside its allowed root', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-vite-deny-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { resolveConfig, isFileLoadingAllowed, normalizePath } = app('vite');
  const config = await resolveConfig({ root, configFile: false, logLevel: 'silent' }, 'serve');
  const allowed = file => isFileLoadingAllowed(config, normalizePath(join(root, file)));
  for (const file of ['.env', 'app/.env.local', 'certs/test.pem', '.git/config']) {
    assert.equal(allowed(file), false, file);
  }
  assert.ok(allowed('src/index.js'));
});

test('Vite filters and real tinyglobby/fdir crawls retain inclusion and exclusion behavior', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-match-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = ['docs/intro.md', 'docs/drafts/notes.md', 'docs/cover.png'];
  await mkdir(join(root, 'docs/drafts'), { recursive: true });
  await Promise.all(files.map(path => writeFile(join(root, path), '')));

  const { createFilter } = app('vite');
  const include = createFilter('**/*.md', '**/drafts/**', { resolve: false });
  assert.deepEqual(files.filter(include), ['docs/intro.md']);
  const { glob } = vite('tinyglobby');
  assert.deepEqual(await glob('**/*.md', { cwd: root, ignore: ['**/drafts/**'] }), ['docs/intro.md']);
  const { fdir: Directory } = tinyglobby('fdir');
  const paths = new Directory().withRelativePaths().withPathSeparator('/').glob('**/*.{md,png}').crawl(root).sync();
  assert.deepEqual(paths.sort(), [...files].sort());
});
