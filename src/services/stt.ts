import {
  NativeEventEmitter,
  NativeModules,
  PermissionsAndroid,
  Platform,
  type EmitterSubscription,
} from 'react-native';

type SherpaSttNativeModule = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

type TranscriptListener = {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (message: string) => void;
  onState?: (state: string) => void;
};

const SherpaStt = NativeModules.SherpaStt as SherpaSttNativeModule | undefined;
const sttEmitter = SherpaStt ? new NativeEventEmitter(NativeModules.SherpaStt) : null;

const PARTIAL_EVENT = 'SherpaStt:partial';
const FINAL_EVENT = 'SherpaStt:final';
const ERROR_EVENT = 'SherpaStt:error';
const STATE_EVENT = 'SherpaStt:state';

export const isSpeechToTextSupported = Platform.OS === 'android' && !!SherpaStt;

export async function requestSpeechPermission() {
  if (Platform.OS !== 'android') {
    return false;
  }

  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: 'Microphone access',
      message: 'Pal uses the microphone for local speech-to-text.',
      buttonPositive: 'Allow',
      buttonNegative: 'Cancel',
    },
  );

  return result === PermissionsAndroid.RESULTS.GRANTED;
}

export async function startSpeechToText() {
  if (!SherpaStt) {
    throw new Error('Sherpa speech-to-text is only available on Android.');
  }

  await SherpaStt.start();
}

export async function stopSpeechToText() {
  if (!SherpaStt) {
    return;
  }

  await SherpaStt.stop();
}

export function subscribeToSpeechToText(
  listener: TranscriptListener,
): () => void {
  if (!sttEmitter) {
    return () => undefined;
  }

  const subscriptions: EmitterSubscription[] = [
    sttEmitter.addListener(PARTIAL_EVENT, event => {
      listener.onPartial?.(event.text);
    }),
    sttEmitter.addListener(FINAL_EVENT, event => {
      listener.onFinal?.(event.text);
    }),
    sttEmitter.addListener(ERROR_EVENT, event => {
      listener.onError?.(event.message);
    }),
    sttEmitter.addListener(STATE_EVENT, event => {
      listener.onState?.(event.state);
    }),
  ];

  return () => {
    subscriptions.forEach(subscription => subscription.remove());
  };
}
