import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const required = ['LICENSE', 'companion/README.md', 'companion/model_cache.py',
  'companion/requirements.in', 'companion/requirements.txt', 'companion/server.py',
  'companion/speech_engine.py', 'companion/start-vieneu.command'];

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'companion-package-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'scripts'));
  copyFileSync(join(root, 'scripts/package-companion.py'), join(directory, 'scripts/package-companion.py'));
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ version: '2.5.0' }));
  for (const name of [...required, 'companion/.env', 'companion/.cache/model.onnx',
    'companion/.venv/bin/python', 'companion/outputs/private.wav', 'companion/test_server.py',
    'companion/credentials.py', '.git/config']) {
    mkdirSync(dirname(join(directory, name)), { recursive: true });
    writeFileSync(join(directory, name), name);
  }
  return directory;
}

function pack(directory, ...args) {
  return spawnSync('python3', [join(directory, 'scripts/package-companion.py'), ...args], { encoding: 'utf8' });
}

test('companion ZIP excludes model/private state, preserves launcher mode and reproduces checksum', (t) => {
  const directory = fixture(t);
  const result = pack(directory, '--tag', 'v2.5.0');
  assert.equal(result.status, 0, result.stderr);
  const archive = join(directory, 'dist/vieneu-local-v2.5.0.zip');
  const entries = JSON.parse(execFileSync('python3', ['-c',
    'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({i.filename:i.external_attr>>16 for i in z.infolist()}))',
    archive], { encoding: 'utf8' }));
  assert.deepEqual(Object.keys(entries), required.toSorted());
  assert.equal(entries['companion/start-vieneu.command'], 0o100755);
  assert.equal(entries['companion/server.py'], 0o100644);
  const bytes = readFileSync(archive);
  assert.equal(readFileSync(`${archive}.sha256`, 'utf8'),
    `${createHash('sha256').update(bytes).digest('hex')}  vieneu-local-v2.5.0.zip\n`);
  assert.equal(pack(directory).status, 0);
  assert.deepEqual(readFileSync(archive), bytes);
});

test('companion package rejects tag mismatch and unsafe version', (t) => {
  const directory = fixture(t);
  const result = pack(directory, '--tag', 'v2.4.0');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match manifest version v2\.5\.0/);
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ version: '../escape' }));
  assert.match(pack(directory).stderr, /Invalid Chrome extension version/);
});

test('companion package rejects missing runtime and symlinks', (t) => {
  const directory = fixture(t);
  const server = join(directory, 'companion/server.py');
  rmSync(server);
  assert.match(pack(directory).stderr, /Expected a regular companion file: companion\/server.py/);
  symlinkSync(join(directory, 'companion/credentials.py'), server);
  assert.match(pack(directory).stderr, /Expected a regular companion file: companion\/server.py/);
});
