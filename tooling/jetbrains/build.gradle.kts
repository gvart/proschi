import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import org.jetbrains.intellij.platform.gradle.tasks.PrepareSandboxTask

plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.4.20"
    id("org.jetbrains.intellij.platform") version "2.19.0"
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

kotlin {
    jvmToolchain(21)
}

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        // 2025.3+ is one IntelliJ IDEA distribution for the free and paid tiers.
        intellijIdea(providers.gradleProperty("platformVersion"))
        // Syntax highlighting comes from the TextMate grammar in tooling/grammar.
        bundledPlugin("org.jetbrains.plugins.textmate")
        pluginVerifier()
        zipSigner()
        testFramework(TestFrameworkType.Platform)
    }
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.opentest4j:opentest4j:1.3.0")
}

intellijPlatform {
    pluginConfiguration {
        id = providers.gradleProperty("pluginId")
        name = providers.gradleProperty("pluginName")
        version = providers.gradleProperty("pluginVersion")
        ideaVersion {
            sinceBuild = providers.gradleProperty("pluginSinceBuild")
            untilBuild = provider { null }
        }
    }

    // All four come from the environment (CI secrets); nothing is signed or
    // published when they are missing. See README.md, "Manual steps for the owner".
    signing {
        certificateChain = providers.environmentVariable("CERTIFICATE_CHAIN")
        privateKey = providers.environmentVariable("PRIVATE_KEY")
        password = providers.environmentVariable("PRIVATE_KEY_PASSWORD")
    }
    publishing {
        token = providers.environmentVariable("PUBLISH_TOKEN")
        // A version like 0.9.0-beta.1 goes to the "beta" channel, 0.9.0 to the default one.
        channels = providers.gradleProperty("pluginVersion").map {
            listOf(it.substringAfter('-', "").substringBefore('.').ifEmpty { "default" })
        }
    }

    pluginVerification {
        ides {
            recommended()
        }
    }
}

// The TextMate bundle is the VS Code extension's manifest, language configuration
// and grammar, unchanged: one source of truth for every editor. It ships as plain
// files next to the plugin's jars because TextMate reads bundles from disk.
val textMateBundle = tasks.register<Sync>("textMateBundle") {
    from("../vscode/package.json", "../vscode/language-configuration.json")
    from("../grammar/proschi.tmLanguage.json") { into("syntaxes") }
    into(layout.buildDirectory.dir("textmate/proschi"))
}

tasks {
    withType<PrepareSandboxTask>().configureEach {
        from(textMateBundle) { into(pluginName.map { "$it/textmate/proschi" }) }
    }

    wrapper {
        gradleVersion = "9.8.0"
    }
}
