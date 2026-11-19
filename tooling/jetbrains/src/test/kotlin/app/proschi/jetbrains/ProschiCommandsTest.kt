package app.proschi.jetbrains

import app.proschi.jetbrains.cli.ProschiCommands
import app.proschi.jetbrains.preview.withStyle
import app.proschi.jetbrains.settings.ProschiSettings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import java.security.MessageDigest
import java.util.Base64
import org.junit.Test

/** How the language server and the CLI are found; no IDE needed. */
class ProschiCommandsTest {
    private val nothingOnPath: (String) -> String? = { null }

    @Test
    fun `falls back to npx when nothing is configured or on PATH`() {
        assertEquals(
            listOf("npx", "-y", "--package=proschi@latest", "proschi-language-server", "--stdio"),
            ProschiCommands.languageServer(ProschiSettings.Options(), nothingOnPath, windows = false),
        )
        assertEquals(
            listOf("npx.cmd", "-y", "--package=proschi@latest", "proschi", "check", "a.proschi"),
            ProschiCommands.cli(ProschiSettings.Options(), listOf("check", "a.proschi"), nothingOnPath, windows = true),
        )
    }

    @Test
    fun `prefers the executable on PATH`() {
        val find: (String) -> String? = { if (it == "proschi-language-server") "/usr/local/bin/proschi-language-server" else null }
        assertEquals(
            listOf("/usr/local/bin/proschi-language-server", "--stdio"),
            ProschiCommands.languageServer(ProschiSettings.Options(), find, windows = false),
        )
    }

    @Test
    fun `runs a configured script with the configured node`() {
        val options = ProschiSettings.Options(serverPath = " /repo/tooling/dist/server.cjs ", nodePath = "/opt/node/bin/node")
        assertEquals(
            listOf("/opt/node/bin/node", "/repo/tooling/dist/server.cjs", "--stdio"),
            ProschiCommands.languageServer(options, nothingOnPath, windows = false),
        )
    }

    @Test
    fun `runs a configured executable directly`() {
        val options = ProschiSettings.Options(cliPath = "/home/me/.npm-global/bin/proschi")
        assertEquals(
            listOf("/home/me/.npm-global/bin/proschi", "test", "a.proschi"),
            ProschiCommands.cli(options, listOf("test", "a.proschi"), nothingOnPath, windows = false),
        )
    }

    @Test
    fun `renders the preview page in the theme of the settings, which proschi json overrides`() {
        assertEquals(
            listOf("render", "--format", "preview-html", "--default-theme", "classic", "--out", "/tmp/p", "shop.proschi"),
            ProschiCommands.previewArgs("shop.proschi", "/tmp/p", "classic"),
        )
        assertEquals(listOf("render", "--format", "html", "--out", "/tmp/p", "shop.proschi"), ProschiCommands.legacyPreviewArgs("shop.proschi", "/tmp/p"))
        assertEquals(listOf("sketch-light", "sketch-dark", "classic"), ProschiSettings.PREVIEW_THEMES)
        assertEquals("sketch-light", ProschiSettings.Options().previewTheme)
    }

    @Test
    fun `reads the preview theme setting with its alias, and an unknown one as the default`() {
        assertEquals("sketch-dark", ProschiSettings.previewTheme("sketch-dark"))
        assertEquals("classic", ProschiSettings.previewTheme("classic"))
        assertEquals("sketch-light", ProschiSettings.previewTheme("sketch"))
        assertEquals("sketch-light", ProschiSettings.previewTheme("neon"))
        assertEquals("sketch-light", ProschiSettings.previewTheme(null))
    }

    @Test
    fun `falls back to the html page only when the CLI does not know the preview's options`() {
        assertTrue(ProschiCommands.isOlderCli(2, "Unknown format 'preview-html'; use svg, md, html, hld-md, hld-html"))
        assertTrue(ProschiCommands.isOlderCli(2, "Unknown option --default-theme\n\nUsage: …"))
        assertFalse(ProschiCommands.isOlderCli(2, "Unknown theme 'neon' in /w/proschi.json; use sketch-light, sketch-dark, classic, sketch"))
        assertFalse(ProschiCommands.isOlderCli(1, "Line 2:1: Duplicate id 'a'"))
    }

    @Test
    fun `adds the restyle's hash to a page that allows styles only by hash`() {
        val css = "body { font-size: 13px; }"
        val hash = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(css.toByteArray()))
        val page = "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'sha256-abc'; script-src 'sha256-def'\"></head>"
        assertEquals(
            "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; style-src 'sha256-$hash' 'sha256-abc'; script-src 'sha256-def'\">" +
                "<style>$css</style>\n</head>",
            withStyle(page, css),
        )
        // 'unsafe-inline' already allows it, and a hash next to it would switch it off.
        val inline = "<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:\"></head>"
        assertEquals(inline.replace("</head>", "<style>$css</style>\n</head>"), withStyle(inline, css))
    }
}
