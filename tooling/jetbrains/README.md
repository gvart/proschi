# Proschi for JetBrains IDEs

A plugin for IntelliJ IDEA, WebStorm, PyCharm and the other JetBrains IDEs
(2025.3 and newer) that adds support for Proschi diagrams (`*.proschi`).

> **Status: first version, not yet published.** It was written without
> access to the IntelliJ SDK (the build sandbox could not reach JetBrains'
> servers), so it has not been compiled or run yet. The CI workflow
> (`.github/workflows/jetbrains.yml`) is the first real build. See
> [What has been verified](#what-has-been-verified).

## Features

| Feature | How |
|---|---|
| Syntax highlighting, bracket matching, auto-closing pairs, `#` comment toggling | The TextMate grammar (`tooling/grammar`) and the VS Code language configuration, loaded through IntelliJ's bundled TextMate plugin |
| File icon | The site's logo, for `*.proschi` in the project view, tabs and *Go to File* |
| Errors and warnings as you type, quick fixes, completion, hover (*Quick Documentation*), go to definition, find usages, *Structure*, links on import paths | The Proschi language server (`proschi-language-server --stdio`) through the IDE's built-in LSP client |
| Formatting | *Code → Reformat Code* (Ctrl+Alt+L / ⌥⌘L) sends `textDocument/formatting` to the server. It is also in the *Proschi* menu |
| *Tools → Proschi → Check File* | `proschi check <file>`; the result appears in a notification, with *Show output* for the full text |
| *Tools → Proschi → Run Tests* | `proschi test <file>`: the file's requirements and test blocks against the simulation |
| *Tools → Proschi → Show Diagram Preview* | `proschi render --format html` shown in the *Proschi Preview* tool window (JCEF). It renders again each time you save the file, and switches to whichever `.proschi` editor you select while the window is open |
| *Tools → Proschi → Open in Proschi* | `proschi share-link <file>` and opens the link: the web editor at proschi.app with the file and its imports. The diagram travels in the link; nothing is uploaded |
| Status bar | The *Language Services* widget shows the server's state and links to the settings |
| Settings | *Settings → Languages & Frameworks → Proschi*: turn the language server on or off, and set paths to the server, the CLI and Node.js |

The *Proschi* menu also opens from the editor and project view context menus
on `.proschi` files.

## How it works

```
tooling/jetbrains/
├── build.gradle.kts            IntelliJ Platform Gradle Plugin 2.x; the textMateBundle task
├── gradle.properties           plugin id, version, platform version, since-build
├── src/main/kotlin/app/proschi/jetbrains/
│   ├── Proschi.kt              file detection, icon, TextMate bundle provider
│   ├── lsp/ProschiLsp.kt       LSP server support provider and descriptor
│   ├── cli/ProschiCommands.kt  how `proschi` / `proschi-language-server` are found
│   ├── cli/ProschiCli.kt       runs the CLI in the background, notifications
│   ├── actions/                Check File, Run Tests, Show Diagram Preview, Open in Proschi
│   ├── preview/                the Proschi Preview tool window (JCEF)
│   └── settings/               the settings state and page
└── src/main/resources/META-INF/plugin.xml
```

### Highlighting: TextMate, not LSP semantic tokens

The repository already has a TextMate grammar, and IntelliJ bundles a TextMate
plugin with an extension point for plugins to add bundles
(`com.intellij.textmate.bundleProvider`). At build time, the `textMateBundle`
task copies `tooling/vscode/package.json`,
`tooling/vscode/language-configuration.json` and
`tooling/grammar/proschi.tmLanguage.json` into the plugin's `textmate/proschi`
folder. That is the same layout as the VS Code extension, so the grammar has
one source for every editor and the plugin needs about ten lines of code.
Semantic tokens would have needed new code in the language server.

Trade-off: `.proschi` files take the *TextMate* file type, not a dedicated one.
That is why the icon comes from a `FileIconProvider`, and why the plugin works
out which files are Proschi files from their extension. A dedicated `Language`
and `FileType` (with a lexer, a parser and PSI) would allow color settings per
token and a native formatter, and would be the next step if the plugin needs
features that LSP can't provide.

### Language server: the built-in LSP API, not LSP4IJ

| | Built-in (`com.intellij.platform.lsp`) | [LSP4IJ](https://github.com/redhat-developer/lsp4ij) (Red Hat) |
|---|---|---|
| Available in | Every JetBrains IDE from 2025.3 (IntelliJ IDEA is one distribution for the free and paid tiers since 2025.3), PyCharm without Pro since 2025.1. **Not** in IntelliJ IDEA open-source builds or Android Studio | Every IntelliJ-based IDE, Android Studio and open-source builds included |
| What users install | Nothing extra | The LSP4IJ plugin as well (a required dependency) |
| Features | Everything this server offers: diagnostics, quick fixes, completion, hover, definition, references, symbols, links, formatting | More, plus an LSP console for debugging and user-defined servers |
| API | Part of the platform, documented in the SDK, changes with platform releases (renamed in 2026.1.4, old names kept) | A third-party API with its own release cycle |

The built-in client covers every feature of the Proschi server and needs no
second plugin. The plugin targets 2025.3+ (`pluginSinceBuild = 253`), where the
LSP module (`com.intellij.modules.lsp`, declared since 2025.2.1) ships with every
JetBrains IDE except IntelliJ IDEA open-source builds and Android Studio. Users
of those can still use LSP4IJ by hand, as `docs/EDITORS.md` describes.

The code uses the API's pre-2026.1.4 names (`LspServerSupportProvider`,
`ProjectWideLspServerDescriptor`, `LspServerManager`), which are the only names
2025.3 has. 2026.1.4 renamed them (`LspIntegrationProvider`,
`LspClientDescriptor`, …) and kept the old names as deprecated aliases. Switch to
the new names when `pluginSinceBuild` moves past 2026.1.4.

### Finding the server and the CLI

The plugin does not bundle the language server (`server.cjs`). It resolves each
executable in this order (`ProschiCommands`):

1. the path in the settings: an executable, or a `.js`/`.cjs`/`.mjs` script run
   with the configured Node.js;
2. `proschi-language-server` / `proschi` on PATH (`npm install -g proschi`);
3. `npx -y --package=proschi@latest proschi-language-server --stdio` (or
   `… proschi <command>`), which downloads the package on first use.

Why not bundle `server.cjs`, as the VS Code extension does? The VS Code
extension can, because VS Code includes a Node.js runtime. JetBrains IDEs don't,
so Node.js is needed either way. Leaving the server out keeps the Gradle build
free of npm, keeps the plugin small, and lets the server update without a new
plugin release. The cost is a slow first start through npx and a version that
can move under the user. If that turns out to be a problem, bundling is cheap:
copy `tooling/dist/server.cjs` and `cli.cjs` into the sandbox the same way the
TextMate bundle is copied, and add them as a fourth fallback (or make them the
default).

The CLI runs in the file's directory with the user's shell environment, so on
macOS the IDE finds what the login shell finds (nvm, Homebrew). If a Node.js
path is set, its folder goes first on PATH, which `npx` needs.

### Preview

The VS Code extension renders the preview in-process, as you type, from the
same renderer as the CLI. Doing that here would mean running Node.js
alongside, so the plugin runs `proschi render --format html` when you save and
shows the page in JCEF. If the file has errors, the preview shows them instead.

## Build and run

You need JDK 21. The Gradle wrapper downloads Gradle 9.8, and the IntelliJ
Platform Gradle Plugin downloads the IDE it builds against (about 1.5 GB, cached
in `~/.gradle`).

```sh
cd tooling/jetbrains
./gradlew runIde          # starts IntelliJ IDEA 2025.3 with the plugin, in a sandbox
./gradlew buildPlugin     # the plugin zip in build/distributions/
./gradlew check           # unit and platform tests
./gradlew verifyPlugin    # Plugin Verifier against the recommended IDE versions
```

To install the zip: *Settings → Plugins → ⚙ → Install Plugin from Disk…*.

To try it with an unreleased server, build the tooling (`cd tooling && npm ci && npm run build`)
and set *Settings → Languages & Frameworks → Proschi* to
`<repo>/tooling/dist/server.cjs` (server) and `<repo>/tooling/dist/cli.cjs` (CLI).
To see the LSP traffic, add `#com.intellij.platform.lsp` in
*Help → Diagnostic Tools → Debug Log Settings…*.

The platform version is `platformVersion` in `gradle.properties`. To run
another IDE, change `intellijIdea(...)` in `build.gradle.kts` (for example
`webstorm("2025.3")`), or point `runIde` at a local installation with
`local("/path/to/IDE")`.

## What has been verified

- **Verified:** the Gradle build script configures and lists its tasks, and the
  `textMateBundle` task produces the bundle. This was checked with Gradle 8.14
  and IntelliJ Platform Gradle Plugin 2.10.5, because the sandbox could not
  download Gradle 9 or 2.19.0's requirements.
- **Parses:** compiling the Kotlin sources without the SDK gives only
  unresolved-reference errors, so there are no syntax errors.
- **Checked against the SDK sources** (intellij-community on GitHub), not
  compiled: the TextMate `TextMateBundleProvider` interface, the LSP API names
  and signatures, `Row.textFieldWithBrowseButton`, and `PathEnvironmentVariableUtil`.
- **Not verified:** compiling, `buildPlugin`, `verifyPlugin`, the tests, and
  running in an IDE. JetBrains' servers (the SDK download) were blocked.

## Manual steps for the owner

1. **Build it once:** `./gradlew buildPlugin check verifyPlugin`, and fix
   whatever the first real compile reports. The likeliest problems: a
   `bundledModule(...)` dependency the LSP API needs in 2025.3; a changed
   signature in the Kotlin UI DSL (`ProschiConfigurable`); and the test sandbox
   path in `ProschiPluginTest.testTextMateBundleShipsWithThePlugin`.
2. **Try it:** `./gradlew runIde`, open a folder with `.proschi` files (for
   example `frontend/src/practice/problems`), then go through the
   [test matrix](#manual-test-matrix).
3. **Decide the plugin ID.** It is `app.proschi` (`gradle.properties` and
   `plugin.xml`, in sync) and **cannot change after the first upload**.
   Reverse-DNS of a domain you own is the convention. Also check the
   `<vendor>` in `plugin.xml`, and choose the `<name>` shown on the Marketplace.
4. **Create a JetBrains Marketplace vendor.** Sign in at
   <https://plugins.jetbrains.com/> with a JetBrains Account, then *Profile →
   Add vendor* (personal or organization). Accept the Marketplace developer
   agreement.
5. **Create a signing certificate.** Generate a private key and a
   self-signed certificate, as in
   <https://plugins.jetbrains.com/docs/intellij/plugin-signing.html>:

   ```sh
   openssl genpkey -aes-256-cbc -algorithm RSA -out private_encrypted.pem -pkeyopt rsa_keygen_bits:4096
   openssl rsa -in private_encrypted.pem -out private.pem
   openssl req -key private.pem -new -x509 -days 3650 -out chain.crt
   ```

   Keep the files outside the repository.
6. **Upload the first version by hand.** The Marketplace needs the first
   upload through the web UI: *Upload plugin*, the signed zip (run
   `CERTIFICATE_CHAIN="$(cat chain.crt)" PRIVATE_KEY="$(cat private.pem)" PRIVATE_KEY_PASSWORD=… ./gradlew signPlugin`
   to get the `-signed.zip` in `build/distributions/`), license (MIT),
   category (*Languages* or *Tools Integration*), tags, source URL. JetBrains
   reviews it, which can take a couple of working days.
7. **Create a publishing token:** *Profile → My Tokens → Generate Token*.
8. **Add four repository secrets** (*Settings → Secrets and variables → Actions*):

   | Secret | Value |
   |---|---|
   | `JETBRAINS_CERTIFICATE_CHAIN` | contents of `chain.crt` |
   | `JETBRAINS_PRIVATE_KEY` | contents of `private.pem` |
   | `JETBRAINS_PRIVATE_KEY_PASSWORD` | the key's password |
   | `JETBRAINS_PUBLISH_TOKEN` | the Marketplace token |

   The workflow maps them to the `CERTIFICATE_CHAIN`, `PRIVATE_KEY`,
   `PRIVATE_KEY_PASSWORD` and `PUBLISH_TOKEN` environment variables that
   `build.gradle.kts` reads. Until all four exist, the publish job is skipped
   with a notice.
9. **Release:** bump `pluginVersion` in `gradle.properties`, merge, then push
   the tag `jetbrains-v<version>` (for example `git tag jetbrains-v0.8.0 origin/main && git push origin jetbrains-v0.8.0`).
   A version with a suffix (`0.9.0-beta.1`) goes to the `beta` channel.
10. **Screenshots for the Marketplace page** (1280×800 or larger): the editor
    with highlighting and an error underlined, completion of the tech catalog,
    the preview tool window, and the settings page. The Marketplace page also
    takes the description in `plugin.xml`, change notes and the source link.
11. **Afterwards:** replace the "first version" notice at the top of this file
    and *IntelliJ IDEA and other JetBrains IDEs* in `docs/EDITORS.md` with a
    Marketplace link, and add the link to the root README.

### Manual test matrix

| | IntelliJ IDEA (free tier) | IntelliJ IDEA (Ultimate subscription) | WebStorm | PyCharm |
|---|---|---|---|---|
| Plugin installs from disk, no errors in *Help → Show Log* | | | | |
| `.proschi`: logo icon, highlighting, `#` comment toggling (Ctrl+/) | | | | |
| Error underlined as you type; quick fix on an unknown tech stack | | | | |
| Completion: keywords, node ids, `[` tech catalog | | | | |
| Hover (Quick Documentation), go to definition, find usages, *Structure* | | | | |
| Reformat Code formats through the server | | | | |
| Check File / Run Tests notifications; *Show output* | | | | |
| Preview renders, updates on save, shows errors | | | | |
| Open in Proschi opens the web editor with the diagram | | | | |
| Settings: disabling stops the server; a bad path gives an error in the Language Services widget | | | | |
| No `proschi` on PATH: falls back to npx | | | | |
| Windows (`npx.cmd`, paths with spaces) | | | | |
| macOS launched from the Dock (PATH from the login shell, nvm) | | | | |

## Possible next steps

- Bundle `server.cjs` and `cli.cjs` (see [above](#finding-the-server-and-the-cli)).
- A live preview as you type: render through the language server (a custom
  request returning the SVG), or reuse `tooling/src/render/preview.ts` the way
  the VS Code extension does.
- Show `proschi test` results in the test runner (SM test runner messages)
  instead of a notification.
