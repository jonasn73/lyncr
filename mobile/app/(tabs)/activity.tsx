import { useEffect, useMemo, useState } from "react"
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Linking,
} from "react-native"
import { useRouter } from "expo-router"
import { apiGet } from "../../lib/api"

type CallLog = {
  id: string
  from_number: string
  to_number: string
  duration_seconds: number | null
  created_at: string
  recording_url: string | null
  call_type?: string
  status?: string
}

type QualitySummary = {
  answer_rate_percent: number
  avg_setup_ms: number | null
}

type CallFilter = "missed" | "all"

function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return phone
}

function buildTelHref(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith("+")) return `tel:${trimmed.replace(/[^\d+]/g, "")}`
  const digits = trimmed.replace(/\D/g, "")
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`
  if (digits.length === 10) return `tel:+1${digits}`
  return digits ? `tel:${digits}` : null
}

function isMissedCall(call: CallLog): boolean {
  const type = String(call.call_type ?? "").toLowerCase()
  const status = String(call.status ?? "").toLowerCase()
  if (type === "missed" || type === "voicemail") return true
  if (status === "no-answer" || status === "busy" || status === "missed") return true
  if ((call.duration_seconds ?? 0) <= 0 && type !== "outgoing") return true
  return false
}

export default function ActivityScreen() {
  const router = useRouter()
  const [calls, setCalls] = useState<CallLog[]>([])
  const [quality, setQuality] = useState<QualitySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [filter, setFilter] = useState<CallFilter>("missed")

  useEffect(() => {
    Promise.all([
      apiGet<{ calls: CallLog[] }>("/api/calls?limit=100"),
      apiGet<{ summary: QualitySummary }>("/api/voice/quality?days=7"),
    ])
      .then(([callsData, qualityData]) => {
        setCalls(callsData.calls ?? [])
        setQuality(qualityData.summary ?? null)
      })
      .catch((e) => {
        const err = e as Error & { status?: number }
        if (err.status === 401) router.replace("/login")
        else setError(err instanceof Error ? err.message : "Failed to load")
      })
      .finally(() => setLoading(false))
  }, [])

  const missedCount = useMemo(() => calls.filter(isMissedCall).length, [calls])

  const visibleCalls = useMemo(() => {
    const list = filter === "missed" ? calls.filter(isMissedCall) : calls
    return [...list].sort((a, b) => b.created_at.localeCompare(a.created_at))
  }, [calls, filter])

  async function callBack(phone: string) {
    const href = buildTelHref(phone)
    if (!href) return
    const canOpen = await Linking.canOpenURL(href)
    if (canOpen) await Linking.openURL(href)
  }

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
      <Text style={styles.title}>{filter === "missed" ? "Missed calls" : "All calls"}</Text>
      <View style={styles.filterRow}>
        <Pressable
          onPress={() => setFilter("missed")}
          style={[styles.filterChip, filter === "missed" && styles.filterChipActiveMissed]}
        >
          <Text style={[styles.filterChipText, filter === "missed" && styles.filterChipTextActive]}>
            Missed{missedCount > 0 ? ` (${missedCount})` : ""}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setFilter("all")}
          style={[styles.filterChip, filter === "all" && styles.filterChipActiveAll]}
        >
          <Text style={[styles.filterChipText, filter === "all" && styles.filterChipTextActive]}>All</Text>
        </Pressable>
      </View>
      <View style={styles.kpiRow}>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiValue}>{quality ? `${quality.answer_rate_percent.toFixed(1)}%` : "--"}</Text>
          <Text style={styles.kpiLabel}>Answer rate</Text>
        </View>
        <View style={styles.kpiCard}>
          <Text style={styles.kpiValue}>
            {quality?.avg_setup_ms != null ? `${Math.round(quality.avg_setup_ms)}ms` : "--"}
          </Text>
          <Text style={styles.kpiLabel}>Avg setup</Text>
        </View>
      </View>
      {visibleCalls.length === 0 ? (
        <Text style={styles.muted}>{filter === "missed" ? "No missed calls" : "No calls yet"}</Text>
      ) : (
        visibleCalls.map((c) => {
          const missed = isMissedCall(c)
          return (
            <View key={c.id} style={styles.card}>
              <Text style={styles.fromTo}>{formatPhoneDisplay(c.from_number)}</Text>
              <Text style={styles.meta}>
                {new Date(c.created_at).toLocaleString()} ·{" "}
                {c.duration_seconds != null ? `${Math.round(c.duration_seconds / 60)}m` : "—"}
              </Text>
              {missed ? (
                <Pressable onPress={() => void callBack(c.from_number)} style={styles.callBackBtn}>
                  <Text style={styles.callBackText}>Call back</Text>
                </Pressable>
              ) : null}
            </View>
          )
        })
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0f172a" },
  content: { padding: 16, paddingBottom: 32 },
  centered: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0f172a" },
  error: { color: "#fca5a5", fontSize: 14 },
  title: { fontSize: 18, fontWeight: "700", color: "#f8fafc", marginBottom: 12 },
  filterRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#334155",
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "#0f172a",
  },
  filterChipActiveMissed: { borderColor: "#f59e0b", backgroundColor: "rgba(245,158,11,0.15)" },
  filterChipActiveAll: { borderColor: "#6366f1", backgroundColor: "rgba(99,102,241,0.15)" },
  filterChipText: { color: "#94a3b8", fontSize: 12, fontWeight: "600" },
  filterChipTextActive: { color: "#f8fafc" },
  kpiRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  kpiCard: { flex: 1, backgroundColor: "#1e293b", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#334155" },
  kpiValue: { fontSize: 16, fontWeight: "700", color: "#f8fafc" },
  kpiLabel: { fontSize: 11, color: "#94a3b8", marginTop: 2 },
  muted: { fontSize: 14, color: "#64748b" },
  card: { backgroundColor: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#334155" },
  fromTo: { fontSize: 14, color: "#f8fafc", fontWeight: "600" },
  meta: { fontSize: 12, color: "#94a3b8", marginTop: 4 },
  callBackBtn: {
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.35)",
    backgroundColor: "rgba(34,211,238,0.1)",
    paddingVertical: 10,
    alignItems: "center",
  },
  callBackText: { color: "#67e8f9", fontSize: 14, fontWeight: "700" },
})
