package app.proschi.jetbrains.actions

import app.proschi.jetbrains.ProschiFiles
import app.proschi.jetbrains.cli.ProschiCli
import app.proschi.jetbrains.preview.ProschiPreview
import com.intellij.ide.BrowserUtil
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.DumbAwareAction
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

private fun AnActionEvent.proschiFile(): VirtualFile? =
    getData(CommonDataKeys.VIRTUAL_FILE)?.takeIf { ProschiFiles.isProschi(it) }

/** Tools | Proschi and the editor / project view context menus; shown only for `.proschi` files. */
class ProschiActionGroup : DefaultActionGroup() {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.project != null && e.proschiFile() != null
    }
}

/** An action on the current `.proschi` file; the file is saved first, since the CLI reads it from disk. */
abstract class ProschiFileAction : DumbAwareAction() {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.project != null && e.proschiFile() != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val file = e.proschiFile() ?: return
        val documents = FileDocumentManager.getInstance()
        documents.getCachedDocument(file)?.let { documents.saveDocument(it) }
        perform(project, file)
    }

    abstract fun perform(project: Project, file: VirtualFile)
}

/** `proschi check <file>`: errors and warnings, imports followed. */
class CheckFileAction : ProschiFileAction() {
    override fun perform(project: Project, file: VirtualFile) {
        val title = "Proschi: check ${file.name}"
        ProschiCli.run(project, title, file, listOf("check", file.name)) { ProschiCli.report(project, title, it, "No problems") }
    }
}

/** `proschi test <file>`: the file's requirements and test blocks against the simulation. */
class RunTestsAction : ProschiFileAction() {
    override fun perform(project: Project, file: VirtualFile) {
        val title = "Proschi: test ${file.name}"
        ProschiCli.run(project, title, file, listOf("test", file.name)) { ProschiCli.report(project, title, it, "All tests passed") }
    }
}

/** `proschi share-link <file>`, then opens the link: the web editor with the file and its imports (nothing is uploaded). */
class OpenInProschiAction : ProschiFileAction() {
    override fun perform(project: Project, file: VirtualFile) {
        val title = "Proschi: open ${file.name}"
        ProschiCli.run(project, title, file, listOf("share-link", file.name)) { output ->
            val link = output.stdout.trim().lines().lastOrNull()?.trim().orEmpty()
            if (output.exitCode == 0 && link.startsWith("https://")) BrowserUtil.browse(link)
            else ProschiCli.report(project, title, output, "No link")
        }
    }
}

class ShowPreviewAction : ProschiFileAction() {
    override fun perform(project: Project, file: VirtualFile) {
        ProschiPreview.show(project, file)
    }
}

internal fun notifyNoJcef(project: Project) = ProschiCli.notify(
    project,
    "Proschi preview",
    "This IDE runs without JCEF (the embedded browser), so the preview is not available. Use Open in Proschi instead.",
    NotificationType.WARNING,
)
