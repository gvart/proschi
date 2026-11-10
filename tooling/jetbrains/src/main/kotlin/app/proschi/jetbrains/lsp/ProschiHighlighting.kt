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
    @JvmField val TAG: TextAttributesKey = createTextAttributesKey("PROSCHI_TAG", DefaultLanguageHighlighterColors.CONSTANT)
    @JvmField val CONSTANT: TextAttributesKey = createTextAttributesKey("PROSCHI_CONSTANT", DefaultLanguageHighlighterColors.PARAMETER)
}

/**
 * The server's token types (TOKEN_TYPE in tooling/src/server.ts): `variable` node ids, `type` tech stacks and
 * component types (the name and parent of a `type` header too), `decorator` teams, `enumMember` legend tags,
 * `parameter` constants (`${'$'}peak`, `let peak = …`).
 */
class ProschiSemanticTokensSupport : LspSemanticTokensSupport() {
    override fun getTextAttributesKey(tokenType: String, modifiers: List<String>): TextAttributesKey? =
        when (tokenType) {
            "variable" -> ProschiColors.NODE
            "type" -> ProschiColors.TECH
            "decorator" -> ProschiColors.TEAM
            "enumMember" -> ProschiColors.TAG
            "parameter" -> ProschiColors.CONSTANT
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
        legend {
          <tag>owned</tag> "Owned by us" green
        }
        let <const>peak</const> = 2k rps

        abstract type <tech>Ledger</tech> extends <tech>[PostgreSQL]</tech> {
          op write APPEND latency 2
        }
        type <tech>LedgerDb</tech> extends <tech>Ledger</tech> { op read BALANCE }

        <node>web</node> "Shop"      <tech>[Browser]</tech>
        <node>api</node> "Order API" <tech>[REST API]</tech> <team>@orders</team> <tag>.owned</tag>
        <node>db</node>  "Orders DB" <tech>[LedgerDb]</tech> <team>@orders</team>

        <node>web</node> -> <node>api</node> : HTTPS
        <node>api</node> -> <node>db</node> <tag>.owned</tag> : SQL

        usecase "Pay" {
          <node>web</node>  -> <node>api</node> : POST /charges header Idempotency-Key
          <node>api</node>  -> <node>db</node>  : APPEND entry
          <node>api</node> --> <node>web</node> : 201
        }

        traffic {
          "Pay" ${'$'}<const>peak</const>
        }

        test "Every payment appends once" {
          "Pay" calls <node>api</node> with POST /charges
          "Pay" sends header Idempotency-Key to <node>api</node>
          "Pay" uses APPEND on <node>db</node>
        }
        """.trimIndent()

    override fun getAdditionalHighlightingTagToDescriptorMap(): Map<String, TextAttributesKey> =
        mapOf(
            "node" to ProschiColors.NODE,
            "tech" to ProschiColors.TECH,
            "team" to ProschiColors.TEAM,
            "tag" to ProschiColors.TAG,
            "const" to ProschiColors.CONSTANT,
        )

    override fun getAttributeDescriptors(): Array<AttributesDescriptor> =
        arrayOf(
            AttributesDescriptor("Node id", ProschiColors.NODE),
            AttributesDescriptor("Tech stack or component type", ProschiColors.TECH),
            AttributesDescriptor("Team", ProschiColors.TEAM),
            AttributesDescriptor("Legend tag", ProschiColors.TAG),
            AttributesDescriptor("Constant", ProschiColors.CONSTANT),
        )

    override fun getColorDescriptors(): Array<ColorDescriptor> = ColorDescriptor.EMPTY_ARRAY
}
