// Build script: host ESM bundle + client CJS bundle wrapped for the DSH browser
// ModuleLoader. DSH-provided packages stay external — the runtime resolves them.
// React is provided by the host page for the client bundle.
import { build } from 'esbuild'
import { mkdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

mkdirSync('lib', { recursive: true })
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

// Emit lib/index.d.ts so package.json#types resolves (host bundle types only).
const dts = spawnSync(
  process.execPath,
  [
    'node_modules/typescript/bin/tsc',
    'src/index.ts',
    '--declaration',
    '--emitDeclarationOnly',
    '--outDir',
    'lib',
    '--module',
    'esnext',
    '--moduleResolution',
    'bundler',
    '--target',
    'es2022',
    '--skipLibCheck',
    '--types',
    'node',
  ],
  { stdio: 'inherit' },
)
if (dts.status !== 0) process.exit(dts.status ?? 1)

// Host half: ESM, one file, DSH packages external (host-resolved at runtime).
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: false,
  external: ['@deepseek-ai/*', 'node:*'],
  logLevel: 'warning',
})

// Client half: CJS inside the ModuleLoader factory wrapper. The banner id must
// match package.name so the boot loader registers this bundle's entry.
const banner = `window.__ModuleLoader__.load({ id: ${JSON.stringify(pkg.name)}, factory: (require) => {
var module = { exports: {} }; var exports = module.exports;`
const footer = `
return module.exports; } });`

await build({
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  sourcemap: false,
  jsx: 'transform',
  external: ['react', 'react-dom'],
  banner: { js: banner },
  footer: { js: footer },
  logLevel: 'warning',
})

console.log('dsh-goal-keeper: built lib/index.js + lib/client.js')
