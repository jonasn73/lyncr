/**
 * Collect Payment — Tap to Pay on iPhone via Stripe Terminal React Native.
 * Talks to the same lyncr.app APIs as the web Collect Payment sheet.
 * Requires an EAS development/production build (not Expo Go) + Apple Tap to Pay entitlement.
 */

import { useEffect, useMemo, useState } from "react"
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Switch,
  Alert,
  Platform,
} from "react-native"
import { useRouter } from "expo-router"
import { useStripeTerminal } from "@stripe/stripe-terminal-react-native"
import { API_URL, apiGet, apiMutate } from "../../lib/api"
import { colors, spacing, radius, fontSize } from "../../lib/theme"

/** Tip preset percentages shown after a successful charge. */
const TIP_PRESETS = [0, 15, 18, 20] as const

/** Format cents as $X.XX for the UI. */
function fmtCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
}

/** Parse a dollar string like "85" or "85.50" into dollars, or null if invalid. */
function parseDollars(raw: string): number | null {
  const n = Number(String(raw).replace(/[^0-9.]/g, ""))
  if (!Number.isFinite(n) || n < 0.5) return null
  return Math.round(n * 100) / 100
}

export default function CollectScreen() {
  // Navigate to login when the session expires.
  const router = useRouter()

  // Amount the customer owes before tax (USD dollars as typed).
  const [amount, setAmount] = useState("")
  // Optional note stored on the walk-up PaymentIntent.
  const [note, setNote] = useState("")
  // Whether to add sales tax on top of the subtotal.
  const [taxEnabled, setTaxEnabled] = useState(false)
  // Tax percent string (e.g. "6" for 6%).
  const [taxRatePercent, setTaxRatePercent] = useState("6")
  // Busy flag while creating PI / collecting / processing.
  const [busy, setBusy] = useState(false)
  // Status line shown under the buttons.
  const [status, setStatus] = useState("")
  // Error message for the user.
  const [error, setError] = useState("")

  // After a successful charge we show tip + send-invoice steps.
  const [step, setStep] = useState<"charge" | "after">("charge")
  // Stripe PaymentIntent id from the completed charge.
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null)
  // Charged total in cents (for tip math).
  const [chargedCents, setChargedCents] = useState(0)
  // Selected tip percent (0 = no tip).
  const [tipPercent, setTipPercent] = useState(0)
  // Customer name for the receipt (collected after pay).
  const [customerName, setCustomerName] = useState("")
  // Email for send-receipt.
  const [receiptEmail, setReceiptEmail] = useState("")
  // Phone for SMS receipt.
  const [receiptPhone, setReceiptPhone] = useState("")
  // After-pay busy state.
  const [afterBusy, setAfterBusy] = useState(false)

  // Stripe Terminal hook — easyConnect combines discover + connect for Tap to Pay.
  const {
    initialize,
    easyConnect,
    disconnectReader,
    retrievePaymentIntent,
    collectPaymentMethod,
    processPaymentIntent,
    connectedReader,
  } = useStripeTerminal({
    onDidAcceptTermsOfService: () => {
      // Apple Tap to Pay ToS accepted on device.
      setStatus("Tap to Pay terms accepted")
    },
  })

  // Ensure the SDK is initialized when this screen mounts.
  useEffect(() => {
    void initialize()
  }, [initialize])

  // Live preview of subtotal / tax / total while typing.
  const breakdown = useMemo(() => {
    const dollars = parseDollars(amount)
    if (dollars == null) return null
    const subtotalCents = Math.round(dollars * 100)
    const rate = taxEnabled ? Math.min(30, Math.max(0, parseFloat(taxRatePercent) || 0)) / 100 : 0
    const taxCents = rate > 0 ? Math.round(subtotalCents * rate) : 0
    return { subtotalCents, taxCents, totalCents: subtotalCents + taxCents }
  }, [amount, taxEnabled, taxRatePercent])

  /** Tip amount in cents based on the charged total and selected percent. */
  const tipCents = useMemo(() => {
    if (tipPercent <= 0 || chargedCents <= 0) return 0
    return Math.round((chargedCents * tipPercent) / 100)
  }, [tipPercent, chargedCents])

  /** Main Tap to Pay flow: create PI → connect reader → collect → process → confirm. */
  async function runTapToPay() {
    // Clear previous UI errors.
    setError("")
    setStatus("")
    // Parse and validate the amount first.
    const dollars = parseDollars(amount)
    if (dollars == null) {
      setError("Enter an amount of at least $0.50.")
      return
    }
    // Tap to Pay needs a real iPhone + native build.
    if (Platform.OS !== "ios") {
      setError("Tap to Pay on iPhone requires an iOS device.")
      return
    }

    setBusy(true)
    setStatus("Creating payment…")
    try {
      // 1) Create a card_present PaymentIntent on the server (walk-up / adhoc).
      const createRes = await fetch(`${API_URL}/api/payments/create-intent`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          adhoc: true,
          amount: dollars,
          paymentMethodType: "TAP_TO_PAY",
          note: note.trim() || "Walk-up payment",
          taxEnabled,
          taxRatePercent: taxEnabled ? parseFloat(taxRatePercent) || 0 : 0,
        }),
      })
      const createJson = (await createRes.json().catch(() => ({}))) as {
        error?: string
        data?: { clientSecret?: string; paymentIntentId?: string; chargeCents?: number }
      }
      if (createRes.status === 401) {
        router.replace("/login")
        return
      }
      if (!createRes.ok || !createJson.data?.clientSecret) {
        throw new Error(createJson.error || "Could not start Tap to Pay")
      }
      const clientSecret = createJson.data.clientSecret
      const totalAtCharge = createJson.data.chargeCents ?? breakdown?.totalCents ?? 0

      // 2) Fetch Terminal location id (also available on connection-token response).
      setStatus("Connecting Tap to Pay…")
      const locRes = await apiGet<{ data?: { locationId?: string } }>(
        "/api/payments/terminal/location"
      )
      const locationId = locRes.data?.locationId
      if (!locationId) throw new Error("No Stripe Terminal location — check Stripe setup.")

      // Disconnect any previous reader so discovery is clean.
      if (connectedReader) {
        try {
          await disconnectReader()
        } catch {
          /* ignore */
        }
      }

      // 3) Discover + connect the on-device Tap to Pay reader in one SDK call.
      const connected = await easyConnect({
        discoveryMethod: "tapToPay",
        simulated: false,
        locationId,
        merchantDisplayName: "Lyncr",
        tosAcceptancePermitted: true,
        autoReconnectOnUnexpectedDisconnect: true,
      })
      if (connected.error) {
        throw new Error(
          connected.error.message ||
            "Could not connect Tap to Pay. Use a physical iPhone XS or later with a development/App Store build, and approve the Apple Tap to Pay entitlement."
        )
      }

      // 4) Load the PaymentIntent into the Terminal SDK.
      setStatus("Hold card near top of iPhone…")
      const retrieved = await retrievePaymentIntent(clientSecret)
      if (retrieved.error || !retrieved.paymentIntent) {
        throw new Error(retrieved.error?.message || "Could not load payment.")
      }

      // 5) Collect the contactless payment method (NFC tap).
      const collected = await collectPaymentMethod({
        paymentIntent: retrieved.paymentIntent,
        skipTipping: true,
      })
      if (collected.error || !collected.paymentIntent) {
        throw new Error(
          collected.error?.message || "Customer didn’t complete the tap. Try again."
        )
      }

      // 6) Process (authorize + capture per server capture_method).
      setStatus("Processing payment…")
      const processed = await processPaymentIntent({
        paymentIntent: collected.paymentIntent,
      })
      if (processed.error || !processed.paymentIntent) {
        throw new Error(processed.error?.message || "Tap charge failed.")
      }

      // Prefer the processed PI id; fall back to create-intent id.
      const piId = String(processed.paymentIntent.id || createJson.data.paymentIntentId || "")
      if (!piId) throw new Error("Payment succeeded but no payment id was returned.")

      // 7) Tell lyncr to settle the transaction / wallet row.
      setStatus("Confirming…")
      await apiMutate("/api/payments/confirm", {
        method: "POST",
        body: { paymentIntentId: piId },
      }).catch(() => null)

      // Move to tip + send-invoice step.
      setPaymentIntentId(piId)
      setChargedCents(totalAtCharge)
      setTipPercent(0)
      setStep("after")
      setStatus("Payment successful")
      Alert.alert("Paid", `${fmtCents(totalAtCharge)} collected.`)
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status === 401) {
        router.replace("/login")
        return
      }
      setError(err instanceof Error ? err.message : "Tap to Pay failed")
      setStatus("")
    } finally {
      setBusy(false)
      // Best-effort disconnect so the next charge can rediscover.
      try {
        await disconnectReader()
      } catch {
        /* ignore */
      }
    }
  }

  /** Save tip (no separate tip charge in v1 mobile — record tip cents on the slip) + optional receipt. */
  async function finishAfterPay(sendChannel: "email" | "sms" | "skip") {
    if (!paymentIntentId) return
    setAfterBusy(true)
    setError("")
    try {
      // Persist tip amount on the payment slip (signature pad can follow in a later release).
      await apiMutate("/api/payments/complete-slip", {
        method: "POST",
        body: {
          paymentIntentId,
          tipCents,
          signaturePng: null,
          tipPaymentIntentId: null,
        },
      }).catch(() => null)

      if (sendChannel !== "skip") {
        await apiMutate("/api/payments/send-receipt", {
          method: "POST",
          body: {
            paymentIntentId,
            channel: sendChannel,
            customerName: customerName.trim() || undefined,
            email: sendChannel === "email" ? receiptEmail.trim() : undefined,
            phone: sendChannel === "sms" ? receiptPhone.trim() : undefined,
          },
        })
      }

      Alert.alert("Done", sendChannel === "skip" ? "Payment saved." : "Receipt sent.")
      // Reset for the next walk-up customer.
      setStep("charge")
      setPaymentIntentId(null)
      setChargedCents(0)
      setAmount("")
      setNote("")
      setCustomerName("")
      setReceiptEmail("")
      setReceiptPhone("")
      setStatus("")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not finish")
    } finally {
      setAfterBusy(false)
    }
  }

  // ——— After-pay UI (tip presets + send invoice) ———
  if (step === "after") {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Payment collected</Text>
        <Text style={styles.subtitle}>
          {fmtCents(chargedCents)}
          {tipCents > 0 ? ` + ${fmtCents(tipCents)} tip` : ""}
        </Text>

        <Text style={styles.label}>Tip</Text>
        <View style={styles.tipRow}>
          {TIP_PRESETS.map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.tipChip, tipPercent === p && styles.tipChipActive]}
              onPress={() => setTipPercent(p)}
              accessibilityLabel={p === 0 ? "No tip" : `${p} percent tip`}
            >
              <Text style={[styles.tipChipText, tipPercent === p && styles.tipChipTextActive]}>
                {p === 0 ? "None" : `${p}%`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Customer name (optional)</Text>
        <TextInput
          style={styles.input}
          value={customerName}
          onChangeText={setCustomerName}
          placeholder="Name on receipt"
          placeholderTextColor={colors.textDim}
        />

        <Text style={styles.label}>Email receipt</Text>
        <TextInput
          style={styles.input}
          value={receiptEmail}
          onChangeText={setReceiptEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholder="customer@email.com"
          placeholderTextColor={colors.textDim}
        />

        <Text style={styles.label}>SMS receipt</Text>
        <TextInput
          style={styles.input}
          value={receiptPhone}
          onChangeText={setReceiptPhone}
          keyboardType="phone-pad"
          placeholder="+15551234567"
          placeholderTextColor={colors.textDim}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={[styles.button, afterBusy && styles.buttonDisabled]}
          disabled={afterBusy || !receiptEmail.trim()}
          onPress={() => void finishAfterPay("email")}
        >
          {afterBusy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Email invoice</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.buttonSecondary, afterBusy && styles.buttonDisabled]}
          disabled={afterBusy || !receiptPhone.trim()}
          onPress={() => void finishAfterPay("sms")}
        >
          <Text style={styles.buttonSecondaryText}>Text invoice</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkBtn}
          disabled={afterBusy}
          onPress={() => void finishAfterPay("skip")}
        >
          <Text style={styles.linkText}>Skip — done</Text>
        </TouchableOpacity>
      </ScrollView>
    )
  }

  // ——— Charge UI ———
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Collect Payment</Text>
      <Text style={styles.subtitle}>
        Tap to Pay uses this iPhone’s NFC. Requires a Lyncr development or App Store build — not Expo Go or Safari.
      </Text>

      <Text style={styles.label}>Amount (USD)</Text>
      <TextInput
        style={styles.input}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="85.00"
        placeholderTextColor={colors.textDim}
        accessibilityLabel="Payment amount in dollars"
      />

      <Text style={styles.label}>Note (optional)</Text>
      <TextInput
        style={styles.input}
        value={note}
        onChangeText={setNote}
        placeholder="Walk-up / counter sale"
        placeholderTextColor={colors.textDim}
      />

      <View style={styles.taxRow}>
        <Text style={styles.labelInline}>Add sales tax</Text>
        <Switch
          value={taxEnabled}
          onValueChange={setTaxEnabled}
          trackColor={{ true: colors.primary }}
          accessibilityLabel="Toggle sales tax"
        />
      </View>
      {taxEnabled ? (
        <>
          <Text style={styles.label}>Tax rate %</Text>
          <TextInput
            style={styles.input}
            value={taxRatePercent}
            onChangeText={setTaxRatePercent}
            keyboardType="decimal-pad"
            placeholder="6"
            placeholderTextColor={colors.textDim}
          />
        </>
      ) : null}

      {breakdown ? (
        <View style={styles.summary}>
          <Text style={styles.summaryLine}>Subtotal {fmtCents(breakdown.subtotalCents)}</Text>
          {breakdown.taxCents > 0 ? (
            <Text style={styles.summaryLine}>Tax {fmtCents(breakdown.taxCents)}</Text>
          ) : null}
          <Text style={styles.summaryTotal}>Total {fmtCents(breakdown.totalCents)}</Text>
        </View>
      ) : null}

      {status ? <Text style={styles.status}>{status}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.button, busy && styles.buttonDisabled]}
        onPress={() => void runTapToPay()}
        disabled={busy}
        accessibilityLabel="Collect with Tap to Pay"
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Tap to Pay</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.hint}>
        Card / Apple Pay fallback stays on lyncr.app for now. Use this screen for in-person NFC on a provisioned iPhone.
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: 40 },
  title: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text, marginBottom: 4 },
  subtitle: { fontSize: fontSize.sm, color: colors.textMuted, marginBottom: spacing.lg, lineHeight: 20 },
  label: { fontSize: fontSize.sm, fontWeight: "600", color: colors.textMuted, marginBottom: 6 },
  labelInline: { fontSize: fontSize.sm, fontWeight: "600", color: colors.textMuted },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    color: colors.text,
    fontSize: fontSize.base,
    marginBottom: spacing.md,
    minHeight: spacing.touchTarget,
  },
  taxRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  summary: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  summaryLine: { fontSize: fontSize.sm, color: colors.textMuted, marginBottom: 4 },
  summaryTotal: { fontSize: fontSize.base, fontWeight: "700", color: colors.text, marginTop: 4 },
  status: { fontSize: fontSize.sm, color: colors.primary, marginBottom: spacing.sm },
  error: { fontSize: fontSize.sm, color: colors.error, marginBottom: spacing.sm },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    minHeight: spacing.touchTarget,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: fontSize.base, fontWeight: "700" },
  buttonSecondary: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
    minHeight: spacing.touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  buttonSecondaryText: { color: colors.text, fontSize: fontSize.base, fontWeight: "600" },
  linkBtn: { marginTop: spacing.lg, alignItems: "center", minHeight: spacing.touchTarget, justifyContent: "center" },
  linkText: { color: colors.textMuted, fontSize: fontSize.sm },
  hint: { marginTop: spacing.lg, fontSize: fontSize.xs, color: colors.textDim, lineHeight: 18 },
  tipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: spacing.md },
  tipChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    minHeight: spacing.touchTarget,
    justifyContent: "center",
  },
  tipChipActive: { borderColor: colors.primary, backgroundColor: "rgba(95,110,244,0.2)" },
  tipChipText: { color: colors.textMuted, fontWeight: "600" },
  tipChipTextActive: { color: colors.text },
})
