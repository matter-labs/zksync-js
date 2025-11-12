// tsup.config.ts
import { defineConfig } from 'tsup';

const entry = [
  'src/index.ts',
  'src/core/index.ts',
  'src/core/constants.ts',
  'src/adapters/viem/index.ts',
  'src/adapters/viem/client.ts',
  'src/adapters/viem/sdk.ts',
  'src/adapters/ethers/index.ts',
  'src/adapters/ethers/client.ts',
  'src/adapters/ethers/sdk.ts',
  '!src/**/__tests__/**',
  '!src/**/__mocks__/**',
  '!src/**/e2e/**',
  '!src/**/*.e2e.ts',
  '!src/**/e2e/**',
  '!test/**',
  '!src/adapters/__tests__/**',
];

export default defineConfig([
  {
    entry,
    outDir: 'dist',
    format: ['esm'],
    target: 'es2022',
    bundle: true,
    splitting: true,
    treeshake: true,
    sourcemap: false,
    skipNodeModulesBundle: true,
    external: ['ethers', 'viem', '@typechain/ethers-v6'],
    dts: false,
    clean: false,
    minify: false,
    shims: false,
    outExtension: () => ({ js: '.js' }),
    tsconfig: 'tsconfig.build.json',
    loader: { '.json': 'json' },
  },
  // CJS sourcemaps
  {
    entry,
    outDir: 'dist',
    format: ['cjs'],
    target: 'es2022',
    bundle: true,
    splitting: false,
    treeshake: true,
    sourcemap: true,
    skipNodeModulesBundle: true,
    external: ['ethers', 'viem', '@typechain/ethers-v6'],
    dts: false,
    clean: false,
    minify: false,
    shims: false,
    outExtension: () => ({ js: '.cjs' }),
    tsconfig: 'tsconfig.build.json',
    loader: { '.json': 'json' },
    esbuildOptions(options) {
      options.sourcesContent = false;
    },
  },
]);
