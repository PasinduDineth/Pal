/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('../src/services/llm', () => ({
  generateChatReply: jest.fn(),
  loadLocalLlm: jest.fn(() => new Promise(() => undefined)),
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
}));

test('renders correctly', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;

  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });

  ReactTestRenderer.act(() => {
    renderer.unmount();
  });
});
