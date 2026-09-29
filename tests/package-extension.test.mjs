import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'extension-package-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const folder of ['scripts', 'icons', 'lib', 'screenshots', 'tests', '.git']) {
    mkdirSync(join(directory, folder));
  }
  copyFileSync(join(root, 'scripts/package-extension.py'), join(directory, 'scripts/package-extension.py'));
  const manifest = {
    version: '2.4.0',
    background: { service_worker: 'background.js' },
    side_panel: { default_path: 'sidepanel.html' },
    icons: { 16: 'icons/icon16.png' },
    action: { default_icon: { 16: 'icons/icon16.png' } },
    content_scripts: [{ js: ['content.js'], css: ['content.css'] }],
  };
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest));
  for (const file of [
    'LICENSE', 'background.js', 'content.css', 'content.js', 'page-content.js', 'guide.html',
    'sidepanel.html', 'sidepanel.js', 'settings.js', 'lib/providers.js',
    'icons/icon16.png', '.env', '.git/config', 'screenshots/private.png',
    'tests/example.test.mjs', 'lib/credentials.json', 'README.md',
  ]) {
    writeFileSync(join(directory, file), file);
  }
  return { directory, manifest };
}

function packageFixture(directory, ...args) {
  return spawnSync('python3', [join(directory, 'scripts/package-extension.py'), ...args], { encoding: 'utf8' });
}

test('ZIP contains only runtime files at its root, with a valid checksum and reproducible bytes', (t) => {
  const { directory } = fixture(t);
  const result = packageFixture(directory, '--tag', 'v2.4.0');
  assert.equal(result.status, 0, result.stderr);
  const archive = join(directory, 'dist/ai-translate-extension-v2.4.0.zip');
  const contents = JSON.parse(execFileSync('python3', ['-c',
    'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps(z.namelist()))',
    archive,
  ], { encoding: 'utf8' }));
  assert.deepEqual(contents, [
    'LICENSE', 'background.js', 'content.css', 'content.js', 'guide.html',
    'icons/icon16.png', 'lib/providers.js', 'manifest.json', 'page-content.js', 'settings.js',
    'sidepanel.html', 'sidepanel.js',
  ]);
  const first = readFileSync(archive);
  const digest = createHash('sha256').update(first).digest('hex');
  assert.equal(readFileSync(`${archive}.sha256`, 'utf8'), `${digest}  ai-translate-extension-v2.4.0.zip\n`);
  assert.equal(packageFixture(directory).status, 0);
  assert.deepEqual(readFileSync(archive), first);
});

test('release tag must match manifest version', (t) => {
  const { directory } = fixture(t);
  const result = packageFixture(directory, '--tag', 'v2.3.0');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match manifest version v2\.4\.0/);
});

test('manifest references missing runtime files fail packaging', (t) => {
  const { directory, manifest } = fixture(t);
  manifest.icons[128] = 'icons/missing.png';
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest));
  const result = packageFixture(directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Manifest references unpackaged files: icons\/missing\.png/);
});
