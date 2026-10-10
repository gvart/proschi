package app.proschi.jetbrains.cli

import app.proschi.jetbrains.settings.ProschiConfigurable
import app.proschi.jetbrains.settings.ProschiSettings
import com.intellij.execution.ExecutionException
import com.intellij.execution.process.CapturingProcessHandler
import com.intellij.execution.process.ProcessOutput
import com.intellij.notification.Notification
import com.intellij.notification.NotificationAction
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.text.StringUtil
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.testFramework.LightVirtualFile

/** Runs the `proschi` command line on a file in the background and reports back in notifications. */
object ProschiCli {
    private const val TIMEOUT_MS = 120_000 // the first npx run downloads the package
    private const val NOTIFICATION_LINES = 15

    /**
     * Runs `proschi <args>` in the file's directory, then calls [onDone] on the EDT
     * with the output, and [whenFinished] in every case. Failing to start the
     * process (no Node.js, nothing on PATH) is reported here.
     */
    fun run(
        project: Project,
        title: String,
        file: VirtualFile,
        args: List<String>,
        whenFinished: () -> Unit = {},
        onDone: (ProcessOutput) -> Unit,
    ) {
        val command = ProschiCommands.cli(ProschiSettings.options, args)
        val workDirectory = runCatching { file.parent?.toNioPath() }.getOrNull()
        object : Task.Backgroundable(project, title, true) {
            private var output: ProcessOutput? = null

            override fun run(indicator: ProgressIndicator) {
                indicator.text = command.joinToString(" ")
                output = CapturingProcessHandler(ProschiCommands.commandLine(command, workDirectory))
                    .runProcessWithProgressIndicator(indicator, TIMEOUT_MS)
            }

            override fun onSuccess() {
                val result = output ?: return
                if (result.isTimeout) notify(project, title, "Timed out: ${command.joinToString(" ")}", NotificationType.ERROR)
                else if (!result.isCancelled) onDone(result)
            }

            override fun onFinished() = whenFinished()

            override fun onThrowable(error: Throwable) {
                if (error !is ExecutionException) return super.onThrowable(error)
                notify(
                    project,
                    title,
                    "Could not run <code>${StringUtil.escapeXmlEntities(command.first())}</code>: " +
                        "${StringUtil.escapeXmlEntities(error.message.orEmpty())}<br>" +
                        "Install Node.js 18+ and <code>npm install -g proschi</code>, or set the paths in the settings.",
                    NotificationType.ERROR,
                    settingsAction(),
                )
            }
        }.queue()
    }

    /** Shows [output] in a notification: the first lines inline, everything behind "Show output". */
    fun report(project: Project, title: String, output: ProcessOutput, success: String) {
        val text = (output.stdout + output.stderr).trim()
        val type = if (output.exitCode == 0) NotificationType.INFORMATION else NotificationType.WARNING
        val lines = text.lines()
        val shown = lines.take(NOTIFICATION_LINES).joinToString("<br>") { StringUtil.escapeXmlEntities(it) }
        val more = if (lines.size > NOTIFICATION_LINES) "<br>… ${lines.size - NOTIFICATION_LINES} more line(s)" else ""
        val content = if (text.isEmpty()) success else shown + more
        notify(project, title, content, type, showOutputAction(project, title, text))
    }

    fun notify(project: Project, title: String, content: String, type: NotificationType, vararg actions: NotificationAction) {
        val notification: Notification = NotificationGroupManager.getInstance()
            .getNotificationGroup("Proschi")
            .createNotification(title, content, type)
        actions.forEach { notification.addAction(it) }
        notification.notify(project)
    }

    fun settingsAction(): NotificationAction = NotificationAction.createSimple("Open settings") {
        ShowSettingsUtil.getInstance().showSettingsDialog(null, ProschiConfigurable::class.java)
    }

    private fun showOutputAction(project: Project, title: String, text: String): NotificationAction =
        NotificationAction.createSimple("Show output") {
            FileEditorManager.getInstance(project).openFile(LightVirtualFile("$title.txt", text), true)
        }
}
