package com.pal.stt

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.k2fsa.sherpa.onnx.EndpointConfig
import com.k2fsa.sherpa.onnx.EndpointRule
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineRecognizer
import com.k2fsa.sherpa.onnx.OnlineRecognizerConfig
import com.k2fsa.sherpa.onnx.OnlineStream
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class SherpaSttModule(
    reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val isRecording = AtomicBoolean(false)

    private var recognizer: OnlineRecognizer? = null
    private var stream: OnlineStream? = null
    private var audioRecord: AudioRecord? = null
    private var lastPartialText = ""
    private var lastFinalText = ""
    private var listenerCount = 0

    override fun getName() = MODULE_NAME

    @ReactMethod
    fun start(promise: Promise) {
        if (ContextCompat.checkSelfPermission(
                reactApplicationContext,
                Manifest.permission.RECORD_AUDIO,
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            promise.reject("permission_denied", "Microphone permission is required.")
            return
        }

        if (!isRecording.compareAndSet(false, true)) {
            promise.reject("already_recording", "Speech recognition is already running.")
            return
        }

        try {
            val recognizer = ensureRecognizer()
            stream?.release()
            stream = recognizer.createStream()
            lastPartialText = ""
            lastFinalText = ""

            val minBufferSize = AudioRecord.getMinBufferSize(
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
            )
            if (minBufferSize <= 0) {
                throw IllegalStateException("Unable to determine audio buffer size.")
            }

            audioRecord = AudioRecord.Builder()
                .setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(SAMPLE_RATE)
                        .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
                        .build(),
                )
                .setBufferSizeInBytes(minBufferSize * 2)
                .build()

            val recorder = audioRecord ?: throw IllegalStateException("AudioRecord creation failed.")
            if (recorder.state != AudioRecord.STATE_INITIALIZED) {
                throw IllegalStateException("AudioRecord failed to initialize.")
            }

            recorder.startRecording()
            emitState("listening")

            executor.execute {
                val shortBuffer = ShortArray(maxOf(minBufferSize / 2, SAMPLE_RATE / 10))
                try {
                    captureLoop(shortBuffer)
                } catch (error: Throwable) {
                    emitError(error.message ?: "Speech recognition failed.")
                } finally {
                    finishCapture()
                }
            }

            promise.resolve(null)
        } catch (error: Throwable) {
            isRecording.set(false)
            cleanupAudioRecord()
            stream?.release()
            stream = null
            promise.reject("start_failed", error.message, error)
        }
    }

    @ReactMethod
    fun stop(promise: Promise) {
        if (!isRecording.compareAndSet(true, false)) {
            promise.resolve(null)
            return
        }

        cleanupAudioRecord()
        promise.resolve(null)
    }

    @ReactMethod
    fun addListener(eventName: String) {
        listenerCount += 1
    }

    @ReactMethod
    fun removeListeners(count: Double) {
        listenerCount = (listenerCount - count.toInt()).coerceAtLeast(0)
    }

    override fun invalidate() {
        isRecording.set(false)
        cleanupAudioRecord()
        stream?.release()
        stream = null
        recognizer?.release()
        recognizer = null
        executor.shutdownNow()
        super.invalidate()
    }

    private fun captureLoop(shortBuffer: ShortArray) {
        val activeRecognizer = recognizer ?: throw IllegalStateException("Recognizer is not ready.")
        val activeStream = stream ?: throw IllegalStateException("Recognizer stream is not ready.")
        val recorder = audioRecord ?: throw IllegalStateException("Audio recorder is not ready.")

        while (isRecording.get()) {
            val read = recorder.read(shortBuffer, 0, shortBuffer.size, AudioRecord.READ_BLOCKING)
            if (read <= 0) {
                continue
            }

            activeStream.acceptWaveform(
                FloatArray(read) { index -> shortBuffer[index] / 32768.0f },
                SAMPLE_RATE,
            )
            decodeAvailable(activeRecognizer, activeStream)
        }
    }

    private fun decodeAvailable(recognizer: OnlineRecognizer, stream: OnlineStream) {
        while (recognizer.isReady(stream)) {
            recognizer.decode(stream)
        }

        val text = recognizer.getResult(stream).text.trim()
        if (text.isNotEmpty() && text != lastPartialText) {
            lastPartialText = text
            emitTranscript(EVENT_PARTIAL, text)
        }

        if (recognizer.isEndpoint(stream)) {
            emitFinalIfNeeded(text)
            recognizer.reset(stream)
            lastPartialText = ""
        }
    }

    private fun finishCapture() {
        val activeRecognizer = recognizer
        val activeStream = stream

        try {
            if (activeRecognizer != null && activeStream != null) {
                activeStream.inputFinished()
                while (activeRecognizer.isReady(activeStream)) {
                    activeRecognizer.decode(activeStream)
                }
                emitFinalIfNeeded(activeRecognizer.getResult(activeStream).text.trim())
                activeRecognizer.reset(activeStream)
            }
        } catch (error: Throwable) {
            emitError(error.message ?: "Speech recognition stop failed.")
        } finally {
            activeStream?.release()
            stream = null
            cleanupAudioRecord()
            isRecording.set(false)
            lastPartialText = ""
            lastFinalText = ""
            emitState("idle")
        }
    }

    private fun emitFinalIfNeeded(text: String) {
        if (text.isNotEmpty() && text != lastFinalText) {
            lastFinalText = text
            emitTranscript(EVENT_FINAL, text)
        }
    }

    private fun ensureRecognizer(): OnlineRecognizer {
        recognizer?.let { return it }

        val created = OnlineRecognizer(
            reactApplicationContext.assets,
            OnlineRecognizerConfig(
                featConfig = FeatureConfig(sampleRate = SAMPLE_RATE, featureDim = 80, dither = 0.0f),
                modelConfig = OnlineModelConfig(
                    transducer = OnlineTransducerModelConfig(
                        encoder = "encoder-epoch-99-avg-1.int8.onnx",
                        decoder = "decoder-epoch-99-avg-1.onnx",
                        joiner = "joiner-epoch-99-avg-1.int8.onnx",
                    ),
                    tokens = "tokens.txt",
                    numThreads = 2,
                    provider = "cpu",
                    modelType = "zipformer",
                ),
                endpointConfig = EndpointConfig(
                    rule1 = EndpointRule(false, 2.4f, 0.0f),
                    rule2 = EndpointRule(true, 0.8f, 0.0f),
                    rule3 = EndpointRule(false, 0.0f, 18.0f),
                ),
                enableEndpoint = true,
                decodingMethod = "greedy_search",
            ),
        )
        recognizer = created
        return created
    }

    private fun cleanupAudioRecord() {
        val recorder = audioRecord ?: return
        audioRecord = null
        try {
            if (recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                recorder.stop()
            }
        } catch (_: Throwable) {
        } finally {
            recorder.release()
        }
    }

    private fun emitTranscript(eventName: String, text: String) {
        val payload = Arguments.createMap().apply {
            putString("text", text)
        }
        emitEvent(eventName, payload)
    }

    private fun emitState(state: String) {
        val payload = Arguments.createMap().apply {
            putString("state", state)
        }
        emitEvent(EVENT_STATE, payload)
    }

    private fun emitError(message: String) {
        val payload = Arguments.createMap().apply {
            putString("message", message)
        }
        emitEvent(EVENT_ERROR, payload)
    }

    private fun emitEvent(eventName: String, payload: Any) {
        if (listenerCount <= 0) {
            return
        }

        mainHandler.post {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, payload)
        }
    }

    companion object {
        private const val MODULE_NAME = "SherpaStt"
        private const val SAMPLE_RATE = 16000
        const val EVENT_PARTIAL = "SherpaStt:partial"
        const val EVENT_FINAL = "SherpaStt:final"
        const val EVENT_ERROR = "SherpaStt:error"
        const val EVENT_STATE = "SherpaStt:state"
    }
}
