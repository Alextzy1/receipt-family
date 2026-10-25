plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// One source of truth: ../web is copied into the APK assets (assets/www) at build time.
val copyWebAssets = tasks.register<Copy>("copyWebAssets") {
    from(rootProject.file("../web"))
    into(layout.buildDirectory.dir("generated/webAssets/www"))
}

// Release keystore lives OUTSIDE the repo: %USERPROFILE%\.claude\keys\receipt-family.{jks,txt}
val keyDir = File(System.getProperty("user.home"), ".claude/keys")
val keystoreFile = File(keyDir, "receipt-family.jks")
val keystorePassFile = File(keyDir, "receipt-family.txt")

android {
    namespace = "com.alextzy.receiptfamily"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.alextzy.receiptfamily"
        minSdk = 24
        targetSdk = 34
        versionCode = 2
        versionName = "2.0"
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/webAssets"))

    signingConfigs {
        if (keystoreFile.exists() && keystorePassFile.exists()) {
            create("release") {
                val pass = keystorePassFile.readText().trim()
                storeFile = keystoreFile
                storePassword = pass
                keyAlias = "receipt-family"
                keyPassword = pass
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

tasks.matching {
    (it.name.startsWith("merge") && it.name.endsWith("Assets")) || it.name.contains("lint", ignoreCase = true)
}.configureEach {
    dependsOn(copyWebAssets)
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.core:core:1.15.0")
}

// ./gradlew distApk  ->  ../dist/ReceiptFamily.apk
tasks.register<Copy>("distApk") {
    dependsOn("assembleRelease")
    from(layout.buildDirectory.file("outputs/apk/release/app-release.apk"))
    into(rootProject.file("../dist"))
    rename { "ReceiptFamily.apk" }
}
