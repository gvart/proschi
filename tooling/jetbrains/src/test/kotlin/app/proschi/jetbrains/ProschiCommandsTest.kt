package app.proschi.jetbrains

import app.proschi.jetbrains.cli.ProschiCommands
import app.proschi.jetbrains.settings.ProschiSettings
import org.junit.Assert.assertEquals
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
}
