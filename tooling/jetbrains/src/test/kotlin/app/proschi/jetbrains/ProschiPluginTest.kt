package app.proschi.jetbrains

import app.proschi.jetbrains.lsp.ProschiLspServerDescriptor
import app.proschi.jetbrains.settings.ProschiSettings
import com.intellij.openapi.extensions.ExtensionPointName
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import org.jetbrains.plugins.textmate.api.TextMateBundleProvider
import java.nio.file.Files

/** Runs inside a headless IDE with the plugin loaded from the test sandbox. */
class ProschiPluginTest : BasePlatformTestCase() {
    fun testSettingsDefaults() {
        val defaults = ProschiSettings.Options()
        assertTrue(defaults.languageServerEnabled)
        assertEquals("", defaults.serverPath)
        assertEquals("", defaults.cliPath)
        assertEquals("", defaults.nodePath)
        assertNotNull(ProschiSettings.getInstance())
    }

    fun testProschiFilesAreRecognised() {
        val diagram = myFixture.configureByText("shop.proschi", "# a comment\n").virtualFile
        val other = myFixture.configureByText("notes.txt", "").virtualFile
        assertTrue(ProschiFiles.isProschi(diagram))
        assertFalse(ProschiFiles.isProschi(other))

        assertSame(ProschiIcons.FILE, ProschiFileIconProvider().getIcon(diagram, 0, project))
        assertNull(ProschiFileIconProvider().getIcon(other, 0, project))

        val descriptor = ProschiLspServerDescriptor(project)
        assertTrue(descriptor.isSupportedFile(diagram))
        assertFalse(descriptor.isSupportedFile(other))
    }

    fun testTextMateBundleShipsWithThePlugin() {
        val provider = ExtensionPointName.create<TextMateBundleProvider>("com.intellij.textmate.bundleProvider").extensionList.filterIsInstance<ProschiTextMateBundleProvider>().single()
        val bundles = provider.getBundles()
        assertEquals(1, bundles.size)
        val dir = bundles.single().path
        assertTrue(Files.isRegularFile(dir.resolve("package.json")))
        assertTrue(Files.isRegularFile(dir.resolve("language-configuration.json")))
        assertTrue(Files.isRegularFile(dir.resolve("syntaxes/proschi.tmLanguage.json")))
    }
}
