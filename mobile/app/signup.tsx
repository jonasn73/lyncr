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
  Pressable,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { useRouter } from "expo-router"
import { apiMutate } from "../lib/api"
import { SIGNUP_INDUSTRY_OPTIONS } from "../../lib/business-industries"
import { BrandWordmark } from "@/components/BrandWordmark"
import { colors } from "../lib/theme"

export default function SignupScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [businessName, setBusinessName] = useState("")
  const [ownerName, setOwnerName] = useState("")
  const [ownerPhone, setOwnerPhone] = useState("")
  const [industry, setIndustry] = useState("generic")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit() {
    setError("")
    setLoading(true)
    try {
      await apiMutate("/api/auth/signup", {
        method: "POST",
        body: {
          email: email.trim().toLowerCase(),
          password,
          name: ownerName.trim(),
          phone: ownerPhone.trim(),
          business_name: businessName.trim() || "My Business",
          industry,
        },
      })
      router.replace("/onboarding")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signup failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: Math.max(48, insets.top + 16), paddingBottom: insets.bottom + 48 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View style={styles.logo}>
            <Text style={styles.logoIcon}>📞</Text>
          </View>
          <BrandWordmark size="md" />
        </View>

        <Text style={styles.heading}>Create your account</Text>
        <Text style={styles.subheading}>Set up your business phone system in minutes</Text>

        <Text style={styles.label}>Business Name</Text>
        <TextInput
          style={styles.input}
          placeholder="Acme Plumbing"
          placeholderTextColor="#64748b"
          value={businessName}
          onChangeText={setBusinessName}
        />

        <Text style={styles.label}>Your Name</Text>
        <TextInput
          style={styles.input}
          placeholder="John Smith"
          placeholderTextColor="#64748b"
          value={ownerName}
          onChangeText={setOwnerName}
        />

        <Text style={styles.label}>Your Cell Phone</Text>
        <TextInput
          style={styles.input}
          placeholder="(555) 123-4567"
          placeholderTextColor="#64748b"
          value={ownerPhone}
          onChangeText={setOwnerPhone}
          keyboardType="phone-pad"
        />

        <Text style={styles.label}>Industry (AI phone assistant)</Text>
        <View style={styles.chipRow}>
          {SIGNUP_INDUSTRY_OPTIONS.map((chip) => (
            <Pressable
              key={chip.value}
              onPress={() => setIndustry(chip.value)}
              style={[styles.chip, industry === chip.value && styles.chipActive]}
            >
              <Text style={[styles.chipText, industry === chip.value && styles.chipTextActive]}>{chip.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>Used when nobody answers — questions match your trade.</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          placeholder="you@business.com"
          placeholderTextColor="#64748b"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          placeholder="Create a password (min 8 characters)"
          placeholderTextColor="#64748b"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
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
            <Text style={styles.buttonText}>Create Account</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.link} onPress={() => router.replace("/login")}>
          <Text style={styles.linkText}>Already have an account? Log in</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flexGrow: 1, padding: 24, paddingBottom: 48, maxWidth: 400, alignSelf: "center", width: "100%" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 32 },
  logo: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  logoIcon: { fontSize: 18 },
  heading: { fontSize: 24, fontWeight: "700", color: colors.text },
  subheading: { fontSize: 14, color: colors.textMuted, marginTop: 8, marginBottom: 24 },
  label: { fontSize: 12, fontWeight: "600", color: colors.textMuted, marginBottom: 6 },
  input: {
    backgroundColor: colors.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  error: { backgroundColor: colors.errorBg, padding: 12, borderRadius: 12, color: colors.error, fontSize: 12, marginBottom: 16 },
  button: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, minHeight: 44, justifyContent: "center", alignItems: "center", marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { marginTop: 24, alignItems: "center", minHeight: 44, justifyContent: "center" },
  linkText: { color: colors.primary, fontSize: 14, fontWeight: "500" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  chipActive: { borderColor: colors.primary, backgroundColor: "rgba(95,110,244,0.22)" },
  chipText: { fontSize: 13, color: colors.textMuted, fontWeight: "500" },
  chipTextActive: { color: "#e0e7ff" },
  hint: { fontSize: 12, color: colors.textDim, marginBottom: 16 },
})
