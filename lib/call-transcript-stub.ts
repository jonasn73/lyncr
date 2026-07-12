// Background stub: inject AI transcript draft into intake / job notes on disconnect.

import {
  loadIntakeDraft,
  saveIntakeDraft,
} from "@/lib/intake-draft-storage"

/** Placeholder operational bullet written when a call ends with an open intake draft. */
export const AI_TRANSCRIPT_DRAFT_BULLET =
  "🤖 [AI Transcript Draft Summary]: Customer reports..."

/** True when notes already contain our stub marker (avoid duplicates). */
export function notesIncludeAiTranscriptDraft(notes: string): boolean {
  return notes.includes("[AI Transcript Draft Summary]")
}

/** Append the AI transcript placeholder to internal notes (idempotent). */
export function appendAiTranscriptDraftToNotes(existingNotes: string): string {
  if (notesIncludeAiTranscriptDraft(existingNotes)) return existingNotes
  const trimmed = existingNotes.trim()
  return trimmed ? `${trimmed}\n\n${AI_TRANSCRIPT_DRAFT_BULLET}` : AI_TRANSCRIPT_DRAFT_BULLET
}

/**
 * When a call disconnects with an active intake draft, inject the AI summary stub
 * into the draft's notes. Optionally PATCHes a matching open job in the background.
 */
export function injectAiTranscriptOnCallDisconnect(fromNumber: string): boolean {
  const phone = String(fromNumber ?? "").trim()
  if (!phone) return false

  const draft = loadIntakeDraft(phone)
  if (!draft) return false

  const nextNotes = appendAiTranscriptDraftToNotes(draft.form.notes)
  if (nextNotes === draft.form.notes) return false

  saveIntakeDraft(phone, {
    form: { ...draft.form, notes: nextNotes },
    currentStep: draft.currentStep,
    customPrice: draft.customPrice,
    failureReason: draft.failureReason,
    recoveredViaRouteDiscount: draft.recoveredViaRouteDiscount,
    negotiationStep: draft.negotiationStep,
  })

  // Background job notes sync — best-effort; never blocks disconnect handling.
  void patchOpenJobNotesWithTranscript(phone, nextNotes)

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("lyncr-ai-transcript-injected", {
        detail: { phone, notes: nextNotes },
      })
    )
  }

  return true
}

async function patchOpenJobNotesWithTranscript(phone: string, notes: string): Promise<void> {
  try {
    const res = await fetch(
      `/api/owner/scheduler/lookup?phone=${encodeURIComponent(phone)}`,
      { credentials: "include", cache: "no-store" }
    )
    if (!res.ok) return
    const json = (await res.json()) as {
      data?: {
        pool?: Array<{ id: string; customer_name?: string | null; customer_phone?: string | null }>
        scheduled?: Array<{
          id: string
          customer_name?: string | null
          customer_phone?: string | null
          job_notes?: string | null
        }>
      }
    }
    const scheduled = json.data?.scheduled?.[0]
    const pool = json.data?.pool?.[0]
    const job = scheduled ?? pool
    if (!job?.id) return

    await fetch(`/api/owner/scheduler/${job.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customer_name: job.customer_name ?? null,
        customer_phone: job.customer_phone ?? phone,
        job_notes: notes,
      }),
    })
  } catch {
    /* stub pipe — ignore network failures */
  }
}
