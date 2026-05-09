import * as RNFS from 'react-native-fs';
import {
  initLlama,
  type LlamaContext,
  type RNLlamaOAICompatibleMessage,
} from 'llama.rn';

const MODEL_FILE = 'qwen2.5-0.5b-instruct-q4_0.gguf';
const MODEL_ASSET_PATH = `models/${MODEL_FILE}`;
const MODEL_DIR = `${RNFS.DocumentDirectoryPath}/models`;
const MODEL_PATH = `${MODEL_DIR}/${MODEL_FILE}`;
const STOP_WORDS = [
  '</s>',
  '<|end|>',
  '<|eot_id|>',
  '<|end_of_text|>',
  '<|im_end|>',
  '<|EOT|>',
  '<|END_OF_TURN_TOKEN|>',
  '<|end_of_turn|>',
  '<|endoftext|>',
];

let context: LlamaContext | null = null;
let loadingContext: Promise<LlamaContext> | null = null;

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export const getModelPath = () => MODEL_PATH;

const ensureModelDir = async () => {
  if (!(await RNFS.exists(MODEL_DIR))) {
    await RNFS.mkdir(MODEL_DIR);
  }
};

export const hasLocalModel = () => RNFS.exists(MODEL_PATH);

export const ensureLocalModel = async () => {
  await ensureModelDir();

  if (await RNFS.exists(MODEL_PATH)) {
    return `file://${MODEL_PATH}`;
  }

  try {
    await RNFS.copyFileAssets(MODEL_ASSET_PATH, MODEL_PATH);
  } catch (error) {
    await RNFS.unlink(MODEL_PATH).catch(() => undefined);
    throw error;
  }

  return `file://${MODEL_PATH}`;
};

export const loadLocalLlm = async (
  onLoadProgress?: (progress: number) => void,
) => {
  if (context) {
    return context;
  }

  if (loadingContext) {
    return loadingContext;
  }

  loadingContext = (async () => {
    const model = await ensureLocalModel();
    const loadedContext = await initLlama(
      {
        model,
        n_ctx: 1024,
        n_gpu_layers: 0,
        use_mlock: false,
      },
      onLoadProgress,
    );

    context = loadedContext;
    loadingContext = null;
    return loadedContext;
  })().catch(error => {
    loadingContext = null;
    throw error;
  });

  return loadingContext;
};

export const generateChatReply = async (
  messages: ChatMessage[],
  onToken?: (token: string) => void,
) => {
  const llm = await loadLocalLlm();
  const completionMessages: RNLlamaOAICompatibleMessage[] = [
    {
      role: 'system',
      content:
        'You are Qwen, created by Alibaba Cloud. You are a concise, helpful mobile assistant.',
    },
    ...messages.map(message => ({
      role: message.role,
      content: message.content,
    })),
  ];

  const result = await llm.completion(
    {
      messages: completionMessages,
      n_predict: 160,
      temperature: 0.7,
      top_p: 0.9,
      stop: STOP_WORDS,
    },
    data => {
      if (data.token) {
        onToken?.(data.token);
      }
    },
  );

  return result.text.trim();
};

export const releaseLocalLlm = async () => {
  const loadedContext = context;
  context = null;
  loadingContext = null;
  await loadedContext?.release();
};
