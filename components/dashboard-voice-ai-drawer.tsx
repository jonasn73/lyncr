"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Loader2, Volume2, Play } from "lucide-react"
import { DrawerAutoGrowTextarea, DrawerStickyFooter } from "@/components/dashboard-routing-drawer-shared"
import { submitFormEvent } from "@/lib/form-keyboard"
import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { displayUserFacingMessage } from "@/lib/porting-display"
import { DEFAULT_BUSY_GREETING_LOCKSMITH } from "@/lib/ai-intake-defaults"
import { ONBOARDING_DEFAULT_VOICEMAIL_GREETING } from "@/lib/onboarding-ai-trade-scripts"
import { isAiIntakeProfileId, type AiIntakeProfileId } from "@/lib/business-industries"
import type { Contact, FallbackOption } from "@/lib/dashboard-routing-utils"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import { IvrGreetingsSettingsForm } from "@/components/dashboard/ivr-greetings-settings-form"

const PROMPT_PLACEHOLDER =
  "Example: You are the front-desk receptionist for a premium service company. Professionally greet the caller, ask how we can help, collect their name and problem, and let them know a technician will call them right back..."

const VOICE_PERSONAS = [
  {
    id: "nova",
    label: "Nova",
    tagline: "Professional / Crisp",
    voiceIds: ["Telnyx.Natural.abbie", "Telnyx.NaturalHD.abbie", "nova"],
  },
  {
    id: "echo",
    label: "Echo",
    tagline: "Technical / Direct",
    voiceIds: ["Telnyx.Natural.hd-male", "Telnyx.NaturalHD.male", "echo"],
  },
  {
    id: "onyx",
    label: "Onyx",
    tagline: "Warm / Steady",
    voiceIds: ["Telnyx.Natural.aiden", "Telnyx.NaturalHD.aiden", "onyx"],
  },
] as const

type PersonaId = (typeof VOICE_PERSONAS)[number]["id"]

type PostAiRoute = "owner_phone" | "voicemail" | "team"

const POST_AI_OPTIONS: { value: PostAiRoute; label: string }[] = [
  { value: "owner_phone", label: "Route call back to my phone" },
  { value: "voicemail", label: "Send straight to traditional voicemail" },
  { value: "team", label: "Forward to backup team matrix" },
]

const fieldClass =
  "w-full rounded-lg border border-zinc-800 bg-zinc-900/50 text-sm text-foreground transition-colors duration-200 placeholder:text-zinc-600 hover:border-zinc-600 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500/40"

function personaFromVoiceId(voiceId: string): PersonaId {
  const v = voiceId.trim().toLowerCase()
  if (!v) return "nova"
  for (const p of VOICE_PERSONAS) {
    if (p.voiceIds.some((id) => v.includes(id.toLowerCase().split(".").pop() ?? "") || v === id.toLowerCase())) {
      return p.id
    }
  }
  if (v.includes("male") || v.includes("echo")) return "echo"
  if (v.includes("aiden") || v.includes("onyx") || v.includes("warm")) return "onyx"
  return "nova"
}

function voiceIdForPersona(persona: PersonaId, catalog: { id: string }[]): string {
  const preset = VOICE_PERSONAS.find((p) => p.id === persona)
  if (!preset) return ""
  for (const hint of preset.voiceIds) {
    const hit = catalog.find((c) => c.id.toLowerCase() === hint.toLowerCase() || c.id.toLowerCase().includes(hint.toLowerCase()))
    if (hit) return hit.id
  }
  return preset.voiceIds[0] ?? ""
}

function WaveformBars({ active }: { active: boolean }) {
  const heights = [0.35, 0.55, 0.85, 1, 0.7, 0.9, 0.5, 0.75, 0.45, 0.65, 0.8, 0.4]
  return (
    <div className="flex h-10 flex-1 items-end justify-center gap-[3px] px-2" aria-hidden>
      {heights.map((h, i) => (
        <div
          key={i}
          className={cn(
            "w-[3px] rounded-full bg-primary/70 transition-[height,opacity] duration-300",
            active && "animate-pulse"
          )}
          style={{ height: `${Math.round(h * 100)}%`, animationDelay: active ? `${i * 45}ms` : undefined }}
        />
      ))}
    </div>
  )
}

