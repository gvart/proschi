package app.proschi.jetbrains.preview

import app.proschi.jetbrains.ProschiFiles
import app.proschi.jetbrains.actions.notifyNoJcef
import app.proschi.jetbrains.cli.ProschiCli
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorManagerEvent
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
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
import javax.swing.JComponent
import javax.swing.SwingConstants

/**
 * The Proschi Preview tool window: `proschi render --format html` (one self-contained
 * page with the architecture and every scenario as SVG) shown in JCEF, restyled to fit the panel. It re-renders
 * when the previewed file is saved and follows the selected `.proschi` editor while
 * the tool window is open.
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
                if (events.any { it is VFileContentChangeEvent && it.file == current }) {
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

    /** Renders [target]; a request while a render runs is queued, and only the latest one is kept. */
    fun render(target: VirtualFile) {
        file = target
        val browser = browser ?: return
        if (rendering) {
            pending = true
            return
        }
        rendering = true
        val out: Path = Files.createTempDirectory("proschi-preview")
        val args = listOf("render", "--format", "html", "--out", out.toString(), target.name)
        ProschiCli.run(
            project,
            "Proschi: render ${target.name}",
            target,
            args,
            whenFinished = {
                FileUtil.delete(out.toFile())
                rendering = false
                if (pending) {
                    pending = false
                    file?.let { render(it) }
                }
            },
        ) { output ->
            if (disposed) return@run
            val page = output.stdout.lines().map { it.trim() }.lastOrNull { it.endsWith(".html") }?.let { Path.of(it) }
            if (output.exitCode == 0 && page != null && Files.isRegularFile(page)) {
                browser.loadHTML(fitToPanel(Files.readString(page)))
            } else {
                message("Not rendered:\n\n" + (output.stderr + output.stdout).trim())
            }
        }
    }

    /**
     * `render --format html` is laid out for a browser window; this restyles it for the
     * tool window: one column, diagrams scaled down to the panel's width, and the page's
     * colors from the IDE theme (the diagrams keep their paper background).
     */
    private fun fitToPanel(html: String): String {
        fun hex(c: Color) = "#%02x%02x%02x".format(c.red, c.green, c.blue)
        val style = """
            <style>
            :root { color-scheme: ${if (JBColor.isBright()) "light" else "dark"}; --bg: ${hex(UIUtil.getPanelBackground())}; --fg: ${hex(UIUtil.getLabelForeground())}; --muted: ${hex(UIUtil.getContextHelpForeground())}; --border: ${hex(JBColor.border())}; --link: ${hex(JBUI.CurrentTheme.Link.Foreground.ENABLED)}; --card: #fff8e7; }
            body { font-size: 13px; }
            header { padding: 10px 12px 4px; }
            h1 { font-size: 15px; }
            main { flex-direction: column; gap: 8px; padding: 4px 12px 12px; }
            nav { position: static; flex: none; font-size: 12px; }
            h2 { font-size: 13px; }
            figure { box-shadow: none; }
            figure svg { max-width: 100%; height: auto; }
            </style>
        """.trimIndent()
        return html.replace("</head>", "$style\n</head>")
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
