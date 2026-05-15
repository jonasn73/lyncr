import { useState } from "react"
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useRouter } from "expo-router"
import { apiMutate } from "../lib/api"

export default function OnboardingScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [step, setStep] = useState(1)
  const [aiEnabled, setAiEnabled] = useState(true)
  const [aiGreeting, setAiGreeting] = useState(
    "Thank you for calling. Our team is currently unavailable. I can take a message, provide our business hours, or help direct your call. How can I help you?"
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleLaunch() {
    setError("")
    setLoading(true)
    try {
      await apiMutate("/api/routing", {
        method: "PUT",
        body: {
          fallback_type: aiEnabled ? "ai" : "owner",
          ai_greeting: aiEnabled ? aiGreeting : undefined,
        },
      })
      router.replace("/(tabs)")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save")
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: Math.max(48, insets.top + 16), paddingBottom: insets.bottom + 48 }]}>
      <View style={styles.header}>
        <Text style={styles.logo}>📞</Text>
        <Text style={styles.title}>Sigo</Text>
        <Text style={styles.steps}>Step {step} of 3</Text>
      </View>

      {step === 1 && (
        <>
          <Text style={styles.heading}>Get your business number</Text>
          <Text style={styles.subheading}>Buy a new number or port your existing one in the Settings tab after you finish.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => setStep(2)}>
            <Text style={styles.primaryButtonText}>Continue</Text>
          </TouchableOpacity>
        </>
      )}

      {step === 2 && (
        <>
          <Text style={styles.heading}>Add a receptionist</Text>
          <Text style={styles.subheading}>You can add someone who answers calls in the Contacts tab later.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => setStep(3)}>
            <Text style={styles.primaryButtonText}>Continue</Text>
          </TouchableOpacity>
        </>
      )}

      {step === 3 && (
        <>
          <Text style={styles.heading}>Set up AI fallback</Text>
          <Text style={styles.subheading}>When no one answers, AI can pick up and take messages.</Text>
          <TouchableOpacity style={styles.toggle} onPress={() => setAiEnabled(!aiEnabled)}>
            <Text style={styles.toggleLabel}>AI Assistant</Text>
            <View style={[styles.toggleTrack, aiEnabled && styles.toggleTrackOn]}>
              <View style={[styles.toggleThumb, aiEnabled && styles.toggleThumbOn]} />
            </View>
          </TouchableOpacity>
          {aiEnabled && (
            <TextInput
              style={styles.textArea}
              value={aiGreeting}
              onChangeText={setAiGreeting}
              multiline
              numberOfLines={4}
              placeholder="AI greeting script..."
              placeholderTextColor="#64748b"
            />
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity
            style={[styles.primaryButton, loading && styles.buttonDisabled]}
            onPress={handleLaunch}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Launch My Business Line</Text>}
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  content: { padding: 24, paddingBottom: 48 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 32, gap: 8 },
  logo: { fontSize: 24 },
  title: { fontSize: 18, fontWeight: "700", color: "#f8fafc" },
  steps: { marginLeft: "auto", fontSize: 12, color: "#94a3b8" },
  heading: { fontSize: 22, fontWeight: "700", color: "#f8fafc", marginBottom: 8 },
  subheading: { fontSize: 14, color: "#94a3b8", marginBottom: 24 },
  primaryButton: { backgroundColor: "#6366f1", borderRadius: 12, paddingVertical: 14, minHeight: 44, justifyContent: "center", alignItems: "center", marginTop: 16 },
  primaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  buttonDisabled: { opacity: 0.6 },
  toggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#1e293b", padding: 16, minHeight: 44, borderRadius: 12, marginBottom: 16 },
  toggleLabel: { fontSize: 14, fontWeight: "600", color: "#f8fafc" },
  toggleTrack: { width: 48, height: 28, borderRadius: 14, backgroundColor: "#475569", padding: 2 },
  toggleTrackOn: { backgroundColor: "#6366f1" },
  toggleThumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#f8fafc" },
  toggleThumbOn: { alignSelf: "flex-end" },
  textArea: { backgroundColor: "#1e293b", borderRadius: 12, padding: 14, fontSize: 14, color: "#f8fafc", minHeight: 100, textAlignVertical: "top", marginBottom: 16, borderWidth: 1, borderColor: "#334155" },
  error: { backgroundColor: "rgba(239,68,68,0.15)", padding: 12, borderRadius: 12, color: "#fca5a5", fontSize: 12, marginBottom: 16 },
})
