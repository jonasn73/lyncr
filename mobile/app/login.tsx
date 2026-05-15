import { useState } from "react"
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useRouter } from "expo-router"
import { apiMutate } from "../lib/api"

export default function LoginScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit() {
    setError("")
    setLoading(true)
    try {
      await apiMutate("/api/auth/login", {
        method: "POST",
        body: { email: email.trim().toLowerCase(), password },
      })
      router.replace("/(tabs)")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: Math.max(48, insets.top + 16), paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.logo}>
            <Text style={styles.logoIcon}>📞</Text>
          </View>
          <Text style={styles.title}>Sigo</Text>
        </View>

        <Text style={styles.heading}>Welcome back</Text>
        <Text style={styles.subheading}>Log in to manage your calls</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          placeholder="you@business.com"
          placeholderTextColor="#64748b"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter your password"
          placeholderTextColor="#64748b"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Log In</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.link} onPress={() => router.replace("/signup")}>
          <Text style={styles.linkText}>Don't have an account? Sign up</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  scroll: { flexGrow: 1, padding: 24, paddingBottom: 48, maxWidth: 400, alignSelf: "center", width: "100%" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 32 },
  logo: { width: 32, height: 32, borderRadius: 8, backgroundColor: "#6366f1", alignItems: "center", justifyContent: "center" },
  logoIcon: { fontSize: 18 },
  title: { fontSize: 18, fontWeight: "700", color: "#f8fafc" },
  heading: { fontSize: 24, fontWeight: "700", color: "#f8fafc" },
  subheading: { fontSize: 14, color: "#94a3b8", marginTop: 8, marginBottom: 24 },
  label: { fontSize: 12, fontWeight: "600", color: "#94a3b8", marginBottom: 6 },
  input: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#f8fafc",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#334155",
  },
  error: { backgroundColor: "rgba(239,68,68,0.15)", padding: 12, borderRadius: 12, color: "#fca5a5", fontSize: 12, marginBottom: 16 },
  button: { backgroundColor: "#6366f1", borderRadius: 12, paddingVertical: 14, minHeight: 44, justifyContent: "center", alignItems: "center", marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { marginTop: 24, alignItems: "center", minHeight: 44, justifyContent: "center" },
  linkText: { color: "#6366f1", fontSize: 14, fontWeight: "500" },
})
