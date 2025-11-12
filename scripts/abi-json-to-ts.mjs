import { promises as fs } from 'node:fs';
import path from 'node:path';

const SRC = 'src/core/internal/abis';
const files = (await fs.readdir(SRC)).filter((f) => f.endsWith('.json'));

for (const file of files) {
  const base = file.replace(/\.json$/, '');
  const jsonPath = path.join(SRC, file);
  const tsPath = path.join(SRC, base + '.ts');

  const raw = await fs.readFile(jsonPath, 'utf8');
  // pretty but compact-ish; you can do JSON.parse/stringify if you want to normalize
  const content = `
import type { JsonFragment } from 'ethers';

const ${base}ABI = ${raw} as const satisfies readonly JsonFragment[];
export default ${base}ABI;
`.trimStart();

  await fs.writeFile(tsPath, content, 'utf8');
  console.log('wrote', tsPath);
}
