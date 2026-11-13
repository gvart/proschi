package app.proschi.jetbrains.preview

import app.proschi.jetbrains.ProschiFiles
import app.proschi.jetbrains.actions.notifyNoJcef
import app.proschi.jetbrains.cli.ProschiCli
import app.proschi.jetbrains.cli.ProschiCommands
import app.proschi.jetbrains.settings.ProschiSettings
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.components.serviceIfCreated
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorManagerEvent
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.util.text.StringUtil
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.vfs.newvfs.BulkFileListener
import com.intellij.openapi.vfs.newvfs.events.VFileContentChangeEvent
import com.intellij.openapi.vfs.newvfs.events.VFileEvent
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.openapi.wm.ex.ToolWindowManagerListener
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.ui.content.ContentFactory
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.Color
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.util.Base64
import javax.swing.JComponent
import javax.swing.SwingConstants

/**
 * The Proschi Preview tool window: `proschi render --format preview-html` (one
 * self-contained page with the architecture, a scenario picker and each use case's
 * description, as the VS Code preview shows them) shown in JCEF, restyled to fit the
 * panel. It draws in the theme of the settings, which a `"theme"` in the nearest
 * proschi.json overrides. It re-renders when the previewed file or a proschi.json is
 * saved, or the settings change, and follows the selected `.proschi` editor while the
 * tool window is open. A CLI without `preview-html` gets the `html` page instead.
 *
 * Deliberately small: the VS Code extension renders in-process as you type; doing that
 * here would mean bundling the renderer (see README.md, "Possible next steps").
 */
@Service(Service.Level.PROJECT)
class ProschiPreview {
    internal var panel: ProschiPreviewPanel? = null

    companion object {
        const val TOOL_WINDOW_ID = "Proschi Preview"

        fun show(project: Project, file: VirtualFile) {
            if (!JBCefApp.isSupported()) return notifyNoJcef(project)
            val toolWindow = ToolWindowManager.getInstance(project).getToolWindow(TOOL_WINDOW_ID) ?: return
            toolWindow.activate { project.service<ProschiPreview>().panel?.render(file) }
        }

        /** Redraws the preview of every open project, after the settings changed. */
        fun refreshAll() {
            ProjectManager.getInstance().openProjects.forEach { it.serviceIfCreated<ProschiPreview>()?.panel?.refresh() }
        }
    }
}

class ProschiPreviewToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = ProschiPreviewPanel(project, toolWindow)
        val content = ContentFactory.getInstance().createContent(panel.component, "", false)
        content.setDisposer(panel)
        toolWindow.contentManager.addContent(content)
        project.service<ProschiPreview>().panel = panel
    }
}

class ProschiPreviewPanel(private val project: Project, private val toolWindow: ToolWindow) : Disposable {
    private val browser: JBCefBrowser? = if (JBCefApp.isSupported()) JBCefBrowser() else null
    val component: JComponent = browser?.component
        ?: JBLabel("The preview needs JCEF (the embedded browser). Use Tools | Proschi | Open in Proschi.", SwingConstants.CENTER)

    private var file: VirtualFile? = null
    private var rendering = false
    private var pending = false
    private var disposed = false

    init {
        browser?.let { Disposer.register(this, it) }
        val bus = project.messageBus.connect(this)
        bus.subscribe(VirtualFileManager.VFS_CHANGES, object : BulkFileListener {
            override fun after(events: List<VFileEvent>) {
                val current = file ?: return
                // The file itself, or a proschi.json, whose "theme" may have changed.
                if (events.any { (it is VFileContentChangeEvent && it.file == current) || it.path.endsWith("/proschi.json") }) {
                    // VFS events arrive inside a write action; start the render after it.
                    ApplicationManager.getApplication().invokeLater({ render(current) }, project.disposed)
                }
            }
        })
        bus.subscribe(FileEditorManagerListener.FILE_EDITOR_MANAGER, object : FileEditorManagerListener {
            override fun selectionChanged(event: FileEditorManagerEvent) {
                val selected = event.newFile ?: return
                if (ProschiFiles.isProschi(selected) && selected != file && toolWindow.isVisible) render(selected)
            }
        })
        // Opened from the tool window stripe rather than the action: preview the file being edited.
        bus.subscribe(ToolWindowManagerListener.TOPIC, object : ToolWindowManagerListener {
            override fun toolWindowShown(shown: ToolWindow) {
                if (shown.id == ProschiPreview.TOOL_WINDOW_ID) selectedFile()?.takeIf { it != file }?.let { render(it) }
            }
        })
        selectedFile()?.let { render(it) } ?: message("Open a .proschi file to preview it.")
    }

    private fun selectedFile(): VirtualFile? =
        FileEditorManager.getInstance(project).selectedFiles.firstOrNull { ProschiFiles.isProschi(it) }

