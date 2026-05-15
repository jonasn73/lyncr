"use client"

import type { ReactNode } from "react"
import Link from "next/link"

export type AppSheetStory = {
  eyebrow: string
  storyline: string
  title: string
  description: ReactNode
}

const dash = "/dashboard"

/** Member-facing story copy for Settings + Help — who answers, backup, voice layer. */
export const APP_SHEET_STORIES: Record<string, AppSheetStory> = {
  "profile-overview": {
    eyebrow: "Settings story",
    storyline: "This card is your business identity on the phone network: who you are, where calls land first, and what teammates hear when they pick up.",
    title: "Owner profile & main line",
    description: (
      <>
        <p>
          Zing&apos;s promise is simple: <strong>one business number</strong>, you choose{" "}
          <strong>who rings first</strong> (you or your team), then a clear <strong>backup</strong> (cell, AI, voicemail).
        </p>
        <p className="mt-2">
          Everything here supports that story — your <strong>main line</strong> is the default pocket your calls reach
          when no receptionist is assigned for a line.
        </p>
      </>
    ),
  },
  "main-line": {
    eyebrow: "Routing story",
    storyline: "Your cell (or desk phone) in E.164 is the safety net destination for forwarded legs.",
    title: "Main line number",
    description: (
      <>
        <p>
          When a customer dials your <strong>business number</strong>, we forward the call to the person or queue you
          picked on the <strong>Routing</strong> tab. If routing says &quot;your phone,&quot; this main line is where that ring
          lands.
        </p>
        <p className="mt-2">
          Keeping it accurate prevents missed rings and makes fallbacks predictable when you change who is on call.
        </p>
      </>
    ),
  },
  "industry-ai": {
    eyebrow: "Voice layer",
    storyline: "Industry nudges the AI receptionist’s default script when you use Auto playbook — not the live human routing order.",
    title: "Industry & AI script",
    description: (
      <>
        <p>
          If you set <strong>AI receptionist</strong> as the no-answer path, callers may hit questions tuned to your trade
          (e.g. locksmith vs salon). That reduces awkward generic prompts.
        </p>
        <p className="mt-2">
          Human routing (who rings first) still lives under <strong>Routing</strong> and per-line settings — industry does not
          replace that.
        </p>
      </>
    ),
  },
  "account-business-name": {
    eyebrow: "Trust on the wire",
    storyline: "Carriers and devices show this name on some forwarded legs — it is part of spam-scoring and caller trust.",
    title: "Account business name",
    description: (
      <>
        <p>
          This name can appear as the <strong>display name</strong> on outbound forwarded calls when your carrier
          supports it, and it is spoken first in the optional <strong>team whisper</strong> so staff know which brand picked up.
        </p>
        <p className="mt-2">Use the real public name customers recognize — it reduces &quot;unknown caller&quot; friction.</p>
      </>
    ),
  },
  "team-whisper": {
    eyebrow: "Team story",
    storyline: "Only the person who answered hears the whisper — never the caller.",
    title: "Team whisper after answer",
    description: (
      <>
        <p>
          Right before the caller connects, the answering receptionist hears a short cue (this line&apos;s label). That
          helps multi-brand or multi-DID teams know <strong>which number</strong> was dialed.
        </p>
        <p className="mt-2">Turn it off if you are solo and do not need the cue — it does not change routing order.</p>
      </>
    ),
  },
  "business-numbers-section": {
    eyebrow: "Published lines",
    storyline: "Each number here is a front door customers can dial — each can route differently.",
    title: "Business numbers",
    description: (
      <>
        <p>
          Buy or port <strong>DIDs</strong> that represent your brand. Each active line can point at a different receptionist
          or your phone first, and its own <strong>no-answer</strong> path (owner / AI / voicemail).
        </p>
        <p className="mt-2">
          Tap a row to open <strong>Route calls</strong> — that is where per-line flexibility lives alongside the Call console.
        </p>
      </>
    ),
  },
  "published-line": {
    eyebrow: "Per-line control",
    storyline: "One number, one routing story: ring target → timeout → fallback.",
    title: "This business line",
    description: (
      <>
        <p>
          The badge shows whether <strong>AI</strong>, voicemail, or another path is armed for no-answer. The subtitle shows
          who rings <em>first</em>.
        </p>
        <p className="mt-2">
          Use <strong>Route calls</strong> on this row to change receptionist, line label (whisper), and fallback without
          leaving Settings.
        </p>
      </>
    ),
  },
  "porting-in-flight": {
    eyebrow: "Porting story",
    storyline: "Carriers validate billing PINs and auth — we mirror their status and messages here.",
    title: "Number transfer in progress",
    description: (
      <>
        <p>
          Porting moves an existing number from another carrier into Zing. Until it completes, inbound on that number may
          still hit your old provider.
        </p>
        <p className="mt-2">
          Use <strong>Messages</strong> on the row for back-and-forth with the porting team (PIN fixes, LOA deadlines). Watch
          <strong> Transfer updates</strong> below for automated notices.
        </p>
      </>
    ),
  },
  "porting-updates": {
    eyebrow: "Operations",
    storyline: "We surface carrier-facing events so small teams do not miss a deadline hidden in email.",
    title: "Transfer updates inbox",
    description: (
      <>
        <p>
          These notifications come from the porting pipeline (submitted, FOC date, exceptions). They complement the threaded{" "}
          <strong>Messages</strong> button on each port row.
        </p>
        <p className="mt-2">Mark all read when you have triaged — unread highlights time-sensitive items.</p>
      </>
    ),
  },
  "add-number": {
    eyebrow: "Growth",
    storyline: "Add capacity without losing the simple routing story.",
    title: "Buy or port a number",
    description: (
      <>
        <p>
          <strong>Buy</strong> issues a fresh DID in the area code you search. <strong>Port</strong> moves a number you already
          advertise so customers keep dialing the same digits.
        </p>
        <p className="mt-2">After either path, assign routing the same way — first answer wins, then your chosen fallback.</p>
      </>
    ),
  },
  "number-modal-overview": {
    eyebrow: "Numbers",
    storyline: "This modal is the acquisition flow — routing is configured after the line exists on your account.",
    title: "Get a number",
    description: (
      <>
        <p>
          <strong>Buy New</strong> searches Telnyx inventory by area code, then provisions the DID you pick. You will confirm a
          line business name before checkout so labels and whispers stay accurate.
        </p>
        <p className="mt-2">
          <strong>Port Existing</strong> starts a carrier transfer: keep messaging with the porting team if they request a bill
          copy, PIN correction, or LOA fix.
        </p>
        <p className="mt-2">When the number is active, tap it in Settings to open Route calls and connect it to your team.</p>
      </>
    ),
  },
  "routing-section-intro": {
    eyebrow: "Call routing",
    storyline: "These toggles describe how rings and notifications behave — they pair with the Routing tab’s who-answers choice.",
    title: "Call routing preferences",
    description: (
      <>
        <p>
          The <Link href={dash} className="font-medium text-primary underline-offset-4 hover:underline">Call console</Link>{" "}
          is where you pick <strong>who answers first</strong>. Here you shape ring style (simultaneous ring), SMS mirroring,
          DND, and notification noise.
        </p>
        <p className="mt-2">Flip a toggle, then tap the ⓘ on that row if you want the full picture for that behavior.</p>
      </>
    ),
  },
  "toggle-dnd": {
    eyebrow: "Quiet hours",
    storyline: "Silences in-app disruption — pair with business hours when that ships end-to-end.",
    title: "Do Not Disturb",
    description: (
      <>
        <p>
          When on, Zing should hold push and non-critical alerts so you are not pinged overnight. It does not by itself
          change <strong>who receives the phone call</strong> — that is still routing + carrier forwarding.
        </p>
        <p className="mt-2">Use it when you want the app quiet while still leaving Telnyx to ring the handset if configured.</p>
      </>
    ),
  },
  "toggle-voicemail": {
    eyebrow: "Fallback story",
    storyline: "Voicemail is one of the three classic outcomes when nobody picks up in time.",
    title: "Voicemail fallback",
    description: (
      <>
        <p>
          This preference aligns with sending unanswered business calls to a <strong>voicemail box</strong> after timeouts,
          instead of endlessly ringing or bouncing to AI.
        </p>
        <p className="mt-2">
          The exact path per line is still chosen on <strong>Routing</strong> → If no answer — this toggle reflects the default
          posture you want the product to assume.
        </p>
      </>
    ),
  },
  "toggle-notifications": {
    eyebrow: "Awareness",
    storyline: "Stay informed when routing or numbers change — without opening the app constantly.",
    title: "Push notifications",
    description: (
      <>
        <p>Turn these on if multiple people manage the account or if you want alerts when porting or routing updates land.</p>
        <p className="mt-2">Turn off if you prefer a fully silent phone except for actual inbound calls.</p>
      </>
    ),
  },
  "toggle-ring-all": {
    eyebrow: "Ring strategy",
    storyline: "Speed-to-answer vs calm phones — simultaneous ring races everyone at once.",
    title: "Ring all simultaneously",
    description: (
      <>
        <p>
          When enabled, every active teammate&apos;s phone that is eligible rings at once. First pickup wins; others drop.
          Great for urgent trades; noisy for large teams.
        </p>
        <p className="mt-2">When off, Zing can use priority or round-robin style behavior depending on backend policy.</p>
      </>
    ),
  },
  "toggle-sms-forward": {
    eyebrow: "SMS mirror",
    storyline: "Business SMS can be mirrored to the people who answer voice — keeps conversations in one place.",
    title: "SMS forwarding",
    description: (
      <>
        <p>
          If your carrier and integration support it, texts to the business line can copy to active receptionists so nobody
          replies from the wrong thread.
        </p>
        <p className="mt-2">Voice routing and SMS routing are related stories — both protect the customer experience.</p>
      </>
    ),
  },
  "ai-fallback": {
    eyebrow: "Voice layer",
    storyline: "AI answers with your playbook when humans miss the handoff — configured from Routing, not duplicated here.",
    title: "AI receptionist fallback",
    description: (
      <>
        <p>
          Zing sells <strong>predictable escalation</strong>: ring people first, then optionally AI, voicemail, or your cell.
          Playbook, voice, and limits live where you already tune the call flow.
        </p>
        <p className="mt-2">
          Use <strong>Open AI fallback setup</strong> below to jump to the dashboard with the AI panel surfaced.
        </p>
      </>
    ),
  },
  "business-hours": {
    eyebrow: "Schedule (preview)",
    storyline: "Hours will eventually gate routing automatically — today this row sets expectations in the UI.",
    title: "Business hours",
    description: (
      <>
        <p>
          The long-term story: <strong>open hours</strong> route to your team, <strong>after hours</strong> compress to voicemail
          or AI without you toggling manually each night.
        </p>
        <p className="mt-2">Wiring is still rolling out — keep using Routing + DND until schedules fully control Telnyx legs.</p>
      </>
    ),
  },
  "account-section": {
    eyebrow: "Account",
    storyline: "Legal, help, and session — everything outside the live call path but still part of trust.",
    title: "Account & support",
    description: (
      <>
        <p>Security links cover data handling. Help & feedback routes to billing context and your message queue.</p>
        <p className="mt-2">Sign out clears this device&apos;s session — routing in the cloud keeps working for callers.</p>
      </>
    ),
  },
  "security-privacy": {
    eyebrow: "Trust",
    storyline: "Small businesses win when customers feel safe sharing name, address, and card over the phone.",
    title: "Security & privacy",
    description: (
      <>
        <p>
          Read how we handle call metadata, recordings (if enabled), and account data. That transparency supports teams who
          quote jobs and take payments on the same line.
        </p>
        <p className="mt-2">Share the policy link with partners who answer calls for you — alignment reduces mistakes.</p>
      </>
    ),
  },
  "help-feedback": {
    eyebrow: "Help story",
    storyline: "Pricing context and a direct line to humans building Zing — same queue as in-app feedback.",
    title: "Help, pricing & feedback",
    description: (
      <>
        <p>Open the Help tab for balances, plan reference, and the feedback form — ideal for billing questions or bug reports.</p>
        <p className="mt-2">Include timestamps and numbers when reporting call issues so support can trace Telnyx legs.</p>
      </>
    ),
  },
  "sign-out": {
    eyebrow: "Session",
    storyline: "Signing out only affects this browser or device.",
    title: "Sign out",
    description: (
      <>
        <p>You will need to log in again to change routing. Inbound calls to your business numbers continue to process.</p>
        <p className="mt-2">Use sign out on shared tablets at the front desk after shifts.</p>
      </>
    ),
  },

  "help-page-overview": {
    eyebrow: "Help story",
    storyline: "Understand what you are paying for and how it connects to minutes on the phone.",
    title: "Help & feedback hub",
    description: (
      <>
        <p>
          This screen is for <strong>account health</strong> (plan, credits, overage rates) and for <strong>telling us what broke</strong> or
          what to build next.
        </p>
        <p className="mt-2">
          For live call control, use the{" "}
          <Link href={dash} className="font-medium text-primary underline-offset-4 hover:underline">
            Call console
          </Link>{" "}
          — that is the hero story Zing sells.
        </p>
      </>
    ),
  },
  "help-balance": {
    eyebrow: "Billing",
    storyline: "Credits are prepaid fuel for metered usage (voice, AI, etc.).",
    title: "Account balance",
    description: (
      <>
        <p>
          Your balance decreases as usage posts. When included plan minutes are exhausted, <strong>metered per-minute</strong>{" "}
          rates apply — see the line below in the card for the current voice overage number.
        </p>
        <p className="mt-2">Top-ups via self-serve checkout are on the roadmap; support can still apply manual credits.</p>
      </>
    ),
  },
  "help-overage": {
    eyebrow: "Metered",
    storyline: "After included minutes, you pay per connected minute — aligned with carrier costs.",
    title: "Voice overage rate",
    description: (
      <>
        <p>This is the per-minute price once pooled included minutes are used for the billing period.</p>
        <p className="mt-2">Long AI sessions and long receptionist calls both consume minutes — watch Pay and Activity for patterns.</p>
      </>
    ),
  },
  "help-plans-table": {
    eyebrow: "Plans",
    storyline: "Reference tiers — included minutes are estimates before metered kicks in.",
    title: "Plan ladder",
    description: (
      <>
        <p>Each row is a SKU-style reference: monthly price and included voice minutes before overage.</p>
        <p className="mt-2">Tap ⓘ on a specific plan row for what that tier optimizes for.</p>
      </>
    ),
  },
  "help-plan-starter": {
    eyebrow: "Plan detail",
    storyline: "Best when you are proving routing with a small team and modest call volume.",
    title: "Starter plan",
    description: (
      <>
        <p>Lower monthly commitment, tighter included minutes — ideal for solo owners testing Zing alongside a cell.</p>
        <p className="mt-2">Upgrade when simultaneous receptionists and higher minute pools matter.</p>
      </>
    ),
  },
  "help-plan-growth": {
    eyebrow: "Plan detail",
    storyline: "Balances richer minute pools with growing front-desk teams.",
    title: "Growth plan",
    description: (
      <>
        <p>Designed for shops that miss fewer calls because multiple people can answer in sequence or in parallel.</p>
        <p className="mt-2">Pair with Team tab staffing and Pay tab to align minutes with labor cost.</p>
      </>
    ),
  },
  "help-plan-pro": {
    eyebrow: "Plan detail",
    storyline: "Highest included minutes — for brands that live on the phone.",
    title: "Pro plan",
    description: (
      <>
        <p>When inbound volume is core revenue (locksmith, HVAC, legal intake), minute headroom reduces surprise overage.</p>
        <p className="mt-2">Still monitor AI fallback usage — transcripts and tools add variable cost.</p>
      </>
    ),
  },
  "help-plan-custom": {
    eyebrow: "Plan detail",
    storyline: "Your workspace may use a custom or renamed tier — the row shows the live price and minute pool.",
    title: "This plan tier",
    description: (
      <>
        <p>Use the monthly price and included minutes on the plan row as the source of truth for this account.</p>
        <p className="mt-2">Message billing if the label does not match what you purchased — we can align the SKU.</p>
      </>
    ),
  },
  "help-feedback-form": {
    eyebrow: "Voice of customer",
    storyline: "Your message goes straight into the operator queue — include enough detail to reproduce.",
    title: "Send a message",
    description: (
      <>
        <p>Choose a category so we route quickly: broken behavior, billing, or product ideas.</p>
        <p className="mt-2">
          For call bugs, include <strong>from</strong> / <strong>to</strong> numbers, approximate time, and whether AI or voicemail was involved.
        </p>
      </>
    ),
  },
  "help-category-issue": {
    eyebrow: "Triage",
    storyline: "Engineering sees these first — reproduction steps save a round trip.",
    title: "Something is broken",
    description: (
      <>
        <p>Use for crashes, wrong routing, missing recordings, or Telnyx errors surfaced in the app.</p>
        <p className="mt-2">Attach whether it was inbound vs test call from the dashboard.</p>
      </>
    ),
  },
  "help-category-feature": {
    eyebrow: "Roadmap",
    storyline: "We prioritize features that reinforce the core story: simple call control for small business.",
    title: "Feature request",
    description: (
      <>
        <p>Tell us the job to be done — e.g. &quot;after-hours auto-SMS&quot; vs just a widget name.</p>
        <p className="mt-2">Mention team size and current pain (missed calls, double-answer, etc.).</p>
      </>
    ),
  },
  "help-category-billing": {
    eyebrow: "Billing",
    storyline: "Credits, invoices, and minute confusion land here.",
    title: "Billing or usage",
    description: (
      <>
        <p>Ask about unexpected balance drops, plan changes, or metered spikes after marketing campaigns.</p>
        <p className="mt-2">Screenshots of Activity timestamps help reconcile against Telnyx CDRs.</p>
      </>
    ),
  },
  "help-category-other": {
    eyebrow: "General",
    storyline: "Catch-all when none of the presets fit.",
    title: "Other",
    description: (
      <>
        <p>Use for partnerships, press, or account ownership changes.</p>
        <p className="mt-2">If it is urgent and phone-related, pick <strong>Something is broken</strong> instead so on-call sees it.</p>
      </>
    ),
  },
}

export function getAppSheetStory(key: string): AppSheetStory | null {
  const story = APP_SHEET_STORIES[key]
  return story ?? null
}

/** Map arbitrary plan keys from API to story keys; fallback to generic ladder copy. */
export function helpPlanStoryKey(planKey: string): string {
  const k = planKey.toLowerCase()
  if (k.includes("starter")) return "help-plan-starter"
  if (k.includes("growth")) return "help-plan-growth"
  if (k.includes("pro")) return "help-plan-pro"
  return "help-plan-custom"
}

export function helpCategoryStoryKey(cat: string): string {
  if (cat === "issue") return "help-category-issue"
  if (cat === "feature") return "help-category-feature"
  if (cat === "billing") return "help-category-billing"
  return "help-category-other"
}
