# Ship unsigned, and strip quarantine in the Homebrew cask

_Recorded retroactively on 2026-11-25. Evidence: `.github/workflows/release.yml`, `electron-builder.json`, and as recalled by Miguel Coquet._

Cockpit's DMGs are built without code signing or notarisation (`CSC_IDENTITY_AUTO_DISCOVERY: false`). The Homebrew cask that the release workflow writes removes the `com.apple.quarantine` attribute after install, so macOS opens the app without the unsigned-app warning; direct DMG installs need the same `xattr` command by hand. This avoids an Apple Developer account and the signing setup. The cost is that macOS treats Cockpit as unidentified, and an unsigned app is the likely reason its privacy access grants reset when an update replaces it (#30).
