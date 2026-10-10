package app.proschi.jetbrains.lsp

import app.proschi.jetbrains.ProschiFiles
import app.proschi.jetbrains.ProschiIcons
import app.proschi.jetbrains.cli.ProschiCommands
import app.proschi.jetbrains.settings.ProschiConfigurable
import app.proschi.jetbrains.settings.ProschiSettings
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.LspServer
import com.intellij.platform.lsp.api.LspServerManager
import com.intellij.platform.lsp.api.LspServerSupportProvider
import com.intellij.platform.lsp.api.ProjectWideLspServerDescriptor
import com.intellij.platform.lsp.api.customization.LspCustomization
import com.intellij.platform.lsp.api.customization.LspSemanticTokensCustomizer
import com.intellij.platform.lsp.api.lsWidget.LspServerWidgetItem

// The pre-2026.1.4 names of the LSP API (LspServer*): the only ones in 2025.3, and
// still supported (deprecated) after the rename to LspClient* / LspIntegrationProvider.
// Switch when since-build moves past 2026.1.4.

/** Starts one Proschi language server per project when a `.proschi` file is opened. */
class ProschiLspServerSupportProvider : LspServerSupportProvider {
    override fun fileOpened(project: Project, file: VirtualFile, serverStarter: LspServerSupportProvider.LspServerStarter) {
        if (ProschiFiles.isProschi(file) && ProschiSettings.options.languageServerEnabled) {
            serverStarter.ensureServerStarted(ProschiLspServerDescriptor(project))
        }
    }

    /** The entry in the status bar's Language Services widget, with a link to the settings. */
    override fun createLspServerWidgetItem(lspServer: LspServer, currentFile: VirtualFile?): LspServerWidgetItem =
        LspServerWidgetItem(lspServer, currentFile, ProschiIcons.FILE, ProschiConfigurable::class.java)
}

/**
 * `proschi-language-server --stdio` (see [ProschiCommands] for how it is found).
 * The defaults cover what the server offers: diagnostics, quick fixes, completion,
 * hover, definition, references, document symbols, document links and formatting.
 * Formatting goes to the server because the IDE has no formatter of its own for
 * TextMate files, so Reformat Code (Ctrl+Alt+L / Cmd+Opt+L) uses it. Semantic tokens
 * color node ids, tech stacks and teams (see [ProschiSemanticTokensSupport]).
 */
class ProschiLspServerDescriptor(project: Project) : ProjectWideLspServerDescriptor(project, "Proschi") {
    override fun isSupportedFile(file: VirtualFile): Boolean = ProschiFiles.isProschi(file)

    override fun createCommandLine(): GeneralCommandLine =
        ProschiCommands.commandLine(ProschiCommands.languageServer(ProschiSettings.options), project.basePath?.let { java.nio.file.Path.of(it) })

    override val lspCustomization: LspCustomization = object : LspCustomization() {
        override val semanticTokensCustomizer: LspSemanticTokensCustomizer = ProschiSemanticTokensSupport()
    }
}

object ProschiLanguageServer {
    /** Stops the servers and, if enabled, starts them again for the open `.proschi` files (after a settings change). */
    fun restartAll() {
        for (project in ProjectManager.getInstance().openProjects) {
            if (!project.isDisposed) {
                LspServerManager.getInstance(project).stopAndRestartIfNeeded(ProschiLspServerSupportProvider::class.java)
            }
        }
    }
}
