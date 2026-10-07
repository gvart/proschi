package app.proschi.jetbrains.settings

import app.proschi.jetbrains.lsp.ProschiLanguageServer
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.options.BoundConfigurable
import com.intellij.openapi.ui.DialogPanel
import com.intellij.ui.dsl.builder.AlignX
import com.intellij.ui.dsl.builder.bindSelected
import com.intellij.ui.dsl.builder.bindText
import com.intellij.ui.dsl.builder.panel

/** Settings | Languages & Frameworks | Proschi. Applying restarts the language server in every open project. */
class ProschiConfigurable : BoundConfigurable("Proschi") {
    override fun createPanel(): DialogPanel {
        val options = ProschiSettings.options
        fun file(title: String) = FileChooserDescriptorFactory.createSingleFileNoJarsDescriptor().withTitle(title)
        return panel {
            group("Language Server") {
                row {
                    checkBox("Enable the Proschi language server")
                        .bindSelected(options::languageServerEnabled)
                        .comment("Errors and warnings as you type, completion, hover, go to definition, find usages, structure and formatting.")
                }
                row("Server:") {
                    textFieldWithBrowseButton(file("Proschi Language Server"))
                        .bindText(options::serverPath)
                        .align(AlignX.FILL)
                        .comment(
                            "<code>proschi-language-server</code> or a <code>server.cjs</code>. Empty: " +
                                "<code>proschi-language-server</code> on PATH, else " +
                                "<code>npx -y --package=proschi@latest proschi-language-server</code>.",
                        )
                }
            }
            group("Command Line") {
                row("CLI:") {
                    textFieldWithBrowseButton(file("Proschi CLI"))
                        .bindText(options::cliPath)
                        .align(AlignX.FILL)
                        .comment(
                            "Used by Check File, Run Tests, the preview and Open in Proschi. " +
                                "<code>proschi</code> or a <code>cli.cjs</code>. Empty: <code>proschi</code> on PATH, else npx.",
                        )
                }
            }
            group("Node.js") {
                row("Node:") {
                    textFieldWithBrowseButton(file("Node.js Executable"))
                        .bindText(options::nodePath)
                        .align(AlignX.FILL)
                        .comment("Node.js 18 or newer. Empty: <code>node</code> on PATH. Runs <code>.cjs</code>/<code>.js</code> paths above; its folder is put first on PATH for npx.")
                }
            }
        }
    }

    override fun apply() {
        super.apply()
        ProschiLanguageServer.restartAll()
    }
}
