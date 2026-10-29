// Builds a distributable Pullshelf: UI bundle, Swift helper, electron-builder, then prints zip path, size and SHA-256.
// Usage: npm run package          -> release/Pullshelf-<version>-arm64.zip
//        npm run package:dir      -> release/mac-arm64/Pullshelf.app only (no zip, faster)
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Electron 44's own minimum (LSMinimumSystemVersion in its Info.plist and LC_BUILD_VERSION minos are both 13.0).
const MIN_MACOS = '13.0'
const dirOnly = process.argv.includes('--dir')
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

function run(command, args, label) {
  console.log(`\n==> ${label}`)
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' } })
  if (result.error?.code === 'ENOENT') fail(`${command} not found. ${command === 'swiftc' ? 'Install the Xcode command line tools: xcode-select --install' : ''}`)
  if (result.status !== 0) fail(`${label} failed (exit ${result.status})`)
  return result
}

function fail(message) {
  console.error(`\npackage: ${message}`)
  process.exit(1)
}

if (process.platform !== 'darwin') fail('Pullshelf only packages on macOS.')
if (spawnSync('swiftc', ['--version'], { stdio: 'ignore' }).status !== 0) {
  fail('swiftc is missing, so the gesture helper cannot be compiled. Install the Xcode command line tools: xcode-select --install')
}

run('npx', ['electron-vite', 'build'], 'Building the UI')
// Same flags as `npm run compile:gesture`, plus an explicit deployment target. Without -target swiftc stamps the
// build machine's macOS version as the minimum (27.2 here), and the helper would refuse to start on older Macs.
run(
  'swiftc',
  ['-swift-version', '5', '-O', '-target', `arm64-apple-macos${MIN_MACOS}`, '-framework', 'AppKit', '-framework', 'ApplicationServices', '-o', 'native/bin/GestureHelper', 'native/GestureHelper.swift'],
  `Compiling GestureHelper (arm64, macOS ${MIN_MACOS}+)`
)
if (!existsSync(resolve(root, 'native/bin/GestureHelper'))) fail('native/bin/GestureHelper was not produced')
run('npx', ['electron-builder', '--mac', ...(dirOnly ? ['--dir'] : ['zip']), '--arm64'], dirOnly ? 'Packaging Pullshelf.app' : 'Packaging Pullshelf zip')

if (dirOnly) {
  console.log(`\nApp: ${resolve(root, 'release/mac-arm64/Pullshelf.app')}`)
} else {
  const zip = resolve(root, `release/Pullshelf-${version}-arm64.zip`)
  if (!existsSync(zip)) fail(`expected artifact not found: ${zip}`)
  const sha = spawnSync('shasum', ['-a', '256', zip], { encoding: 'utf8' }).stdout.split(' ')[0]
  console.log(`\nZip:    ${zip}\nSize:   ${statSync(zip).size} bytes\nSHA256: ${sha}`)
}
