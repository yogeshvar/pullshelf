// electron-builder afterPack hook. Runs after the .app is assembled and before it is zipped.
// Without credentials it ad-hoc signs (local builds, the current Homebrew zip).
// With PULLSHELF_SIGN_IDENTITY set (a "Developer ID Application: ..." name) it signs every nested binary with the
// hardened runtime, and when notarization credentials are also set it notarizes and staples before the zip is made.
//   Notarization credentials, either:
//     PULLSHELF_NOTARY_PROFILE                         a keychain profile from `xcrun notarytool store-credentials`
//     APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID
const { execFileSync } = require('node:child_process')
const { chmodSync, existsSync, rmSync } = require('node:fs')
const { join } = require('node:path')

const run = (command, args) => execFileSync(command, args, { stdio: 'inherit' })
const find = (dir, args) => {
  try {
    return execFileSync('find', [dir, ...args], { encoding: 'utf8' }).split('\n').filter(Boolean)
  } catch {
    return []
  }
}

function notaryArgs(env) {
  if (env.PULLSHELF_NOTARY_PROFILE) return ['--keychain-profile', env.PULLSHELF_NOTARY_PROFILE]
  if (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) {
    return ['--apple-id', env.APPLE_ID, '--password', env.APPLE_APP_SPECIFIC_PASSWORD, '--team-id', env.APPLE_TEAM_ID]
  }
  return null
}

exports.notaryArgs = notaryArgs

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const helper = join(app, 'Contents/Resources/GestureHelper')
  if (!existsSync(helper)) throw new Error(`GestureHelper missing from the bundle: ${helper}`)
  // node-pty's prebuilt spawn-helper ships without the execute bit; its fallback path needs it.
  const prebuilt = join(app, 'Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper')
  if (existsSync(prebuilt)) chmodSync(prebuilt, 0o755)

  const identity = process.env.PULLSHELF_SIGN_IDENTITY
  if (!identity) {
    run('codesign', ['--force', '--sign', '-', helper])
    run('codesign', ['--force', '--deep', '--sign', '-', app])
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])
    console.log('afterPack: ad-hoc signed (set PULLSHELF_SIGN_IDENTITY for a Developer ID build)')
    return
  }

  const entitlements = join(__dirname, '../build/entitlements.mac.plist')
  const sign = (target, withEntitlements = false) =>
    run('codesign', [
      '--force', '--timestamp', '--options', 'runtime', '--sign', identity,
      ...(withEntitlements ? ['--entitlements', entitlements] : []),
      target
    ])
  // Inside-out: loose native code first, then the helper, nested helper apps and frameworks, then the bundle.
  for (const file of find(join(app, 'Contents/Resources/app.asar.unpacked'), ['-type', 'f', '(', '-name', '*.node', '-o', '-name', '*.dylib', '-o', '-name', 'spawn-helper', ')'])) sign(file)
  sign(helper)
  const frameworks = join(app, 'Contents/Frameworks')
  for (const bundle of find(frameworks, ['-name', '*.framework', '-maxdepth', '1'])) sign(bundle)
  for (const bundle of find(frameworks, ['-name', '*.app', '-maxdepth', '1'])) sign(bundle, true)
  sign(app, true)
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app])

  const credentials = notaryArgs(process.env)
  if (!credentials) {
    console.log('afterPack: Developer ID signed but NOT notarized (no notarization credentials in the environment)')
    return
  }
  const archive = join(context.appOutDir, 'notarize.zip')
  run('ditto', ['-c', '-k', '--keepParent', app, archive])
  try {
    run('xcrun', ['notarytool', 'submit', archive, '--wait', ...credentials])
    run('xcrun', ['stapler', 'staple', app])
    run('xcrun', ['stapler', 'validate', app])
  } finally {
    rmSync(archive, { force: true })
  }
  console.log('afterPack: signed, notarized and stapled')
}
