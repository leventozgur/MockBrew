// Experimental SEA bundling; dependency manifests stay untouched.
import { rolldown } from 'rolldown';
import { mkdir } from 'node:fs/promises';

await mkdir('scripts/sea/out', { recursive: true });
const bundle = await rolldown({
  input: 'dist/cli/main.js',
  platform: 'node',
  plugins: [{
    name: 'sea-cli-async-wrapper',
    transform(code, id) {
      if (!id.endsWith('/dist/cli/main.js')) return;
      const marker = '\ntry {\n    if (isSea()';
      if (!code.includes(marker)) throw new Error('CLI entry shape changed; review the SEA transform.');
      return code.replace(marker, '\n(async () => {\ntry {\n    if (isSea()') + '\n})();\n';
    },
  }],
});
await bundle.write({ file: 'scripts/sea/out/main.cjs', format: 'cjs', inlineDynamicImports: true });
await bundle.close();
