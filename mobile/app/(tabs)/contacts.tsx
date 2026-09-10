import { useEffect, useState } from "react"
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native"
import { useRouter } from "expo-router"
import { apiGet } from "../../lib/api"

type Receptionist = {
  id: string
  name: string
  phone: string
  is_active: boolean
}

export default function ContactsScreen() {
  const router = useRouter()
  const [list, setList] = useState<Receptionist[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    apiGet<{ data: Receptionist[] }>("/api/receptionists")
      .then((d) => setList(d.data ?? []))
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
      <Text style={styles.title}>Receptionists</Text>
      {list.length === 0 ? (
        <Text style={styles.muted}>No receptionists yet. Add one in the web app or we can add a form here.</Text>
      ) : (
        list.map((r) => (
          <View key={r.id} style={styles.card}>
            <Text style={styles.name}>{r.name}</Text>
            <Text style={styles.phone}>{r.phone}</Text>
            <View style={[styles.badge, r.is_active && styles.badgeActive]}>
              <Text style={styles.badgeText}>{r.is_active ? "Active" : "Inactive"}</Text>
            </View>
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
  title: { fontSize: 18, fontWeight: "700", color: "#f8fafc", marginBottom: 16 },
  muted: { fontSize: 14, color: "#64748b" },
  card: { backgroundColor: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: "#334155" },
  name: { fontSize: 16, fontWeight: "600", color: "#f8fafc" },
  phone: { fontSize: 14, color: "#94a3b8", marginTop: 4 },
  badge: { alignSelf: "flex-start", marginTop: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: "#334155" },
  badgeActive: { backgroundColor: "rgba(34,197,94,0.2)" },
  badgeText: { fontSize: 12, color: "#94a3b8" },
})
