import { useEffect, useState } from "react"
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from "react-native"
import { useRouter } from "expo-router"
import { apiGet } from "../../lib/api"

type RoutingConfig = {
  selected_receptionist_id: string | null
  fallback_type: "owner" | "ai" | "voicemail" | "hold"
  receptionists: { id: string; name: string; phone: string; is_active: boolean }[]
}

export default function DashboardScreen() {
  const router = useRouter()
  const [config, setConfig] = useState<RoutingConfig | null>(null)
  const [user, setUser] = useState<{ name: string } | null>(null)
  const [calls, setCalls] = useState<{ id: string; duration_seconds: number; created_at: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    Promise.all([
      apiGet<{ user: { name: string } }>("/api/auth/session"),
      apiGet<{ config: RoutingConfig; receptionists: RoutingConfig["receptionists"] }>("/api/routing"),
      apiGet<{ calls: { id: string; duration_seconds: number; created_at: string }[] }>("/api/calls?limit=20"),
    ])
      .then(([session, routing, callsRes]) => {
        setUser((session as { user?: { name: string } }).user ?? null)
        const cfg = (routing as { config?: RoutingConfig }).config
        const recs = (routing as { receptionists?: RoutingConfig["receptionists"] }).receptionists ?? []
        setConfig(cfg ? { ...cfg, receptionists: recs } : null)
        setCalls(Array.isArray((callsRes as { calls?: unknown[] }).calls) ? (callsRes as { calls: { id: string; duration_seconds: number; created_at: string }[] }).calls : [])
      })
      .catch((e) => {
        const err = e as Error & { status?: number }
        if (err.status === 401) router.replace("/login")
        else setError(err instanceof Error ? err.message : "Failed to load")
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    )
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error}</Text>
      </View>
    )
  }

  const selected = config?.receptionists?.find((r) => r.id === config?.selected_receptionist_id)
  const totalCalls = calls.length
  const totalMins = Math.round((calls.reduce((s, c) => s + (c.duration_seconds ?? 0), 0) / 60) * 10) / 10

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Who receives calls</Text>
        <Text style={styles.cardValue}>{selected?.name ?? user?.name ?? "You"}</Text>
        <Text style={styles.cardHint}>{config?.fallback_type === "ai" ? "AI fallback" : config?.fallback_type === "voicemail" ? "Voicemail fallback" : "Owner fallback"}</Text>
      </View>
      <View style={styles.row}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{totalCalls}</Text>
          <Text style={styles.statLabel}>Calls</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{totalMins}m</Text>
          <Text style={styles.statLabel}>Talk time</Text>
        </View>
      </View>
      <Text style={styles.sectionTitle}>Recent calls</Text>
      {calls.length === 0 ? (
        <Text style={styles.muted}>No calls yet</Text>
      ) : (
        calls.slice(0, 10).map((c) => (
          <View key={c.id} style={styles.callRow}>
            <Text style={styles.callTime}>{new Date(c.created_at).toLocaleDateString()}</Text>
            <Text style={styles.callDuration}>{Math.round((c.duration_seconds ?? 0) / 60)}m</Text>
          </View>
        ))
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  content: { padding: 16, paddingBottom: 32 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0f172a" },
  error: { color: "#fca5a5", fontSize: 14 },
  card: { backgroundColor: "#1e293b", borderRadius: 16, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: "#334155" },
  cardLabel: { fontSize: 12, color: "#94a3b8", marginBottom: 4 },
  cardValue: { fontSize: 18, fontWeight: "700", color: "#f8fafc" },
  cardHint: { fontSize: 12, color: "#64748b", marginTop: 4 },
  row: { flexDirection: "row", gap: 12, marginBottom: 24 },
  stat: { flex: 1, backgroundColor: "#1e293b", borderRadius: 12, padding: 16, alignItems: "center", borderWidth: 1, borderColor: "#334155" },
  statValue: { fontSize: 20, fontWeight: "700", color: "#f8fafc" },
  statLabel: { fontSize: 12, color: "#94a3b8", marginTop: 4 },
  sectionTitle: { fontSize: 14, fontWeight: "600", color: "#94a3b8", marginBottom: 12 },
  muted: { fontSize: 14, color: "#64748b" },
  callRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#1e293b" },
  callTime: { fontSize: 14, color: "#f8fafc" },
  callDuration: { fontSize: 14, color: "#94a3b8" },
})