    /** Renders the previewed file again, if there is one. */
    fun refresh() {
        file?.let { render(it) }
    }

    /** Renders [target]; a request while a render runs is queued, and only the latest one is kept. */
    fun render(target: VirtualFile) {
        file = target
        if (browser == null) return
        if (rendering) {
            pending = true
            return
        }
        rendering = true
        renderWith(target, legacy = false)
    }

    /** One `proschi render`; with [legacy], the `html` page, for a CLI that refused `preview-html`. */
    private fun renderWith(target: VirtualFile, legacy: Boolean) {
        val browser = browser ?: return
        val out: Path = Files.createTempDirectory("proschi-preview")
        val theme = ProschiSettings.options.previewTheme.takeIf { it in ProschiSettings.PREVIEW_THEMES } ?: ProschiSettings.PREVIEW_THEMES.first()
        val args =
            if (legacy) ProschiCommands.legacyPreviewArgs(target.name, out.toString())
            else ProschiCommands.previewArgs(target.name, out.toString(), theme)
        var retry = false
        ProschiCli.run(
            project,
            "Proschi: render ${target.name}",
            target,
            args,
            whenFinished = {
                FileUtil.delete(out.toFile())
                if (retry && !disposed) {
                    // Still rendering: the same file again, as the html page.
                    renderWith(target, legacy = true)
                } else {
                    rendering = false
                    if (pending) {
                        pending = false
                        file?.let { render(it) }
                    }
                }
            },
        ) { output ->
            if (disposed) return@run
            if (!legacy && ProschiCommands.isOlderCli(output.exitCode, output.stderr)) {
                retry = true
                return@run
            }
            val page = output.stdout.lines().map { it.trim() }.lastOrNull { it.endsWith(".html") }?.let { Path.of(it) }
            if (output.exitCode == 0 && page != null && Files.isRegularFile(page)) {
                browser.loadHTML(fitToPanel(Files.readString(page)))
            } else {
                message("Not rendered:\n\n" + (output.stderr + output.stdout).trim())
            }
        }
    }

    /**
     * The render pages are laid out for a browser window; this restyles them for the
     * tool window: one column, diagrams scaled down to the panel's width, and the page's
     * colors from the IDE theme. The cards around the diagrams keep the render theme's
     * color (`--card`: cream in sketch, white in classic), so each diagram sits on its
     * own background. The `preview-html` page allows styles only by hash, so the
     * restyle's hash joins its Content-Security-Policy.
     */
    private fun fitToPanel(html: String): String {
        fun hex(c: Color) = "#%02x%02x%02x".format(c.red, c.green, c.blue)
        val css = """
            :root { color-scheme: ${if (JBColor.isBright()) "light" else "dark"}; --bg: ${hex(UIUtil.getPanelBackground())}; --fg: ${hex(UIUtil.getLabelForeground())}; --muted: ${hex(UIUtil.getContextHelpForeground())}; --border: ${hex(JBColor.border())}; --link: ${hex(JBUI.CurrentTheme.Link.Foreground.ENABLED)}; }
            body { font-size: 13px; }
            header { padding: 10px 12px 4px; }
            h1 { font-size: 15px; }
            main { flex-direction: column; gap: 8px; padding: 4px 12px 12px; }
            nav { position: static; flex: none; font-size: 12px; }
            h2 { font-size: 13px; }
            figure { box-shadow: none; }
            figure svg { max-width: 100%; height: auto; }
        """.trimIndent()
        return withStyle(html, css)
    }

    private fun message(text: String) {
        browser?.loadHTML(
            "<html><body style=\"font: 13px sans-serif; padding: 16px\"><pre style=\"white-space: pre-wrap\">" +
                StringUtil.escapeXmlEntities(text) + "</pre></body></html>",
        )
    }

    override fun dispose() {
        disposed = true
        val preview = project.service<ProschiPreview>()
        if (preview.panel === this) preview.panel = null
    }
}

/**
 * [html] with a `<style>` of [css] before `</head>`. A Content-Security-Policy that allows
 * styles only by hash (no `'unsafe-inline'`) gets the hash of [css] too; adding a hash
 * to one that has `'unsafe-inline'` would switch that off, so it is left alone.
 */
internal fun withStyle(html: String, css: String): String {
    val hash = Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(css.toByteArray(Charsets.UTF_8)))
    val policy = Regex("(http-equiv=\"Content-Security-Policy\" content=\"[^\"]*style-src )([^;\"]*)")
    val allowed = policy.replace(html) { m ->
        if ("'unsafe-inline'" in m.groupValues[2]) m.value else "${m.groupValues[1]}'sha256-$hash' ${m.groupValues[2]}"
    }
    return allowed.replaceFirst("</head>", "<style>$css</style>\n</head>")
}
