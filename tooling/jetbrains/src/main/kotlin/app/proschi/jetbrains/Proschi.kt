package app.proschi.jetbrains

import com.intellij.ide.FileIconProvider
import com.intellij.ide.plugins.PluginManager
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.vfs.VirtualFile
import org.jetbrains.plugins.textmate.api.TextMateBundleProvider
import org.jetbrains.plugins.textmate.api.TextMateBundleProvider.PluginBundle
import java.nio.file.Files
import javax.swing.Icon

const val PLUGIN_ID = "app.proschi"

object ProschiFiles {
    const val EXTENSION = "proschi"

    fun isProschi(file: VirtualFile?): Boolean =
        file != null && !file.isDirectory && file.extension.equals(EXTENSION, ignoreCase = true)
}

object ProschiIcons {
    /** The site's logo (frontend/public/favicon.svg), redrawn for 16 px; `proschi_dark.svg` is picked up for dark themes. */
    @JvmField
    val FILE: Icon = IconLoader.getIcon("/icons/proschi.svg", ProschiIcons::class.java)
}

/**
 * `.proschi` files belong to the TextMate file type (see [ProschiTextMateBundleProvider]),
 * which has a generic icon; this gives them the Proschi logo in the project view, tabs and Go to File.
 */
class ProschiFileIconProvider : FileIconProvider {
    override fun getIcon(file: VirtualFile, flags: Int, project: Project?): Icon? =
        if (ProschiFiles.isProschi(file)) ProschiIcons.FILE else null
}

/**
 * Registers the TextMate bundle built from tooling/vscode and tooling/grammar
 * (the `textMateBundle` task in build.gradle.kts). It maps `*.proschi` to the
 * `source.proschi` grammar and brings the language configuration: brackets,
 * auto-closing pairs and `#` line comments.
 */
class ProschiTextMateBundleProvider : TextMateBundleProvider {
    override fun getBundles(): List<PluginBundle> {
        val dir = PluginManager.getInstance().findEnabledPlugin(PluginId.getId(PLUGIN_ID))?.pluginPath?.resolve("textmate/proschi")
            ?: return emptyList()
        return if (Files.isDirectory(dir)) listOf(PluginBundle("Proschi", dir)) else emptyList()
    }
}
