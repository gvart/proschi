package app.proschi.jetbrains.settings

import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.service

/**
 * Application-wide settings (Settings | Languages & Frameworks | Proschi),
 * stored in `proschi.xml` in the IDE's config directory. Empty paths mean
 * "find it on PATH, else run it through npx" (see [app.proschi.jetbrains.cli.ProschiCommands]).
 */
@Service(Service.Level.APP)
@State(name = "ProschiSettings", storages = [Storage("proschi.xml")])
class ProschiSettings : PersistentStateComponent<ProschiSettings.Options> {
    data class Options(
        var languageServerEnabled: Boolean = true,
        /** `proschi-language-server` (or `server.cjs`, run with Node.js). */
        var serverPath: String = "",
        /** `proschi` (or `cli.cjs`, run with Node.js), for the actions and the preview. */
        var cliPath: String = "",
        /** `node`; its directory is also put first on PATH for `npx`. */
        var nodePath: String = "",
        /** The preview's theme ([PREVIEW_THEMES]); a `"theme"` in the nearest proschi.json overrides it. */
        var previewTheme: String = PREVIEW_THEMES.first(),
    )

    private var options = Options()

    override fun getState(): Options = options

    override fun loadState(state: Options) {
        options = state.copy(previewTheme = previewTheme(state.previewTheme))
    }

    companion object {
        /** The values of the preview theme setting, the default first. */
        val PREVIEW_THEMES = listOf("sketch-light", "sketch-dark", "classic")

        /** Older names still accepted: `sketch` was the only sketch theme before `sketch-dark`. */
        val PREVIEW_THEME_ALIASES = mapOf("sketch" to "sketch-light")

        /** The preview theme called [name] or its alias; the default for an unknown one. */
        fun previewTheme(name: String?): String {
            val theme = PREVIEW_THEME_ALIASES[name] ?: name
            return theme.takeIf { it in PREVIEW_THEMES } ?: PREVIEW_THEMES.first()
        }

        @JvmStatic
        fun getInstance(): ProschiSettings = service()

        val options: Options get() = getInstance().state
    }
}
