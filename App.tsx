import './global.css';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StatusBar,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  generateChatReply,
  loadLocalLlm,
  type ChatMessage,
} from './src/services/llm';

type Message = ChatMessage & {
  id: string;
};

function App() {
  const isDarkMode = useColorScheme() === 'dark';
  const listRef = useRef<FlatList<Message>>(null);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'Welcome to Pal. Qwen runs locally from the app bundle.',
    },
  ]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('Starting local model...');
  const [isReady, setIsReady] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  const loadModel = useCallback(() => {
    setIsBusy(true);
    setStatus('Preparing bundled Qwen model...');

    loadLocalLlm(progress => {
      setStatus(`Loading model ${Math.round(progress * 100)}%`);
      })
      .then(() => {
        setIsReady(true);
        setStatus('Ready');
      })
      .catch(error => {
        setStatus(error instanceof Error ? error.message : 'Model load failed.');
      })
      .finally(() => {
        setIsBusy(false);
      });
  }, []);

  useEffect(() => {
    loadModel();
  }, [loadModel]);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isBusy || !isReady) {
      return;
    }

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };
    const assistantId = `assistant-${Date.now()}`;
    const assistantMessage: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
    };

    setInput('');
    setIsBusy(true);
    setStatus('Generating response...');
    setMessages(current => [...current, userMessage, assistantMessage]);

    try {
      const conversation = [...messages, userMessage]
        .filter(message => message.id !== 'welcome')
        .map(({ role, content }) => ({ role, content }));

      let streamedText = '';
      const finalText = await generateChatReply(conversation, token => {
        streamedText += token;
        setMessages(current =>
          current.map(message =>
            message.id === assistantId
              ? { ...message, content: streamedText }
              : message,
          ),
        );
      });

      setMessages(current =>
        current.map(message =>
          message.id === assistantId
            ? { ...message, content: finalText || streamedText.trim() }
            : message,
        ),
      );
      setIsReady(true);
      setStatus('Ready');
    } catch (error) {
      setMessages(current =>
        current.map(message =>
          message.id === assistantId
            ? {
                ...message,
                content:
                  error instanceof Error
                    ? error.message
                    : 'Something went wrong.',
              }
            : message,
        ),
      );
      setStatus('Error');
    } finally {
      setIsBusy(false);
    }
  }, [input, isBusy, isReady, messages]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 bg-slate-950">
        <View className="border-b border-slate-800 px-4 pb-3 pt-5">
          <Text className="text-2xl font-bold text-white">Pal</Text>
          <Text className="mt-1 text-sm text-slate-300">{status}</Text>
        </View>

        <FlatList
          ref={listRef}
          className="flex-1"
          contentContainerClassName="gap-3 px-4 py-4"
          data={messages}
          keyExtractor={item => item.id}
          onContentSizeChange={() => listRef.current?.scrollToEnd()}
          renderItem={({ item }) => (
            <View
              className={`max-w-[86%] rounded-lg px-4 py-3 ${
                item.role === 'user'
                  ? 'self-end bg-red-500'
                  : 'self-start bg-slate-800'
              }`}>
              <Text
                className={
                  item.role === 'user' ? 'text-white' : 'text-slate-100'
                }>
                {item.content || '...'}
              </Text>
            </View>
          )}
        />

        <View className="flex-row items-end gap-2 border-t border-slate-800 p-4">
          <TextInput
            className="max-h-28 flex-1 rounded-md bg-slate-900 px-3 py-3 text-base text-white"
            editable={!isBusy && isReady}
            multiline
            onChangeText={setInput}
            placeholder={isReady ? 'Ask Qwen locally...' : 'Starting Qwen...'}
            placeholderTextColor="#94a3b8"
            value={input}
          />
          <Pressable
            className={`rounded-md px-4 py-3 ${
              input.trim() && !isBusy && isReady ? 'bg-red-500' : 'bg-slate-700'
            }`}
            disabled={!input.trim() || isBusy || !isReady}
            onPress={sendMessage}>
            <Text className="font-semibold text-white">Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaProvider>
  );
}

export default App;
