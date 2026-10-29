# Releasing Pullshelf

Pullshelf ships as an Apple-Silicon `.zip` on GitHub Releases, installed through a Homebrew tap.

- App repo: `yogeshvar/pullshelf`
- Tap repo: `yogeshvar/homebrew-pullshelf` (the cask lives at `Casks/pullshelf.rb`; the copy in `homebrew/Casks/pullshelf.rb` here is the template)

## Cut a release

1. Bump `version` in `package.json` (the zip name, the cask URL and the tag all derive from it).
2. Make sure the checks are green: `npm run typecheck && npm run test:coverage`.
3. Build the zip:

   ```sh
   npm run package
   ```

   This builds the UI, compiles `native/bin/GestureHelper` fresh (arm64, macOS 13+; it fails loudly if `swiftc` is missing),
   runs electron-builder, ad-hoc signs the helper and the app (`scripts/after-pack.cjs`), and prints the zip path, size and SHA-256.
   Output: `release/Pullshelf-<version>-arm64.zip`. `npm run package:dir` builds only `release/mac-arm64/Pullshelf.app`, which is faster for testing.
4. Smoke-test the unpacked zip before publishing. Unzip it somewhere under `/private/tmp` (not `/Applications`), then:

   ```sh
   codesign --verify --deep --strict --verbose=2 Pullshelf.app
   Pullshelf.app/Contents/MacOS/Pullshelf --user-data-dir=/private/tmp/pullshelf-smoke &
   # after ~8 s: /private/tmp/pullshelf-smoke/pullshelf.db exists and `pgrep -fl GestureHelper` shows a child
   ```
5. Create the GitHub release with the tag `vX.Y.Z` and attach the zip:

   ```sh
   gh release create vX.Y.Z release/Pullshelf-X.Y.Z-arm64.zip --title "Pullshelf X.Y.Z" --notes "..."
   ```
6. In the tap repo, edit `Casks/pullshelf.rb`: set `version` and `sha256` (the SHA-256 printed by `npm run package`;
   re-check it against the uploaded asset with `shasum -a 256`). Keep `homebrew/Casks/pullshelf.rb` in this repo in sync.
7. Test the install from the tap, then push the tap:

   ```sh
   brew style --cask yogeshvar/pullshelf/pullshelf
   brew install --cask yogeshvar/pullshelf/pullshelf
   brew uninstall --cask --zap pullshelf
   ```

Users install with `brew install --cask yogeshvar/pullshelf/pullshelf`.

## Signing and notarization

There is no Apple Developer ID, so the app is **ad-hoc signed only** (`codesign --sign -`) and **not notarized**.
Consequences:

- Gatekeeper blocks the first launch of a downloaded copy. On macOS 15 and later: try to open it once, then System Settings,
  Privacy & Security, "Open Anyway". Older macOS: right-click the app and choose Open. Or run `xattr -dr com.apple.quarantine /Applications/Pullshelf.app`.
  The cask's caveats say this; the cask does not strip quarantine itself.
- The cask would be rejected by the official `homebrew/cask` tap, which requires Gatekeeper-passing, notarized apps
  (`brew audit --cask --new` reports "Signature verification failed"). It is fine in a third-party tap.
- The ad-hoc signature changes with every build, so macOS treats each update as a new app and the **Accessibility permission
  (needed for the scroll gesture) has to be granted again after updating**. A stable Developer ID signature fixes this.

To notarize (the hook is already built, but it has not been run with a real certificate yet):

1. Join the Apple Developer Program and create a "Developer ID Application" certificate in your login keychain.
2. Store notarization credentials once: `xcrun notarytool store-credentials pullshelf-notary` (or use the Apple ID variables below).
3. Build with the identity in the environment. `scripts/after-pack.cjs` then signs every nested binary inside-out with the hardened
   runtime and `build/entitlements.mac.plist`, notarizes, and staples before electron-builder zips the app:

   ```sh
   PULLSHELF_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
   PULLSHELF_NOTARY_PROFILE=pullshelf-notary \
   npm run package
   # or instead of PULLSHELF_NOTARY_PROFILE: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
   ```

   Without `PULLSHELF_SIGN_IDENTITY` it falls back to the ad-hoc signing above. With an identity but no notarization credentials it signs but skips notarization.
4. Verify the zip contents: `codesign --verify --deep --strict`, `spctl --assess --type execute -vv Pullshelf.app`, `xcrun stapler validate Pullshelf.app`.
5. Drop the quarantine instructions from the cask caveats, the README and the site.
