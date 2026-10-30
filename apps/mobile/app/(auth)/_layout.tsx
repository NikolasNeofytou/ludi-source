import { TOKENS } from '@ludi/ui';
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: TOKENS.bg },
      }}
    />
  );
}
