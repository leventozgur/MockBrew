import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' && command === 'npx' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal}).`);
}
if (process.argv.slice(2).some((arg) => arg !== '--allow-any-node')) throw new Error('Usage: node scripts/sea/build.mjs [--allow-any-node]');
if (Number(process.versions.node.split('.')[0]) !== 22 && !process.argv.includes('--allow-any-node')) throw new Error(`Release builds require Node 22.x (found ${process.versions.node}); use --allow-any-node only for local experiments.`);
if (!['darwin', 'linux', 'win32'].includes(process.platform)) throw new Error(`Unsupported platform: ${process.platform}`);
if (process.platform === 'darwin') {
  const result = spawnSync('lipo', ['-archs', process.execPath], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Could not inspect the Node binary with lipo.');
  if (result.stdout.trim().split(/\s+/).length !== 1) throw new Error('Universal macOS Node binaries are unsupported: postject finds multiple sentinel occurrences. Use a single-architecture Node binary.');
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
await mkdir('dist-bin', { recursive: true });
const output = `dist-bin/mockbrew-${process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'}-${process.arch}${process.platform === 'win32' ? '.exe' : ''}`;
await rm(output, { force: true });
await copyFile(process.execPath, output);
if (process.platform !== 'win32') await chmod(output, 0o755);
if (process.platform === 'darwin') run('codesign', ['--remove-signature', output]);
const args = ['-y', 'postject@1.0.0-alpha.6', output, 'NODE_SEA_BLOB', 'scripts/sea/out/sea-prep.blob', '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'];
if (process.platform === 'darwin') args.push('--macho-segment-name', 'NODE_SEA');
run('npx', args);
if (process.platform === 'darwin') run('codesign', ['--sign', '-', output]);
const hash = createHash('sha256').update(await readFile(output)).digest('hex');
await writeFile(`${output}.sha256`, `${hash}  ${path.basename(output)}\n`);
console.log(`Built ${output}`);
