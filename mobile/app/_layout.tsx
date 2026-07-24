import { Stack, type ErrorBoundaryProps } from "expo-router"
import { View, Text, TouchableOpacity, StyleSheet } from "react-native"
import { SafeAreaProvider } from "react-native-safe-area-context"
import { StripeTerminalProvider } from "@stripe/stripe-terminal-react-native"
import { fetchTerminalConnectionToken } from "@/lib/terminalToken"
import { TerminalBootstrap } from "@/components/TerminalBootstrap"

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={errorStyles.container}>
      <Text style={errorStyles.title}>Something went wrong</Text>
      <Text style={errorStyles.message}>{error?.message ?? "An unexpected error occurred."}</Text>
      <TouchableOpacity style={errorStyles.button} onPress={() => retry()}>
        <Text style={errorStyles.buttonText}>Try again</Text>
      </TouchableOpacity>
    </View>
  )
}

const errorStyles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0f172a", padding: 24 },
  title: { fontSize: 18, fontWeight: "700", color: "#f8fafc", marginBottom: 8 },
  message: { fontSize: 14, color: "#94a3b8", textAlign: "center", marginBottom: 24 },
  button: { backgroundColor: "#6366f1", paddingHorizontal: 24, paddingVertical: 12, minHeight: 44, justifyContent: "center", borderRadius: 12 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
})

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      {/* Stripe Terminal must wrap any screen that uses useStripeTerminal (Collect). */}
      <StripeTerminalProvider logLevel="verbose" tokenProvider={fetchTerminalConnectionToken}>
        <TerminalBootstrap>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="login" />
            <Stack.Screen name="signup" />
            <Stack.Screen name="onboarding" />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
        </TerminalBootstrap>
      </StripeTerminalProvider>
    </SafeAreaProvider>
  )
}
