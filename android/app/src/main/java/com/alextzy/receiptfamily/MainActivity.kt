package com.alextzy.receiptfamily

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import java.io.File

/**
 * Minimal WebView shell. The web app (../web) is bundled in assets/www and served from the
 * virtual https origin https://appassets.androidplatform.net so fetch() and localStorage work.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var cameraFile: File? = null
    private var cameraUri: Uri? = null

    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        clearPhotoCache()

        web = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.TRANSPARENT)
        }
        setContentView(web)

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = userAgentString + " ReceiptFamilyApp/2.0"
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView, request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                // Only our own bundled pages load inside the app; anything else is dropped.
                return request.url.host != WebViewAssetLoader.DEFAULT_DOMAIN
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean = true

            override fun onShowFileChooser(
                webView: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                return try {
                    startActivityForResult(buildChooser(params), REQ_CHOOSER)
                    true
                } catch (e: Exception) {
                    filePathCallback = null
                    callback.onReceiveValue(null)
                    Toast.makeText(this@MainActivity, "Cannot open camera or files", Toast.LENGTH_LONG).show()
                    false
                }
            }
        }

        if (savedInstanceState == null) {
            web.loadUrl("https://${WebViewAssetLoader.DEFAULT_DOMAIN}/assets/www/index.html")
        } else {
            web.restoreState(savedInstanceState)
        }
    }

    /**
     * Camera (via FileProvider) and/or files. When the page asks for capture (the "Snap receipt" button) the camera
     * opens directly; otherwise one chooser offers the camera plus photos AND PDFs, several at once when the page allows it.
     */
    private fun buildChooser(params: WebChromeClient.FileChooserParams): Intent {
        val dir = File(cacheDir, "photos").apply { mkdirs() }
        val file = File.createTempFile("receipt_", ".jpg", dir)
        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
        cameraFile = file
        cameraUri = uri

        val camera = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            clipData = ClipData.newRawUri("receipt", uri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        if (params.isCaptureEnabled) return camera

        val multiple = params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE
        val files = Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/*", "application/pdf"))
            if (multiple) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        return Intent.createChooser(files, "Receipt photo or PDF").apply {
            putExtra(Intent.EXTRA_INITIAL_INTENTS, arrayOf(camera))
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQ_CHOOSER) {
            super.onActivityResult(requestCode, resultCode, data)
            return
        }
        val cb = filePathCallback
        filePathCallback = null
        var result: Array<Uri>? = null
        if (resultCode == RESULT_OK) {
            val uris = ArrayList<Uri>()
            val clip = data?.clipData
            if (clip != null) {
                for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let { uris.add(it) }
            }
            if (uris.isEmpty()) data?.data?.let { uris.add(it) }
            val file = cameraFile
            val cam = cameraUri
            if (uris.isEmpty() && file != null && file.length() > 0 && cam != null) uris.add(cam)
            if (uris.isNotEmpty()) result = uris.toTypedArray()
        }
        val usedCamera = cameraUri?.let { cu -> result?.any { it == cu } } == true
        if (!usedCamera) cameraFile?.delete()
        cb?.onReceiveValue(result)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (::web.isInitialized && web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onPause() { web.onPause(); super.onPause() }
    override fun onResume() { super.onResume(); web.onResume() }

    override fun onDestroy() {
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        web.destroy()
        super.onDestroy()
    }

    private fun clearPhotoCache() {
        File(cacheDir, "photos").listFiles()?.forEach { it.delete() }
    }

    companion object {
        private const val REQ_CHOOSER = 1001
    }
}
