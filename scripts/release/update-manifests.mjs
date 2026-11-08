import { readFile, writeFile } from 'node:fs/promises';

const [version, sumsFile] = process.argv.slice(2);
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) || !sumsFile || process.argv.length !== 4) throw new Error('Usage: node scripts/release/update-manifests.mjs <version> <SHA256SUMS>');
const sums = new Map();
for (const line of (await readFile(sumsFile, 'utf8')).split(/\r?\n/)) {
  if (!line.trim()) continue;
  const match = /^([a-fA-F0-9]{64})\s+\*?(mockbrew-(?:macos|linux|windows)-(?:arm64|x64)(?:\.exe)?)$/.exec(line);
  if (!match || sums.has(match[2])) throw new Error(`Invalid or duplicate checksum entry: ${line}`);
  sums.set(match[2], match[1].toLowerCase());
}
for (const name of ['mockbrew-macos-arm64', 'mockbrew-macos-x64', 'mockbrew-linux-arm64', 'mockbrew-linux-x64', 'mockbrew-windows-x64.exe']) if (!sums.has(name)) throw new Error(`Missing checksum for ${name}`);
const formulaFile = 'packaging/homebrew/mockbrew.rb';
const scoopFile = 'packaging/scoop/mockbrew.json';
let formula = await readFile(formulaFile, 'utf8');
formula = formula.replace(/^(  version ")[^"]+("\s*)$/m, `$1${version}$2`);
for (const name of ['mockbrew-macos-arm64', 'mockbrew-macos-x64', 'mockbrew-linux-arm64', 'mockbrew-linux-x64']) {
  const pattern = new RegExp(`(url "[^"\\n]*\\/${name}"\\s*\\n\\s*sha256 ")[^"]+(" )?`);
  if (!pattern.test(formula)) throw new Error(`Formula entry missing: ${name}`);
  formula = formula.replace(pattern, `$1${sums.get(name)}`);
}
const scoop = JSON.parse(await readFile(scoopFile, 'utf8'));
scoop.version = version;
scoop.architecture['64bit'].url = scoop.architecture['64bit'].url.replace(/\/download\/v[^/]+\//, `/download/v${version}/`);
scoop.architecture['64bit'].hash = sums.get('mockbrew-windows-x64.exe');
await writeFile(formulaFile, formula);
await writeFile(scoopFile, `${JSON.stringify(scoop, null, 2)}\n`);