export type DashboardVoiceAiDrawerProps = {
  fallback: FallbackOption
  setFallback: (f: FallbackOption) => void
  aiRingOwnerFirst: boolean
  setAiRingOwnerFirst: (v: boolean) => void
  saveRouting: (updates: Record<string, unknown>, opts?: { quiet?: boolean }) => Promise<void>
  onClose: () => void
  onRegisterDiscard?: (discard: () => void) => void
  onHasAssistantChange: (active: boolean) => void
  isRoutingToOwner: boolean
  selectedReceptionist: Contact | null
  routingBusinessNumber: string | null
}

export function DashboardVoiceAiDrawer({
  fallback,
  setFallback,
  aiRingOwnerFirst,
  setAiRingOwnerFirst,
  saveRouting,
  onClose,
  onRegisterDiscard,
  onHasAssistantChange,
  isRoutingToOwner,
  selectedReceptionist,
  routingBusinessNumber,
}: DashboardVoiceAiDrawerProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [voiceCatalog, setVoiceCatalog] = useState<{ id: string }[]>([])

  const [aiEnabled, setAiEnabled] = useState(fallback === "ai")
  const [bufferedScript, setBufferedScript] = useState("")
  const [openingLine, setOpeningLine] = useState("")
  const [bufferedVoice, setBufferedVoice] = useState<PersonaId>("nova")
  const [postAiRoute, setPostAiRoute] = useState<PostAiRoute>("owner_phone")
  const [userIndustry, setUserIndustry] = useState("generic")
  const [scriptChoice, setScriptChoice] = useState<"auto" | AiIntakeProfileId>("auto")
  const [intakeNotes, setIntakeNotes] = useState({
    carKeyNotes: "",
    lockoutNotes: "",
    otherNotes: "",
    smsNotify: true,
  })

  const baselineRef = useRef<string>("")
  const snapshot = useCallback(
    () =>
      JSON.stringify({
        aiEnabled,
        bufferedScript,
        openingLine,
        bufferedVoice,
        postAiRoute,
        fallback,
        aiRingOwnerFirst,
      }),
    [aiEnabled, bufferedScript, openingLine, bufferedVoice, postAiRoute, fallback, aiRingOwnerFirst]
  )

  const dirty = snapshot() !== baselineRef.current

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetch("/api/auth/session", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/ai-assistant", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/api/ai-assistant/voices", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([sessionData, aiData, voiceData]) => {
        if (cancelled) return
        const ind = sessionData?.data?.user?.industry
        if (typeof ind === "string") setUserIndustry(ind)

        const voices = Array.isArray(voiceData?.voices) ? voiceData.voices : []
        setVoiceCatalog(voices.map((v: { id?: string }) => ({ id: String(v.id ?? "") })).filter((v) => v.id))

        const ic = aiData?.intakeConfig as Record<string, unknown> | undefined
        const stored = aiData?.intakeStored as Record<string, unknown> | undefined
        const storedPid = stored && typeof stored.profileId === "string" ? stored.profileId : ""
        if (storedPid && isAiIntakeProfileId(storedPid)) setScriptChoice(storedPid)
        else setScriptChoice("auto")

        const prompt = typeof ic?.extraAiInstructions === "string" ? ic.extraAiInstructions : ""
        const greeting = typeof ic?.busyGreeting === "string" && ic.busyGreeting.trim() ? ic.busyGreeting : ""
        const voice = typeof ic?.telnyxVoice === "string" ? ic.telnyxVoice : ""
        const defaultOpening =
          fallback === "voicemail" ? ONBOARDING_DEFAULT_VOICEMAIL_GREETING : DEFAULT_BUSY_GREETING_LOCKSMITH

        setBufferedScript(prompt)
        setOpeningLine(greeting || defaultOpening)
        setBufferedVoice(personaFromVoiceId(voice))
        setIntakeNotes({
          carKeyNotes: typeof ic?.carKeyNotes === "string" ? ic.carKeyNotes : "",
          lockoutNotes: typeof ic?.lockoutNotes === "string" ? ic.lockoutNotes : "",
          otherNotes: typeof ic?.otherNotes === "string" ? ic.otherNotes : "",
          smsNotify: ic?.smsNotify !== false,
        })

        const enabled = fallback === "ai"
        setAiEnabled(enabled)
        if (fallback === "voicemail") setPostAiRoute("voicemail")
        else if (!enabled && !isRoutingToOwner && selectedReceptionist) setPostAiRoute("team")
        else if (aiRingOwnerFirst) setPostAiRoute("owner_phone")
        else setPostAiRoute("team")

        baselineRef.current = JSON.stringify({
          aiEnabled: enabled,
          bufferedScript: prompt,
          openingLine: greeting || defaultOpening,
          bufferedVoice: personaFromVoiceId(voice),
          postAiRoute:
            fallback === "voicemail"
              ? "voicemail"
              : aiRingOwnerFirst
                ? "owner_phone"
                : !isRoutingToOwner && selectedReceptionist
                  ? "team"
                  : "owner_phone",
          fallback,
          aiRingOwnerFirst,
        })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fallback, aiRingOwnerFirst, isRoutingToOwner, selectedReceptionist])

  const tokenEstimate = useMemo(() => Math.max(1, Math.ceil(bufferedScript.length / 4)), [bufferedScript])

  const discardEdits = useCallback(() => {
    try {
      const saved = JSON.parse(baselineRef.current) as {
        aiEnabled: boolean
        bufferedScript: string
        openingLine: string
        bufferedVoice: PersonaId
        postAiRoute: PostAiRoute
        fallback: FallbackOption
        aiRingOwnerFirst: boolean
      }
      setAiEnabled(saved.aiEnabled)
      setBufferedScript(saved.bufferedScript)
      setOpeningLine(saved.openingLine)
      setBufferedVoice(saved.bufferedVoice)
      setPostAiRoute(saved.postAiRoute)
      setFallback(saved.fallback)
      setAiRingOwnerFirst(saved.aiRingOwnerFirst)
    } catch {
      /* keep current buffer if parse fails */
    }
  }, [setFallback, setAiRingOwnerFirst])

  useEffect(() => {
    onRegisterDiscard?.(discardEdits)
  }, [onRegisterDiscard, discardEdits])

  async function runVoicePreview(text: string, voiceId?: string) {
    setPreviewLoading(true)
    try {
      const res = await fetch("/api/ai-assistant/voice-preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: voiceId?.trim() || undefined }),
      })
      const data = (await res.json().catch(() => null)) as {
        error?: string
        mode?: string
        mimeType?: string
        base64?: string
      } | null
      if (!res.ok) {
        toast({
          title: "Preview failed",
          description: String(data?.error || res.statusText),
          variant: "destructive",
        })
        return
      }
      if (data?.mode === "browser" && typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel()
        const utter = new SpeechSynthesisUtterance(text)
        utter.lang = "en-US"
        window.speechSynthesis.speak(utter)
        return
      }
      if (data?.mode === "telnyx" && data.base64 && data.mimeType) {
        const bin = atob(data.base64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const url = URL.createObjectURL(new Blob([bytes], { type: data.mimeType }))
        const audio = new Audio(url)
        const revoke = () => URL.revokeObjectURL(url)
        audio.addEventListener("ended", revoke)
        audio.addEventListener("error", revoke)
        await audio.play().catch(() => revoke())
      }
    } finally {
      setPreviewLoading(false)
    }
  }

  function applyPostAiRoute(route: PostAiRoute) {
    setPostAiRoute(route)
    if (route === "voicemail") {
      setAiEnabled(false)
      setFallback("voicemail")
    } else if (route === "owner_phone") {
      setAiEnabled(true)
      setFallback("ai")
      setAiRingOwnerFirst(true)
    } else {
      setAiEnabled(true)
      setFallback("ai")
      setAiRingOwnerFirst(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const greeting = openingLine.trim() || undefined
      const telnyxVoice = voiceIdForPersona(bufferedVoice, voiceCatalog)

      if (aiEnabled) {
        setFallback("ai")
        await saveRouting({
          fallback_type: "ai",
          ai_greeting: greeting ?? "",
          ai_ring_owner_first: postAiRoute === "owner_phone",
        })
      } else if (postAiRoute === "voicemail") {
        setFallback("voicemail")
        await saveRouting({ fallback_type: "voicemail", ai_greeting: greeting ?? "" })
      } else {
        await saveRouting({ fallback_type: fallback, ai_greeting: greeting ?? "" })
      }

      const res = await fetch("/api/ai-assistant", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intake: {
            ...(scriptChoice === "auto"
              ? { followIndustryForAi: true }
              : { profileId: scriptChoice }),
            busyGreeting: openingLine.trim(),
            carKeyNotes: intakeNotes.carKeyNotes,
            lockoutNotes: intakeNotes.lockoutNotes,
            otherNotes: intakeNotes.otherNotes,
            smsNotify: intakeNotes.smsNotify,
            telnyxVoice,
            telnyxModel: "",
            extraAiInstructions: bufferedScript.trim(),
          },
          greeting,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: "Could not deploy", description: String(data.error || res.statusText), variant: "destructive" })
        return
      }
      const syncErr =
        typeof data.telnyxSyncError === "string" ? String(data.telnyxSyncError).trim() : ""
      if (syncErr) {
        toast({
          title: "Saved locally — sync pending",
          description: displayUserFacingMessage(syncErr),
          variant: "destructive",
        })
      } else {
        toast({ title: "Saved & deployed", description: "Voice AI settings are live for your line." })
      }
      if (data?.hasAssistant) onHasAssistantChange(true)
      baselineRef.current = snapshot()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16">
        <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden />
        <p className="text-xs text-zinc-500">Loading voice settings…</p>
      </div>
    )
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        submitFormEvent(e)
        if (!saving) void handleSave()
      }}
    >
      <header className="shrink-0 border-b border-zinc-800/80 bg-gradient-to-b from-zinc-900/80 to-transparent px-6 pb-5 pt-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Step 4 · Voice &amp; AI</p>
        <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">Voice &amp; AI Settings</h2>
        <p className="mt-1.5 max-w-md text-sm leading-relaxed text-zinc-500">
          Configure your automated front-desk receptionist and inbound greeting routing.
        </p>
        {routingBusinessNumber ? (
          <p className="mt-2 text-[11px] text-zinc-600">Line {formatPhoneDisplay(routingBusinessNumber)}</p>
        ) : null}

        <div
          className={cn(
            "mt-5 flex items-center justify-between gap-4 rounded-xl border px-4 py-3.5 transition-shadow duration-200",
            aiEnabled
              ? "border-primary/50 bg-primary/10 shadow-[0_0_24px_-6px_var(--primary)]"
              : "border-zinc-800 bg-zinc-900/40"
          )}
        >
          <div className="min-w-0">
            <label htmlFor="dash-ai-enable" className="text-sm font-semibold text-foreground">
              Enable AI Receptionist
            </label>
            <p className="mt-0.5 text-[11px] text-zinc-500">Answers when your team does not pick up in time.</p>
          </div>
          <Switch
            id="dash-ai-enable"
            checked={aiEnabled}
            onCheckedChange={(on) => {
              setAiEnabled(on)
              if (on) {
                setFallback("ai")
                if (postAiRoute === "voicemail") setPostAiRoute("owner_phone")
              } else {
                setFallback(postAiRoute === "voicemail" ? "voicemail" : "owner")
              }
            }}
            className="shrink-0 data-[state=checked]:bg-primary data-[state=checked]:shadow-[0_0_14px_-2px_var(--primary)]"
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6">
        <div className="mb-8">
          <IvrGreetingsSettingsForm routingBusinessNumber={routingBusinessNumber} />
        </div>
        <VoiceAiDrawerBody
          bufferedScript={bufferedScript}
          setBufferedScript={setBufferedScript}
          tokenEstimate={tokenEstimate}
          previewLoading={previewLoading}
          onTestScript={() =>
            void runVoicePreview(
              bufferedScript.trim().slice(0, 280) || openingLine.trim() || DEFAULT_BUSY_GREETING_LOCKSMITH,
              voiceIdForPersona(bufferedVoice, voiceCatalog)
            )
          }
          bufferedVoice={bufferedVoice}
          setBufferedVoice={setBufferedVoice}
          openingLine={openingLine}
          setOpeningLine={setOpeningLine}
          previewActive={Boolean(openingLine.trim()) || previewLoading}
          onPreviewOpening={() =>
            void runVoicePreview(
              openingLine.trim() || DEFAULT_BUSY_GREETING_LOCKSMITH,
              voiceIdForPersona(bufferedVoice, voiceCatalog)
            )
          }
          postAiRoute={postAiRoute}
          applyPostAiRoute={applyPostAiRoute}
          aiEnabled={aiEnabled}
          selectedReceptionist={selectedReceptionist}
        />
      </div>

      <DrawerStickyFooter
        dirty={dirty}
        saving={saving}
        onSave={() => void handleSave()}
        onCancel={() => {
          discardEdits()
          onClose()
        }}
        saveLabel="Save & Deploy"
        saveAsSubmit
      />
    </form>
  )
}

