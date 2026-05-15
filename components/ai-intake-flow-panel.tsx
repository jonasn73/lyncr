"use client"

// ============================================
// Playbook + intake + optional voice assistant id (shared: full page or fallback modal)
// ============================================

import { useEffect, useId, useMemo, useState } from "react"
import { Bot, ChevronDown, Loader2, Save, Volume2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { IconSurface } from "@/components/ui/icon-surface"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { SITE_NAME } from "@/lib/brand"
import { displayUserFacingMessage } from "@/lib/porting-display"
import { getIntakeFlowSummary } from "@/lib/ai-intake-flow-summaries"
import {
  type AiIntakeProfileId,
  AI_INTAKE_PROFILE_IDS,
  INDUSTRY_CATALOG,
  defaultProfileFromUserIndustry,
  industryLabel,
  isAiIntakeProfileId,
} from "@/lib/business-industries"
import { DEFAULT_BUSY_GREETING_LOCKSMITH } from "@/lib/ai-intake-defaults"

/** Tiny labels at bottom of fallback modal — not primary setup. */
const VOICE_AI_FOOTER_CHIPS = ["Industry intake", "Leads", "SMS alerts", "Business hours"] as const

/** Fixed line used when you tap “Sample” next to a catalog voice so every voice is compared fairly. */
const VOICE_CATALOG_SAMPLE_LINE =
  "Hi, this is a quick sample of how I will sound when answering your business line."

function buildIntakeBody(
  scriptChoice: "auto" | AiIntakeProfileId,
  aiIntake: {
    busyGreeting: string
    carKeyNotes: string
    lockoutNotes: string
    otherNotes: string
    smsNotify: boolean
  },
  aiAdvanced: { telnyxModel: string; telnyxVoice: string; extraAiInstructions: string }
) {
  return {
    ...(scriptChoice === "auto" ? { followIndustryForAi: true } : { profileId: scriptChoice }),
    busyGreeting: aiIntake.busyGreeting,
    carKeyNotes: aiIntake.carKeyNotes,
    lockoutNotes: aiIntake.lockoutNotes,
    otherNotes: aiIntake.otherNotes,
    smsNotify: aiIntake.smsNotify,
    telnyxModel: aiAdvanced.telnyxModel,
    telnyxVoice: aiAdvanced.telnyxVoice,
    extraAiInstructions: aiAdvanced.extraAiInstructions,
  }
}

export type AiIntakeFlowPanelVariant = "page" | "modal"

export function AiIntakeFlowPanel({
  variant = "page",
  onHasAssistantChange,
  onBusyGreetingSavedToRouting,
  /** Dashboard sets this when /api/routing auto-provisions after choosing AI fallback (panel may not refetch yet). */
  externalAssistantLinked,
  /** True when this panel is shown under “AI receptionist” in Fallback Settings — don’t tell the user to pick AI again. */
  aiNoAnswerSelected,
}: {
  variant?: AiIntakeFlowPanelVariant
  onHasAssistantChange?: (active: boolean) => void
  onBusyGreetingSavedToRouting?: (text: string) => void
  externalAssistantLinked?: boolean
  aiNoAnswerSelected?: boolean
}) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [hasAssistant, setHasAssistant] = useState(false)
  const [userIndustry, setUserIndustry] = useState<string>("generic")
  /** Optional override — Sigo normally creates the voice assistant for you (see Advanced). */
  const [telnyxAssistantId, setTelnyxAssistantId] = useState("")
  /** Show the rare “paste an existing assistant id” field (support / migrations). */
  const [showAdvancedAssistantId, setShowAdvancedAssistantId] = useState(false)
  const [scriptChoice, setScriptChoice] = useState<"auto" | AiIntakeProfileId>("auto")
  const [aiIntake, setAiIntake] = useState({
    busyGreeting: "",
    carKeyNotes: "",
    lockoutNotes: "",
    otherNotes: "",
    smsNotify: true,
  })
  /** Optional LLM / TTS / extra prompt — stored in user_ai_intake.config, synced on save/activate. */
  const [aiAdvanced, setAiAdvanced] = useState({
    telnyxModel: "",
    telnyxVoice: "",
    extraAiInstructions: "",
  })
  const [showAdvancedAi, setShowAdvancedAi] = useState(false)
  const [modelOptions, setModelOptions] = useState<{ id: string }[]>([])
  const [voiceOptions, setVoiceOptions] = useState<{ id: string; label: string }[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  /** Set when voice catalog APIs fail or return an error field (shown under Voice & model). */
  const [catalogError, setCatalogError] = useState<string | null>(null)
  /** True while we are fetching MP3 for “Play preview”. */
  const [previewLoading, setPreviewLoading] = useState(false)
  const modelListId = useId()
  const voiceListId = useId()

  const previewProfileId = useMemo(
    () => (scriptChoice === "auto" ? defaultProfileFromUserIndustry(userIndustry) : scriptChoice),
    [scriptChoice, userIndustry]
  )
  const flow = useMemo(() => getIntakeFlowSummary(previewProfileId), [previewProfileId])
  const showLocksmithExtras = previewProfileId === "locksmith"
  /** True when GET /api/ai-assistant said linked or parent just provisioned via routing. */
  const assistantReady = hasAssistant || Boolean(externalAssistantLinked)
  useEffect(() => {
    if (!aiNoAnswerSelected) return
    let cancelled = false
    fetch("/api/ai-assistant", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.hasAssistant) return
        setHasAssistant(true)
        onHasAssistantChange?.(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // Intentionally omit onHasAssistantChange — parent may pass an inline function and would retrigger every render.
  }, [aiNoAnswerSelected])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetch("/api/auth/session", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/ai-assistant", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([sessionData, aiData]) => {
        if (cancelled) return
        if (!aiData) {
          setLoadError("Could not load saved settings. You can still edit below; try Save again in a moment.")
          return
        }
        setLoadError(null)
        const ind = sessionData?.data?.user?.industry
        if (typeof ind === "string") setUserIndustry(ind)

        const has = Boolean(aiData.hasAssistant)
        setHasAssistant(has)

        const aid = typeof aiData.assistantId === "string" ? aiData.assistantId : ""
        setTelnyxAssistantId(aid)

        const stored = aiData.intakeStored as Record<string, unknown> | null | undefined
        const storedPid = stored && typeof stored.profileId === "string" ? stored.profileId : ""
        if (storedPid && isAiIntakeProfileId(storedPid)) setScriptChoice(storedPid)
        else setScriptChoice("auto")

        const ic = aiData.intakeConfig as
          | {
              busyGreeting?: string
              carKeyNotes?: string
              lockoutNotes?: string
              otherNotes?: string
              smsNotify?: boolean
              telnyxModel?: string
              telnyxVoice?: string
              extraAiInstructions?: string
            }
          | undefined

        if (ic) {
          setAiIntake({
            busyGreeting: (ic.busyGreeting && ic.busyGreeting.trim()) || "",
            carKeyNotes: ic.carKeyNotes || "",
            lockoutNotes: ic.lockoutNotes || "",
            otherNotes: ic.otherNotes || "",
            smsNotify: ic.smsNotify !== false,
          })
          setAiAdvanced({
            telnyxModel: typeof ic.telnyxModel === "string" ? ic.telnyxModel : "",
            telnyxVoice: typeof ic.telnyxVoice === "string" ? ic.telnyxVoice : "",
            extraAiInstructions: typeof ic.extraAiInstructions === "string" ? ic.extraAiInstructions : "",
          })
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!showAdvancedAi) return
    let cancelled = false
    setCatalogLoading(true)
    setCatalogError(null)
    Promise.all([
      fetch("/api/ai-assistant/models", { credentials: "include" }).then(async (r) => ({
        ok: r.ok,
        status: r.status,
        ...(await r.json().catch(() => ({}))),
      })),
      fetch("/api/ai-assistant/voices", { credentials: "include" }).then(async (r) => ({
        ok: r.ok,
        status: r.status,
        ...(await r.json().catch(() => ({}))),
      })),
    ])
      .then(([m, v]) => {
        if (cancelled) return
        setModelOptions(Array.isArray(m.models) ? m.models : [])
        setVoiceOptions(Array.isArray(v.voices) ? v.voices : [])
        const parts: string[] = []
        if (typeof m.error === "string" && m.error.trim()) parts.push(`Models: ${m.error.trim()}`)
        if (typeof v.error === "string" && v.error.trim()) parts.push(`Voices: ${v.error.trim()}`)
        if (!m.ok) parts.push(`Models request failed (HTTP ${m.status}).`)
        if (!v.ok) parts.push(`Voices request failed (HTTP ${v.status}).`)
        setCatalogError(parts.length ? parts.join(" ") : null)
      })
      .catch(() => {
        if (!cancelled) setCatalogError("Could not load model or voice lists. Check your connection and try again.")
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [showAdvancedAi])

  async function handleSave() {
    setSaving(true)
    try {
      const greeting = aiIntake.busyGreeting.trim() || undefined
      const res = await fetch("/api/ai-assistant", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intake: buildIntakeBody(scriptChoice, aiIntake, aiAdvanced),
          greeting,
          // Omit when Advanced is closed so we never wipe a server-created assistant id with an empty string.
          ...(showAdvancedAssistantId ? { telnyxAiAssistantId: telnyxAssistantId.trim() } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: "Could not save", description: String(data.error || res.statusText), variant: "destructive" })
        return
      }
      const syncErr =
        typeof (data as { telnyxSyncError?: unknown }).telnyxSyncError === "string"
          ? String((data as { telnyxSyncError: string }).telnyxSyncError).trim()
          : ""
      const recreated = Boolean((data as { telnyxAssistantRecreated?: unknown }).telnyxAssistantRecreated)
      if (syncErr) {
        toast({
          title: "Saved locally — voice assistant sync failed",
          description: `${displayUserFacingMessage(syncErr)} Fix the error, then Save again before testing calls.`,
          variant: "destructive",
        })
      } else if (recreated) {
        toast({
          title: "Saved — new assistant linked",
          description: displayUserFacingMessage(
            String(data.message || "Your previous voice assistant was missing; we created a new one. Try a test call.")
          ),
        })
      } else {
        toast({
          title: "Saved",
          description: String(data.message || "Call flow and intake settings updated."),
        })
      }
      const g = aiIntake.busyGreeting.trim()
      if (g) onBusyGreetingSavedToRouting?.(g)
      if (telnyxAssistantId.trim()) {
        setHasAssistant(true)
        onHasAssistantChange?.(true)
      } else {
        const fresh = await fetch("/api/ai-assistant", { credentials: "include" }).then((r) =>
          r.ok ? r.json() : null
        )
        if (fresh?.hasAssistant) {
          setHasAssistant(true)
          onHasAssistantChange?.(true)
        }
      }
    } finally {
      setSaving(false)
    }
  }

  /**
   * Ask the server for TTS (cloud MP3 or browser fallback) and play `text` with optional `voiceId`.
   */
  async function runVoicePreview(text: string, voiceId?: string) {
    setPreviewLoading(true)
    try {
      const res = await fetch("/api/ai-assistant/voice-preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice: voiceId?.trim() || undefined,
        }),
      })
      const data = (await res.json().catch(() => null)) as
        | { error?: string; mode?: string; notice?: string; mimeType?: string; base64?: string }
        | null
      if (!res.ok) {
        toast({
          title: "Preview failed",
          description: String(data?.error || res.statusText),
          variant: "destructive",
        })
        return
      }
      if (!data || typeof data !== "object") {
        toast({ title: "Preview failed", description: "Bad response from server.", variant: "destructive" })
        return
      }
      if (data.mode === "browser") {
        if (typeof window === "undefined" || !window.speechSynthesis) {
          toast({
            title: "Preview not available",
            description: "This browser does not support speech preview.",
            variant: "destructive",
          })
          return
        }
        window.speechSynthesis.cancel()
        const utter = new SpeechSynthesisUtterance(text)
        utter.lang = "en-US"
        utter.rate = 0.95
        window.speechSynthesis.speak(utter)
        return
      }
      if (data.mode === "telnyx" && data.base64 && data.mimeType) {
        const bin = atob(data.base64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) {
          bytes[i] = bin.charCodeAt(i)
        }
        const blob = new Blob([bytes], { type: data.mimeType })
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        const revoke = () => URL.revokeObjectURL(url)
        audio.addEventListener("ended", revoke)
        audio.addEventListener("error", revoke)
        await audio.play().catch(() => {
          revoke()
          toast({
            title: "Could not play audio",
            description: "Your browser blocked playback — try again or check sound settings.",
            variant: "destructive",
          })
        })
        return
      }
      toast({ title: "Preview failed", description: "Unexpected response.", variant: "destructive" })
    } finally {
      setPreviewLoading(false)
    }
  }

  /** Preview the opening-line text with the Speaking voice field (or platform default). */
  async function playVoicePreview() {
    const line = aiIntake.busyGreeting.trim() || DEFAULT_BUSY_GREETING_LOCKSMITH
    await runVoicePreview(line, aiAdvanced.telnyxVoice.trim() || undefined)
  }

  /** Preview one catalog voice with a fixed sample sentence so you can compare voices. */
  async function playCatalogVoiceSample(voiceId: string) {
    await runVoicePreview(VOICE_CATALOG_SAMPLE_LINE, voiceId)
  }

  if (loading) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2",
          variant === "page" ? "min-h-[50vh] px-4" : "py-8"
        )}
      >
        <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
        <p className="text-xs text-muted-foreground">Loading call flow…</p>
      </div>
    )
  }

  const inner = (
    <>
      {loadError && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] text-foreground">
          {displayUserFacingMessage(loadError)}
        </div>
      )}

      {/* No voice assistant on file → fallback plays backup voicemail instead of live AI. */}
      {variant === "modal" && aiNoAnswerSelected && !assistantReady && (
        <div className="rounded-xl border border-destructive/45 bg-destructive/10 px-3 py-2.5 text-[11px] leading-snug text-foreground">
          <p className="font-semibold text-destructive">Voice assistant is not linked yet</p>
          <p className="mt-1 text-muted-foreground">
            No-answer calls will sound like voicemail until {SITE_NAME} finishes linking your voice assistant. Tap{" "}
            <span className="font-medium text-foreground">Save call flow</span> below, or toggle fallback off and choose{" "}
            <span className="font-medium text-foreground">AI receptionist</span> again. If this persists, contact {SITE_NAME}
            support — your deployment may need voice API credentials.
          </p>
        </div>
      )}

      {variant === "page" && (
        <div>
          <div className="flex items-center gap-2">
            <IconSurface tone="primary" className="h-10 w-10">
              <Bot className="h-5 w-5 text-primary" />
            </IconSurface>
            <div>
              <h1 className="text-lg font-bold text-foreground">AI call flow</h1>
              <p className="text-[11px] text-muted-foreground">
                Set what the AI says and collects when nobody answers — all in {SITE_NAME}.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 1 — Opening line first (what callers hear) */}
      <section className="space-y-2 rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {variant === "modal" ? "Opening line" : "What callers hear first"}
        </p>
        {variant === "modal" ? (
          <p className="text-[9px] text-muted-foreground">First thing the AI says. Tap Save when you change it.</p>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            Also used when Voice AI answers (default path) or after no-answer if you ring your cell first — synced when you Save.
          </p>
        )}
        <textarea
          value={aiIntake.busyGreeting}
          onChange={(e) => setAiIntake((p) => ({ ...p, busyGreeting: e.target.value }))}
          rows={variant === "modal" ? 3 : 4}
          placeholder={DEFAULT_BUSY_GREETING_LOCKSMITH}
          className="w-full resize-none rounded-xl border border-border/70 bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            disabled={previewLoading}
            onClick={() => void playVoicePreview()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/15 disabled:opacity-50"
          >
            {previewLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Volume2 className="h-3.5 w-3.5" aria-hidden />
            )}
            {previewLoading ? "Loading preview…" : "Play preview"}
          </button>
          <p className="text-[9px] leading-snug text-muted-foreground sm:max-w-[14rem] sm:text-right">
            Preview uses {SITE_NAME}&apos;s cloud voice when available; otherwise your{" "}
            <span className="font-medium text-foreground">browser voice</span>. Live calls use your saved voice assistant
            (see <span className="font-medium text-foreground">Voice &amp; model</span>).
          </p>
        </div>

        {showLocksmithExtras && (
          <>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground">Extra — car keys</label>
              <textarea
                value={aiIntake.carKeyNotes}
                onChange={(e) => setAiIntake((p) => ({ ...p, carKeyNotes: e.target.value }))}
                rows={2}
                className="w-full resize-none rounded-xl border border-border/70 bg-secondary px-3 py-2.5 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground">Extra — lockouts</label>
              <textarea
                value={aiIntake.lockoutNotes}
                onChange={(e) => setAiIntake((p) => ({ ...p, lockoutNotes: e.target.value }))}
                rows={2}
                className="w-full resize-none rounded-xl border border-border/70 bg-secondary px-3 py-2.5 text-sm"
              />
            </div>
          </>
        )}

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-muted-foreground">Extra notes — all scripts</label>
          <textarea
            value={aiIntake.otherNotes}
            onChange={(e) => setAiIntake((p) => ({ ...p, otherNotes: e.target.value }))}
            rows={variant === "modal" ? 2 : 2}
            placeholder="Optional notes for the AI script"
            className="w-full resize-none rounded-xl border border-border/70 bg-secondary px-3 py-2.5 text-sm"
          />
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border/70 bg-secondary/35 px-3 py-2.5">
          <div>
            <p className="text-xs font-semibold text-foreground">Text me new leads</p>
            <p className="text-[10px] text-muted-foreground">SMS when a lead is saved (if messaging is enabled).</p>
          </div>
          <Switch
            checked={aiIntake.smsNotify}
            onCheckedChange={(v) => setAiIntake((p) => ({ ...p, smsNotify: v }))}
            aria-label="SMS lead notifications"
          />
        </div>
      </section>

      {/* 2 — Industry / playbook */}
      <section className="space-y-3 rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {variant === "modal" ? "Industry script" : "Playbook (reference)"}
        </p>
        {variant !== "modal" ? (
          <p className="text-[10px] text-muted-foreground">
            We send this as instructions when you Save (plus your opening line above).
          </p>
        ) : null}
        <select
          value={scriptChoice}
          onChange={(e) => {
            const v = e.target.value
            setScriptChoice(v === "auto" ? "auto" : (v as AiIntakeProfileId))
          }}
          className="w-full rounded-xl border border-border/70 bg-secondary px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
        >
          <option value="auto">Auto — match my industry ({industryLabel(userIndustry)})</option>
          {AI_INTAKE_PROFILE_IDS.map((id) => (
            <option key={id} value={id}>
              {INDUSTRY_CATALOG.find((r) => r.id === id)?.label ?? id}
            </option>
          ))}
        </select>

        {variant === "modal" ? (
          <details className="rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-[10px] text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">Flow outline — {flow.label}</summary>
            <p className="mt-2 leading-relaxed">{flow.goal}</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              {flow.branches.map((b) => (
                <li key={b.intent_slug}>
                  <span className="font-medium text-foreground">{b.title}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <>
            <div className="rounded-xl bg-primary/5 px-3 py-2">
              <p className="text-[10px] font-medium text-primary">Flow preview — {flow.label}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{flow.goal}</p>
            </div>
            <div className="space-y-2">
              {flow.branches.map((b, idx) => (
                <div
                  key={`${b.intent_slug}-${idx}`}
                  className="rounded-xl border border-border/60 bg-secondary/40 px-3 py-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-foreground">{b.title}</p>
                    <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                      {b.intent_slug}
                    </span>
                  </div>
                  <ul className="mt-2 list-inside list-disc space-y-0.5 text-[11px] text-muted-foreground">
                    {b.bullets.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* 3 — Optional voice/model */}
      <section className="space-y-3 rounded-2xl border border-border/70 bg-card/80 p-4 shadow-sm">
        <button
          type="button"
          onClick={() => setShowAdvancedAi((v) => !v)}
          className="flex w-full items-start justify-between gap-2 text-left"
        >
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Voice &amp; model {variant === "modal" ? "" : "(optional)"}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Skip unless you need a specific AI model or voice.</p>
          </div>
          <ChevronDown
            className={cn("mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform", showAdvancedAi && "rotate-180")}
            aria-hidden
          />
        </button>
        {showAdvancedAi && (
          <div className="space-y-3 border-t border-border/60 pt-3">
            {catalogLoading ? (
              <p className="text-[10px] text-muted-foreground">Loading suggestions…</p>
            ) : null}
            {catalogError ? (
              <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive">
                {displayUserFacingMessage(catalogError)}
              </p>
            ) : null}
            {!catalogLoading && !catalogError ? (
              <p className="text-[10px] text-muted-foreground">
                Suggestions use your browser&apos;s datalist:{" "}
                <span className="font-semibold text-foreground">click the field</span>, then use the dropdown arrow (if
                shown) or start typing — some browsers hide the list until you focus the box. You can always paste a
                voice id manually.
              </p>
            ) : null}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground" htmlFor={`${modelListId}-input`}>
                LLM model
              </label>
              <input
                id={`${modelListId}-input`}
                type="text"
                list={modelListId}
                value={aiAdvanced.telnyxModel}
                onChange={(e) => setAiAdvanced((p) => ({ ...p, telnyxModel: e.target.value }))}
                placeholder="Platform default if empty"
                className="w-full rounded-xl border border-border/70 bg-secondary px-3 py-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                autoComplete="off"
              />
              <datalist id={modelListId}>
                {modelOptions.map((m) => (
                  <option key={m.id} value={m.id} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground" htmlFor={`${voiceListId}-input`}>
                Speaking voice
              </label>
              <input
                id={`${voiceListId}-input`}
                type="text"
                list={voiceListId}
                value={aiAdvanced.telnyxVoice}
                onChange={(e) => setAiAdvanced((p) => ({ ...p, telnyxVoice: e.target.value }))}
                placeholder="Platform default if empty"
                className="w-full rounded-xl border border-border/70 bg-secondary px-3 py-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                autoComplete="off"
              />
              <datalist id={voiceListId}>
                {voiceOptions.map((v) => (
                  <option key={v.id} value={v.id} label={v.label} />
                ))}
              </datalist>
              {!catalogLoading && voiceOptions.length > 0 ? (
                <div className="mt-2 space-y-1.5 rounded-xl border border-border/60 bg-secondary/30 p-2">
                  <p className="text-[9px] font-medium text-muted-foreground">
                    Review voices — same sample line for each (cloud preview when available; else browser).
                  </p>
                  <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
                    {voiceOptions.slice(0, 50).map((v) => (
                      <li
                        key={v.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-card/60 px-2 py-1.5 text-[10px]"
                      >
                        <span className="min-w-0 truncate font-mono text-[9px] text-foreground" title={v.id}>
                          {v.label || v.id}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            disabled={previewLoading}
                            onClick={() => void playCatalogVoiceSample(v.id)}
                            className="rounded-md border border-primary/35 bg-primary/10 px-2 py-0.5 text-[9px] font-semibold text-primary hover:bg-primary/15 disabled:opacity-50"
                          >
                            Sample
                          </button>
                          <button
                            type="button"
                            onClick={() => setAiAdvanced((p) => ({ ...p, telnyxVoice: v.id }))}
                            className="rounded-md border border-border/70 px-2 py-0.5 text-[9px] font-semibold text-muted-foreground hover:bg-muted/50"
                          >
                            Use
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {voiceOptions.length > 50 ? (
                    <p className="text-[9px] text-muted-foreground">Showing first 50 — type in the box to find more.</p>
                  ) : null}
                </div>
              ) : null}
            </div>
            {!catalogLoading && modelOptions.length === 0 && voiceOptions.length === 0 && !catalogError ? (
              <p className="text-[10px] text-muted-foreground">
                No suggestions loaded — leave both fields empty for {SITE_NAME}&apos;s platform defaults, or type e.g.{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[9px]">openai/gpt-4o</code> and a voice id
                from your provider, then Save.
              </p>
            ) : null}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-muted-foreground">Extra instructions</label>
              <textarea
                value={aiAdvanced.extraAiInstructions}
                onChange={(e) => setAiAdvanced((p) => ({ ...p, extraAiInstructions: e.target.value }))}
                rows={variant === "modal" ? 3 : 4}
                placeholder="Policies, tone, languages…"
                className="w-full resize-none rounded-xl border border-border/70 bg-secondary px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              />
            </div>
            <p className="text-[9px] text-muted-foreground">
              Rare: use Support → link assistant ID at the bottom of this screen instead of {SITE_NAME}&apos;s auto-created one.
            </p>
          </div>
        )}
      </section>

      {variant === "modal" ? (
        <div className="border-t border-border pt-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Saving…" : "Save call flow"}
          </button>
        </div>
      ) : null}

      {/* Status, support, tiny tags — after Save in modal so setup + save stay on top */}
      <div className="space-y-2 border-t border-border/60 pt-3">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
          {assistantReady ? (
            <span className="font-semibold text-success">AI ready</span>
          ) : aiNoAnswerSelected ? (
            <span>Tap Save above to apply changes</span>
          ) : (
            <span>Choose AI receptionist in Fallback Settings on the dashboard first</span>
          )}
          {assistantReady && telnyxAssistantId.trim() ? (
            <span className="break-all font-mono text-[9px] opacity-80" title="For support">
              {telnyxAssistantId.trim()}
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setShowAdvancedAssistantId((v) => !v)}
          className="text-[10px] font-medium text-primary underline-offset-2 hover:underline"
        >
          {showAdvancedAssistantId ? "Hide" : "Support — link a different assistant ID"}
        </button>
        {showAdvancedAssistantId && (
          <div className="space-y-1.5 rounded-lg border border-border/60 bg-secondary/40 p-2">
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Only if support gave you an ID to use. Leave empty otherwise.
            </p>
            <input
              type="text"
              value={telnyxAssistantId}
              onChange={(e) => setTelnyxAssistantId(e.target.value)}
              placeholder="Paste ID if support told you to"
              className="w-full rounded-xl border border-border/70 bg-secondary px-3 py-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
              autoComplete="off"
            />
          </div>
        )}
        {variant === "modal" ? (
          <div className="flex flex-wrap gap-1 pt-1">
            {VOICE_AI_FOOTER_CHIPS.map((c) => (
              <span key={c} className="rounded-full bg-muted/80 px-2 py-0.5 text-[9px] text-muted-foreground">
                {c}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </>
  )

  if (variant === "page") {
    return (
      <div className="mx-auto max-w-lg space-y-5 px-4 py-6 pb-28">
        {inner}
        <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 border-t border-border bg-background/95 px-4 py-3 backdrop-blur-md">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Saving…" : "Save call flow"}
          </button>
        </div>
      </div>
    )
  }

  return <div className="space-y-4">{inner}</div>
}
