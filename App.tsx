import './global.css';

import { StatusBar, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <View className="flex-1 items-center justify-center bg-white">
        <Text className="text-3xl font-bold text-red-500">Welcome to Pal</Text>
      </View>
    </SafeAreaProvider>
  );
}

export default App;