function VoiceAiDrawerBody({
  bufferedScript,
  setBufferedScript,
  tokenEstimate,
  previewLoading,
  onTestScript,
  bufferedVoice,
  setBufferedVoice,
  openingLine,
  setOpeningLine,
  previewActive,
  onPreviewOpening,
  postAiRoute,
  applyPostAiRoute,
  aiEnabled,
  selectedReceptionist,
}: {
  bufferedScript: string
  setBufferedScript: (v: string) => void
  tokenEstimate: number
  previewLoading: boolean
  onTestScript: () => void
  bufferedVoice: PersonaId
  setBufferedVoice: (p: PersonaId) => void
  openingLine: string
  setOpeningLine: (v: string) => void
  previewActive: boolean
  onPreviewOpening: () => void
  postAiRoute: PostAiRoute
  applyPostAiRoute: (r: PostAiRoute) => void
  aiEnabled: boolean
  selectedReceptionist: Contact | null
}) {
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <label htmlFor="dash-ai-prompt" className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            AI Assistant Instructions (System Prompt)
          </label>
          <PromptMetaActions tokenEstimate={tokenEstimate} previewLoading={previewLoading} onTestScript={onTestScript} />
        </div>
        <DrawerAutoGrowTextarea
          id="dash-ai-prompt"
          value={bufferedScript}
          onChange={(e) => setBufferedScript(e.target.value)}
          placeholder={PROMPT_PLACEHOLDER}
        />
      </section>

      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Voice Personality</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {VOICE_PERSONAS.map((v) => {
            const active = bufferedVoice === v.id
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setBufferedVoice(v.id)}
                className={cn(
                  "relative rounded-xl border px-3 py-3.5 text-left transition-[border-color,background-color] duration-200",
                  active
                    ? "border-primary/60 bg-primary/10 shadow-[0_0_20px_-8px_var(--primary)]"
                    : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-600"
                )}
              >
                {active ? (
                  <span className="absolute right-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary-foreground">
                    Live
                  </span>
                ) : null}
                <p className="text-sm font-semibold text-foreground">{v.label}</p>
                <p className="mt-0.5 text-[11px] text-zinc-500">{v.tagline}</p>
              </button>
            )
          })}
        </div>
      </section>

      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Opening Line Preview</p>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <input
            type="text"
            value={openingLine}
            onChange={(e) => setOpeningLine(e.target.value)}
            className={cn(fieldClass, "mb-3 px-3 py-2")}
            aria-label="Opening greeting line"
          />
          <div className="flex items-center gap-3 rounded-lg border border-zinc-800/80 bg-zinc-950/60 px-3 py-2.5">
            <WaveformBars active={previewActive} />
            <button
              type="button"
              onClick={onPreviewOpening}
              disabled={previewLoading}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/15 text-primary transition-colors hover:bg-primary/25 disabled:opacity-50"
              aria-label="Play opening line preview"
            >
              {previewLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Play className="h-4 w-4 fill-current" aria-hidden />
              )}
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <label htmlFor="dash-post-ai" className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          If AI Cannot Resolve / Hangs Up
        </label>
        <select
          id="dash-post-ai"
          value={postAiRoute}
          onChange={(e) => applyPostAiRoute(e.target.value as PostAiRoute)}
          className={cn(fieldClass, "appearance-none px-3 py-2.5")}
        >
          {POST_AI_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {postAiRoute === "team" && selectedReceptionist ? (
          <p className="text-[11px] text-zinc-500">
            Team routing uses <span className="font-medium text-zinc-400">{selectedReceptionist.name}</span> from Step 2.
          </p>
        ) : postAiRoute === "team" ? (
          <p className="text-[11px] text-zinc-500">
            Add teammates in{" "}
            <Link href="/dashboard/contacts" className="font-medium text-primary underline-offset-2 hover:underline">
              Team
            </Link>{" "}
            and set who answers in Step 2.
          </p>
        ) : null}
      </section>
    </div>
  )
}

function PromptMetaActions({
  tokenEstimate,
  previewLoading,
  onTestScript,
}: {
  tokenEstimate: number
  previewLoading: boolean
  onTestScript: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] tabular-nums text-zinc-600">~{tokenEstimate} tokens</span>
      <button
        type="button"
        onClick={onTestScript}
        disabled={previewLoading}
        className="inline-flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-[10px] font-semibold text-zinc-400 transition-colors duration-200 hover:border-primary/40 hover:text-primary disabled:opacity-50"
      >
        {previewLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Volume2 className="h-3 w-3" aria-hidden />}
        Test script
      </button>
    </div>
  )
}

