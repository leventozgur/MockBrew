// Run from the repository root after building dist. This is a feasibility spike,
// not a release builder; see docs/research/SEA.md.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(process.execPath, ['scripts/sea/bundle.mjs']);
const config = JSON.parse(await readFile('scripts/sea/sea-config.json', 'utf8'));
async function addUi(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await addUi(file);
    else if (entry.isFile()) config.assets[`ui/${path.relative('dist/ui', file).split(path.sep).join('/')}`] = file;
  }
}
await addUi('dist/ui');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
await writeFile('scripts/sea/out/version', version);
const manifest = {};
for (const [name, file] of Object.entries(config.assets)) manifest[name] = createHash('sha256').update(await readFile(file)).digest('hex');
await writeFile('scripts/sea/out/manifest.json', JSON.stringify(manifest));
config.assets.version = 'scripts/sea/out/version';
config.assets.manifest = 'scripts/sea/out/manifest.json';
await writeFile('scripts/sea/out/sea-config.generated.json', JSON.stringify(config, null, 2));
run(process.execPath, ['--experimental-sea-config', 'scripts/sea/out/sea-config.generated.json']);
await rm('scripts/sea/out/mockbrew', { force: true });
await copyFile(process.execPath, 'scripts/sea/out/mockbrew');
await chmod('scripts/sea/out/mockbrew', 0o755);
run('codesign', ['--remove-signature', 'scripts/sea/out/mockbrew']);
run('npx', ['-y', 'postject@1.0.0-alpha.6', 'scripts/sea/out/mockbrew', 'NODE_SEA_BLOB', 'scripts/sea/out/sea-prep.blob', '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', '--macho-segment-name', 'NODE_SEA']);
run('codesign', ['--sign', '-', 'scripts/sea/out/mockbrew']);
