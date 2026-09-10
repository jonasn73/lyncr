import { useEffect, useState } from "react"
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native"
import { useRouter } from "expo-router"
import { apiGet } from "../../lib/api"

function getWeekRange(offset: number): { start: string; end: string } {
  const now = new Date()
  const start = new Date(now)
  start.setDate(now.getDate() - now.getDay() + 1 + offset * 7)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  end.setHours(23, 59, 59, 999)
  return { start: start.toISOString(), end: end.toISOString() }
}

export default function PayScreen() {
  const router = useRouter()
  const [summary, setSummary] = useState<{ total_minutes: number; total_earnings: number; total_calls: number } | null>(null)
  const [agents, setAgents] = useState<{ name: string; total_minutes: number; total_earnings: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    const { start, end } = getWeekRange(0)
    apiGet<{
      data?: {
        summary: { total_minutes: number; total_earnings: number; total_calls: number }
        agents: { name: string; total_minutes: number; total_earnings: number }[]
      }
    }>(
      `/api/analytics?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
    )
      .then((d) => {
        setSummary(d.data?.summary ?? null)
        setAgents(d.data?.agents ?? [])
      })
      .catch((e) => {
        const err = e as Error & { status?: number }
        if (err.status === 401) router.replace("/login")
        else setError(err instanceof Error ? err.message : "Failed to load")
      })
      .finally(() => setLoading(false))
  }, [router])

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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Pay</Text>
      <Text style={styles.subtitle}>This week</Text>
      <View style={styles.row}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{summary?.total_minutes ?? 0}m</Text>
          <Text style={styles.statLabel}>Time</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{summary?.total_calls ?? 0}</Text>
          <Text style={styles.statLabel}>Calls</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>${(summary?.total_earnings ?? 0).toFixed(2)}</Text>
          <Text style={styles.statLabel}>Earnings</Text>
        </View>
      </View>
      <Text style={styles.sectionTitle}>By agent</Text>
      {agents.length === 0 ? (
        <Text style={styles.muted}>No data yet</Text>
      ) : (
        agents.map((a, i) => (
          <View key={i} style={styles.card}>
            <Text style={styles.name}>{a.name}</Text>
            <Text style={styles.meta}>{a.total_minutes}m · ${a.total_earnings.toFixed(2)}</Text>
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
  title: { fontSize: 18, fontWeight: "700", color: "#f8fafc", marginBottom: 4 },
  subtitle: { fontSize: 14, color: "#94a3b8", marginBottom: 16 },
  row: { flexDirection: "row", gap: 12, marginBottom: 24 },
  stat: { flex: 1, backgroundColor: "#1e293b", borderRadius: 12, padding: 16, alignItems: "center", borderWidth: 1, borderColor: "#334155" },
  statValue: { fontSize: 18, fontWeight: "700", color: "#f8fafc" },
  statLabel: { fontSize: 12, color: "#94a3b8", marginTop: 4 },
  sectionTitle: { fontSize: 14, fontWeight: "600", color: "#94a3b8", marginBottom: 12 },
  muted: { fontSize: 14, color: "#64748b" },
  card: { backgroundColor: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#334155" },
  name: { fontSize: 16, fontWeight: "600", color: "#f8fafc" },
  meta: { fontSize: 14, color: "#94a3b8", marginTop: 4 },
})
