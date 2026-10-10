package app.proschi.jetbrains.lsp

import app.proschi.jetbrains.ProschiIcons
import com.intellij.openapi.editor.DefaultLanguageHighlighterColors
import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.openapi.editor.colors.TextAttributesKey.createTextAttributesKey
import com.intellij.openapi.fileTypes.PlainSyntaxHighlighter
import com.intellij.openapi.fileTypes.SyntaxHighlighter
import com.intellij.openapi.options.colors.AttributesDescriptor
import com.intellij.openapi.options.colors.ColorDescriptor
import com.intellij.openapi.options.colors.ColorSettingsPage
import com.intellij.platform.lsp.api.customization.LspSemanticTokensSupport
import javax.swing.Icon

/**
 * Colors for what the TextMate grammar can't tell apart: its scopes for these map to
 * uncolored keys in most schemes, so the language server sends them as semantic tokens.
 */
object ProschiColors {
    @JvmField val NODE: TextAttributesKey = createTextAttributesKey("PROSCHI_NODE", DefaultLanguageHighlighterColors.INSTANCE_FIELD)
    @JvmField val TECH: TextAttributesKey = createTextAttributesKey("PROSCHI_TECH", DefaultLanguageHighlighterColors.METADATA)
    @JvmField val TEAM: TextAttributesKey = createTextAttributesKey("PROSCHI_TEAM", DefaultLanguageHighlighterColors.METADATA)
}

/** The server's token types (tooling/src/server.ts): `variable` node ids, `type` tech stacks, `decorator` teams. */
class ProschiSemanticTokensSupport : LspSemanticTokensSupport() {
    override fun getTextAttributesKey(tokenType: String, modifiers: List<String>): TextAttributesKey? =
        when (tokenType) {
            "variable" -> ProschiColors.NODE
            "type" -> ProschiColors.TECH
            "decorator" -> ProschiColors.TEAM
            else -> super.getTextAttributesKey(tokenType, modifiers)
        }
}

/** Settings | Editor | Color Scheme | Proschi. */
class ProschiColorSettingsPage : ColorSettingsPage {
    override fun getDisplayName(): String = "Proschi"

    override fun getIcon(): Icon = ProschiIcons.FILE

    override fun getHighlighter(): SyntaxHighlighter = PlainSyntaxHighlighter()

    override fun getDemoText(): String =
        """
        <node>api</node> "Order API" <tech>[REST API]</tech> <team>@orders</team>
        <node>db</node>  "Orders DB" <tech>[PostgreSQL]</tech> <team>@orders</team>

        <node>api</node> -> <node>db</node> : SQL
        """.trimIndent()

    override fun getAdditionalHighlightingTagToDescriptorMap(): Map<String, TextAttributesKey> =
        mapOf("node" to ProschiColors.NODE, "tech" to ProschiColors.TECH, "team" to ProschiColors.TEAM)

    override fun getAttributeDescriptors(): Array<AttributesDescriptor> =
        arrayOf(
            AttributesDescriptor("Node id", ProschiColors.NODE),
            AttributesDescriptor("Tech stack", ProschiColors.TECH),
            AttributesDescriptor("Team", ProschiColors.TEAM),
        )

    override fun getColorDescriptors(): Array<ColorDescriptor> = ColorDescriptor.EMPTY_ARRAY
}
