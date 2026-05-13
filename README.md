# Pal

Pal is a React Native chat app that runs Qwen locally and supports Android push-to-talk speech-to-text with Sherpa-ONNX.

## Current features

- Local LLM chat with the bundled `qwen2.5-0.5b-instruct-q4_0.gguf` model
- Android streaming speech-to-text with Sherpa-ONNX + Zipformer
- Partial transcript updates while speaking
- Final transcript commit after silence endpoint or button release
- Press-to-talk flow that fills the chat textbox before sending to the LLM

## Android speech model

The Android STT integration uses the bundled Sherpa-ONNX streaming English Zipformer model under `android/vendor`.

## Run the app

```sh
npm start
npm run android
```

## Tests

```sh
npm test -- --runInBand
```
