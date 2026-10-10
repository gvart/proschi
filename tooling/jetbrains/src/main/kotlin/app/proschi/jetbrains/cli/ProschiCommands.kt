package app.proschi.jetbrains.cli

import app.proschi.jetbrains.settings.ProschiSettings
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.configurations.PathEnvironmentVariableUtil
import com.intellij.openapi.util.SystemInfo
import java.io.File
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path

/**
 * Builds the command lines for the two executables of the `proschi` npm package.
 *
 * Each is resolved in this order:
 * 1. the path set in the settings (a `.js`/`.cjs`/`.mjs` path is run with Node.js),
 * 2. the executable on PATH (`npm install -g proschi`),
 * 3. `npx -y --package=proschi@latest <bin>`, which downloads the package on first use.
 *
 * The functions taking `find` and `windows` are pure, for tests.
 */
object ProschiCommands {
    const val PACKAGE = "proschi@latest"
    const val SERVER_BIN = "proschi-language-server"
    const val CLI_BIN = "proschi"

    fun languageServer(
        options: ProschiSettings.Options,
        find: (String) -> String? = ::findOnPath,
        windows: Boolean = SystemInfo.isWindows,
    ): List<String> = resolve(options.serverPath, SERVER_BIN, options.nodePath, find, windows) + "--stdio"

    fun cli(
        options: ProschiSettings.Options,
        args: List<String>,
        find: (String) -> String? = ::findOnPath,
        windows: Boolean = SystemInfo.isWindows,
    ): List<String> = resolve(options.cliPath, CLI_BIN, options.nodePath, find, windows) + args

    internal fun resolve(
        configured: String,
        bin: String,
        nodePath: String,
        find: (String) -> String?,
        windows: Boolean,
    ): List<String> {
        val path = configured.trim()
        if (path.isNotEmpty()) {
            val isScript = listOf(".js", ".cjs", ".mjs").any { path.endsWith(it, ignoreCase = true) }
            return if (isScript) listOf(node(nodePath, find, windows), path) else listOf(path)
        }
        find(bin)?.let { return listOf(it) }
        return listOf(npx(nodePath, find, windows), "-y", "--package=$PACKAGE", bin)
    }

    private fun node(nodePath: String, find: (String) -> String?, windows: Boolean): String =
        nodePath.trim().ifEmpty { find("node") ?: if (windows) "node.exe" else "node" }

    private fun npx(nodePath: String, find: (String) -> String?, windows: Boolean): String {
        val name = if (windows) "npx.cmd" else "npx"
        if (nodePath.isNotBlank()) {
            val sibling = runCatching { Path.of(nodePath.trim()).resolveSibling(name) }.getOrNull()
            if (sibling != null && Files.isRegularFile(sibling)) return sibling.toString()
        }
        return find("npx") ?: name
    }

    /** Looks in PATH (with PATHEXT on Windows), as the IDE sees it: on macOS that is the login shell's PATH. */
    fun findOnPath(name: String): String? = PathEnvironmentVariableUtil.findExecutableInPathOnAnyOS(name)?.path

    /** A process for [command] with the user's shell environment and, if set, the configured Node.js first on PATH. */
    fun commandLine(command: List<String>, workDirectory: Path?): GeneralCommandLine {
        val commandLine = GeneralCommandLine(command)
            .withParentEnvironmentType(GeneralCommandLine.ParentEnvironmentType.CONSOLE)
            .withCharset(StandardCharsets.UTF_8)
            .withWorkDirectory(workDirectory?.toFile())
        val nodeDir = ProschiSettings.options.nodePath.trim().takeIf { it.isNotEmpty() }?.let { File(it).parent }
        if (nodeDir != null) {
            val parent = commandLine.parentEnvironment
            val key = parent.keys.firstOrNull { it.equals("PATH", ignoreCase = true) } ?: "PATH"
            commandLine.environment[key] = listOfNotNull(nodeDir, parent[key]).joinToString(File.pathSeparator)
        }
        return commandLine
    }
}
