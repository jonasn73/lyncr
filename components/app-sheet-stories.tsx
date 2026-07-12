"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { SITE_BRAND_STORY, SITE_NAME } from "@/lib/brand"

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
          {SITE_NAME}&apos;s promise is simple: <strong>one business number</strong>, you choose{" "}
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
          Porting moves an existing number from another carrier into {SITE_NAME}. Until it completes, inbound on that number may
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
          When on, {SITE_NAME} should hold push and non-critical alerts so you are not pinged overnight. It does not by itself
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
        <p className="mt-2">When off, {SITE_NAME} can use priority or round-robin style behavior depending on backend policy.</p>
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
          {SITE_NAME} sells <strong>predictable escalation</strong>: ring people first, then optionally AI, voicemail, or your cell.
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
    storyline: `Pricing context and a direct line to humans building ${SITE_NAME} — same queue as in-app feedback.`,
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
          — that is the hero story {SITE_NAME} sells.
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
        <p>Lower monthly commitment, tighter included minutes — ideal for solo owners testing {SITE_NAME} alongside a cell.</p>
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
  "help-feedback-subject": {
    eyebrow: "Routing the ticket",
    storyline: "Support scans subjects before bodies — make the first line carry the decision.",
    title: "Subject line",
    description: (
      <>
        <p>
          Write <strong>what broke or what you want</strong> in five to eight words, plus the business line if relevant (last
          four digits are fine).
        </p>
        <p className="mt-2">Bad: &quot;Help&quot;. Good: &quot;502 line rings wrong person after 4pm&quot;.</p>
      </>
    ),
  },
  "help-feedback-body": {
    eyebrow: "Evidence",
    storyline: "The body is where we reproduce routing, billing, or UI issues without guessing.",
    title: "Details field",
    description: (
      <>
        <p>
          Include <strong>steps</strong>, <strong>expected vs actual</strong>, and <strong>time zone + approximate time</strong> for call issues.
        </p>
        <p className="mt-2">Paste error text verbatim. If billing, note whether the problem is balance, overage, or plan change.</p>
      </>
    ),
  },

  "route-modal-overview": {
    eyebrow: "Per-line routing",
    storyline: "This modal assigns who is dialed first for one published business number — not account-wide defaults unless marked Default.",
    title: "Route calls",
    description: (
      <>
        <p>
          Pick <strong>Your phone</strong> to ring the owner main line first, or a receptionist to delegate. Saving updates{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-[10px]">routing_config</code> for this DID.
        </p>
        <p className="mt-2">Fallback (AI, voicemail, ring cell) is tuned on the Call console for the same line.</p>
      </>
    ),
  },
  "route-modal-line-label": {
    eyebrow: "Whisper & CRM",
    storyline: "The label is internal — customers still see the business number as caller ID while ringing.",
    title: "Line label",
    description: (
      <>
        <p>
          Used in lists, porting threads, and the <strong>team whisper</strong> (if enabled) so staff know which brand or queue
          answered.
        </p>
        <p className="mt-2">It is not the same as <strong>Account business name</strong> in Settings — that is account-wide trust branding.</p>
      </>
    ),
  },
  "route-modal-first-ring": {
    eyebrow: "First leg",
    storyline: "Telnyx forwards the inbound DID to exactly one target for the first ring phase.",
    title: "Who receives calls first",
    description: (
      <>
        <p>
          <strong>Default</strong> means this target is the account fallback when no per-line override exists.{" "}
          <strong>Selected</strong> means this line explicitly rings here.
        </p>
        <p className="mt-2">Changing first target does not change ring duration or no-answer path — set those on Routing.</p>
      </>
    ),
  },

  "buy-step-search": {
    eyebrow: "Inventory",
    storyline: "Area code search returns carrier-ready DIDs you can provision in minutes.",
    title: "Search available numbers",
    description: (
      <>
        <p>Enter a valid US area code (three digits). Results come from Telnyx; not every code has inventory every day.</p>
        <p className="mt-2">After purchase you will name the line before it appears under Business numbers.</p>
      </>
    ),
  },
  "buy-step-purchase-label": {
    eyebrow: "Label before buy",
    storyline: "The label travels to your phone list and whisper — set it before clicking Purchase.",
    title: "Line label when buying",
    description: (
      <>
        <p>Pick something your team recognizes on caller ID context — &quot;Dispatch&quot;, &quot;Main&quot;, &quot;West store&quot;.</p>
        <p className="mt-2">You can edit later in Route calls or Settings line fields.</p>
      </>
    ),
  },

  "port-step1-number": {
    eyebrow: "LOA path",
    storyline: "Porting proves you control the number at the losing carrier — paperwork, not instant magic.",
    title: "Number & line label (step 1)",
    description: (
      <>
        <p>Enter the full number you advertise today. The line label is required so your team can distinguish DIDs after port completes.</p>
        <p className="mt-2">Inbound may still hit the old carrier until the port FOC completes — watch Transfer updates.</p>
      </>
    ),
  },
  "port-step2-account": {
    eyebrow: "Carrier match",
    storyline: "Account fields must match the bill you upload — mismatches are the top reason ports stall.",
    title: "Account info (step 2)",
    description: (
      <>
        <p>Name, authorized contact, optional account/PIN, and a recent invoice image or PDF prove ownership.</p>
        <p className="mt-2">If the porting team pings you in Messages, reply with corrected PINs quickly — deadlines are real.</p>
      </>
    ),
  },
  "port-step3-address": {
    eyebrow: "Service address",
    storyline: "Carriers validate the address on file for the number being moved.",
    title: "Service address (step 3)",
    description: (
      <>
        <p>Use the service address your current provider shows on the bill, not a PO box unless that is what they have on file.</p>
        <p className="mt-2">Typos here often cause automated rejection before a human ever reviews.</p>
      </>
    ),
  },

  "dashboard-call-flow": {
    eyebrow: "Live routing",
    storyline: "One surface walks the caller’s path: first ring, wait time, then what they hear if nobody answers.",
    title: "Call flow",
    description: (
      <>
        <p>
          Tap <strong>Who answers</strong>, <strong>Ring & backup</strong>, or <strong>Voice & greetings</strong> to open each step in order without leaving the page.
        </p>
        <p className="mt-2">With multiple lines, pick the highlighted number chip first so you edit the right line.</p>
      </>
    ),
  },
  "dashboard-quick-setup": {
    eyebrow: "Onboarding",
    storyline: "Three checkpoints mirror the same story we sell: number → people → optional team depth.",
    title: "Quick setup banner",
    description: (
      <>
        <p>Step 1 ensures customers dial a business number you publish through {SITE_NAME} (bought here or ported in). Step 2 is routing. Step 3 is staffing receptionists when you are ready.</p>
        <p className="mt-2">You can skip Team if you are solo — owner phone first is a valid posture.</p>
      </>
    ),
  },
  "dashboard-per-line-chips": {
    eyebrow: "Multi-DID",
    storyline: "Each chip is one customer-facing number with its own first ring and fallback snapshot.",
    title: "Business line chips",
    description: (
      <>
        <p>Tap a chip before changing routing — otherwise updates can hit the account default row instead of the line you care about.</p>
        <p className="mt-2">Badges show AI readiness or voicemail so you spot misconfigurations before customers do.</p>
      </>
    ),
  },

  "dashboard-sheet-who-answers": {
    eyebrow: "Part 1 of 3",
    storyline: "First hop on the PSTN bridge — owner pocket vs teammate.",
    title: "Who answers first (this sheet)",
    description: (
      <>
        <p>Choosing a receptionist forwards the business line to their handset on the first leg. Choosing your phone uses the main line from Settings.</p>
        <p className="mt-2">Tap Next in the footer when you are ready to set ring duration and backup.</p>
      </>
    ),
  },
  "dashboard-ring-timeout-deep": {
    eyebrow: "Part 2 of 3",
    storyline: "Timeout is only how long we wait for an answer on the first target — not a post-answer delay.",
    title: "Max ring time",
    description: (
      <>
        <p>Shorter values move callers to voicemail, AI, or your backup phone faster when everyone is busy.</p>
        <p className="mt-2">Telnyx starts ringing immediately; this control only bounds the hunt for a human pickup.</p>
      </>
    ),
  },
  "dashboard-no-answer-backup": {
    eyebrow: "Part 2 of 3",
    storyline: "These chips are the high-level backup after the first leg times out.",
    title: "If no answer (summary)",
    description: (
      <>
        <p>Owner rings your cell again, AI runs the voice assistant flow, voicemail captures a message — each is a different caller experience.</p>
        <p className="mt-2">Fine-tune greetings and AI playbook under Voice & greetings (part 3).</p>
      </>
    ),
  },
  "dashboard-fallback-owner": {
    eyebrow: "Backup",
    storyline: "Still human-first — try the owner cell when the receptionist leg fails.",
    title: "Ring your phone (fallback)",
    description: (
      <>
        <p>Use when the first target is a teammate but you still want the owner to catch stragglers without turning AI on.</p>
        <p className="mt-2">Pair with ring timeout so callers are not left ringing forever.</p>
      </>
    ),
  },
  "dashboard-fallback-ai": {
    eyebrow: "Voice layer",
    storyline: "AI answers with your configured assistant after timeouts — intake, SMS leads, etc.",
    title: "AI receptionist (fallback)",
    description: (
      <>
        <p>Requires a linked Telnyx assistant. Open Voice & greetings to attach playbook, voice, and optional ring-owner-first testing.</p>
        <p className="mt-2">AI minutes bill like voice — watch Help balance and Activity.</p>
      </>
    ),
  },
  "dashboard-fallback-voicemail": {
    eyebrow: "Capture",
    storyline: "Voicemail is the calm default when you do not want AI or a second ring.",
    title: "Voicemail (fallback)",
    description: (
      <>
        <p>Callers hear your greeting then record. Good after-hours or when compliance prefers no AI on the line.</p>
        <p className="mt-2">Recordings show up in Activity when enabled.</p>
      </>
    ),
  },
  "dashboard-sheet-voice-layer": {
    eyebrow: "Part 3 of 3",
    storyline: "Greetings, AI intake, and ring-my-phone-first live here — the emotional layer after routing math.",
    title: "Voice & greetings sheet",
    description: (
      <>
        <p>Select AI vs voicemail vs ring-owner, then expand the AI panel for scripts. This closes the loop for what the caller hears.</p>
        <p className="mt-2">Changes autosave — watch for toast errors if Telnyx rejects a field.</p>
      </>
    ),
  },
  "dashboard-ai-ring-owner-first": {
    eyebrow: "Testing & safety",
    storyline: "Optional extra ring leg before AI so you can hear the real PSTN path.",
    title: "Ring my phone first (AI)",
    description: (
      <>
        <p>When AI is the fallback, this inserts your cell in front of the assistant so you can grab urgent calls personally.</p>
        <p className="mt-2">Turn off for straight-to-AI after the first target times out — common for solo owners.</p>
      </>
    ),
  },
  "dashboard-caller-id-tips": {
    eyebrow: "Trust",
    storyline: "Spam shield and CNAM lookup help you block junk and name businesses before you answer.",
    title: "Caller ID utilities",
    description: (
      <>
        <p>
          <strong>Spam &amp; Robocall Shield</strong> auto-rejects verified high-risk spam before it rings your team.
        </p>
        <p className="mt-2">
          <strong>Enhanced CNAM Lookup</strong> tries to show a business name on incoming rings when carriers provide it.
        </p>
        <p className="mt-2">
          We still send your business number on forwarded legs. Spam flags from the receiving network also depend on
          accurate labels and consistent legitimate volume.
        </p>
      </>
    ),
  },

  "onboarding-overview": {
    eyebrow: "First run",
    storyline: "Three beats: published number → optional team → voice backup — same story as the live Call console.",
    title: "Welcome setup",
    description: (
      <>
        <p>{SITE_BRAND_STORY}</p>
        <p className="mt-2">
          This wizard is a guided tour. Live routing always wins on the dashboard once you have real numbers from Settings.
        </p>
        <p className="mt-2">You can skip receptionists if you are solo — owner-first routing is valid.</p>
      </>
    ),
  },

  "ai-flow-overview": {
    eyebrow: "Voice layer",
    storyline: "This panel is what callers hear after routing sends them to AI — script, intake, voice, and Telnyx assistant sync.",
    title: "AI call flow",
    description: (
      <>
        <p>
          <strong>Opening line</strong> is the first spoken words. <strong>Playbook</strong> shapes questions.{" "}
          <strong>Voice &amp; model</strong> are optional power tweaks — defaults work for most shops.
        </p>
        <p className="mt-2">Save pushes config to your linked assistant; test with a real call after Telnyx sync succeeds.</p>
      </>
    ),
  },
  "ai-opening-line-section": {
    eyebrow: "Caller experience",
    storyline: "The greeting is also what preview plays — keep it short, branded, and honest about wait or intake.",
    title: "Opening line",
    description: (
      <>
        <p>When nobody answers the human leg first, the AI picks up with this line — or after ring-my-phone-first if you enabled that on the dashboard.</p>
        <p className="mt-2">Preview uses cloud TTS when available; live calls use the saved assistant voice.</p>
      </>
    ),
  },
  "ai-assistant-not-linked-banner": {
    eyebrow: "Provisioning",
    storyline: "Fallback is set to AI but Telnyx has no assistant row yet — callers would hit voicemail tone instead of live AI.",
    title: "Assistant not linked",
    description: (
      <>
        <p>Tap <strong>Save call flow</strong> so the server can create or attach the assistant and sync Telnyx.</p>
        <p className="mt-2">If this persists after save, check voice API keys and support — the UI cannot finish the link without the backend.</p>
      </>
    ),
  },
  "ai-locksmith-intake-extras": {
    eyebrow: "Industry module",
    storyline: "Locksmith profile adds car-key and lockout hints into the same assistant instructions bucket.",
    title: "Locksmith extras",
    description: (
      <>
        <p>These notes merge into the playbook the model sees — use them for dispatch rules, pricing tone, or safety phrases.</p>
        <p className="mt-2">If you are not a locksmith, pick another profile or Auto from the playbook dropdown.</p>
      </>
    ),
  },
  "ai-extra-notes-section": {
    eyebrow: "Prompt glue",
    storyline: "Freeform hints appended to every script variant — keep evergreen, not one-off job addresses.",
    title: "Extra notes (all scripts)",
    description: (
      <>
        <p>Use for brand voice (&quot;we say customers not clients&quot;), languages offered, or escalation phrases.</p>
        <p className="mt-2">Very long notes increase token cost per call — prefer bullets under 500 characters.</p>
      </>
    ),
  },
  "ai-sms-notify-toggle": {
    eyebrow: "Leads",
    storyline: "When intake saves a structured lead, we can text your cell if messaging is enabled on the account.",
    title: "Text me new leads",
    description: (
      <>
        <p>Turn off if you only want CRM/email or if your carrier blocks automated SMS from the assistant.</p>
        <p className="mt-2">Does not change who answers voice first — that stays on Routing.</p>
      </>
    ),
  },
  "ai-playbook-industry": {
    eyebrow: "Playbook",
    storyline: "Auto follows Settings industry; explicit profiles override with a fixed question tree.",
    title: "Industry script",
    description: (
      <>
        <p>Each profile encodes intents (keys, lockouts, bookings). Auto maps your signup industry to the closest profile.</p>
        <p className="mt-2">Expand <strong>Flow outline</strong> in the modal to see branches before you save.</p>
      </>
    ),
  },
  "ai-voice-advanced-block": {
    eyebrow: "Power user",
    storyline: "Model and voice IDs pass through to Telnyx — wrong values fail sync; empty means platform defaults.",
    title: "Voice &amp; model",
    description: (
      <>
        <p>Use catalog Sample to compare timbre fairly. LLM field accepts provider-style ids your deployment allows.</p>
        <p className="mt-2">If you are not debugging, leave both empty and rely on {SITE_NAME} defaults.</p>
      </>
    ),
  },
  "ai-llm-model-field": {
    eyebrow: "LLM",
    storyline: "Controls reasoning model for the voice assistant pipeline — billing and latency follow this choice.",
    title: "LLM model",
    description: (
      <>
        <p>Type from the datalist or paste an id your Telnyx project supports. Invalid ids surface as save or sync errors.</p>
        <p className="mt-2">Smaller models cost less per minute but may miss nuance on complex intakes.</p>
      </>
    ),
  },
  "ai-tts-voice-field": {
    eyebrow: "TTS",
    storyline: "Speaking voice is the timbre callers hear on live AI legs and on cloud previews when available.",
    title: "Speaking voice",
    description: (
      <>
        <p>Sample plays a fixed sentence so you compare apples to apples. Use copies the id into the field.</p>
        <p className="mt-2">Browser fallback preview does not prove Telnyx will sound identical — it is a rough check only.</p>
      </>
    ),
  },
  "ai-extra-instructions-field": {
    eyebrow: "Policies",
    storyline: "Appended system instructions — highest leverage for tone, compliance, and what never to promise.",
    title: "Extra instructions",
    description: (
      <>
        <p>Good for &quot;never quote a price&quot;, &quot;always collect gate code&quot;, or bilingual handling.</p>
        <p className="mt-2">Keep complementary to playbook — contradictions confuse the model mid-call.</p>
      </>
    ),
  },
  "ai-assistant-state-footer": {
    eyebrow: "Linkage",
    storyline: "Shows whether GET /api/ai-assistant sees a linked Telnyx assistant after your last save.",
    title: "AI ready status",
    description: (
      <>
        <p>Green means calls can reach Voice AI on the configured fallback path. Monospace id is for support tickets.</p>
        <p className="mt-2">If you just toggled AI on the dashboard, save here once to provision and sync.</p>
      </>
    ),
  },
  "ai-manual-assistant-id": {
    eyebrow: "Support / migration",
    storyline: "Rare escape hatch when support pastes an existing Telnyx assistant id — not for normal setup.",
    title: "Link a different assistant ID",
    description: (
      <>
        <p>Leave empty for auto-provisioned assistants. Paste only when engineering confirms a migration or split project.</p>
        <p className="mt-2">Wrong ids break inbound AI until removed and saved again.</p>
      </>
    ),
  },

  "admin-overview-fleet": {
    eyebrow: "Operator",
    storyline: "Fleet-wide aggregates — sanity check growth, balance pool, and call volume before drilling into users.",
    title: "Fleet overview",
    description: (
      <>
        <p>Counts come from live DB reads — refresh after migrations or bulk credits.</p>
        <p className="mt-2">Talk seconds sum loaded users only; use analytics elsewhere for historical exports.</p>
      </>
    ),
  },
  "admin-metric-accounts": {
    eyebrow: "Operator",
    storyline: "Distinct user rows with login access — not DIDs and not receptionist profiles alone.",
    title: "Accounts card",
    description: (
      <>
        <p>Compare to Telnyx or billing when reconciling seat counts. Deactivated accounts may still exist until purged.</p>
      </>
    ),
  },
  "admin-metric-prepaid-balance": {
    eyebrow: "Operator",
    storyline: "Sum of prepaid credit balances across loaded accounts — not bank cash, not AR.",
    title: "Total prepaid balance",
    description: (
      <>
        <p>Useful for runway: large swings often mean a promo credit batch or a metering spike investigation.</p>
      </>
    ),
  },
  "admin-metric-calls-30d": {
    eyebrow: "Operator",
    storyline: "Sum of per-user call counts from the users table slice — proxy for fleet traffic.",
    title: "Calls (30d) aggregate",
    description: (
      <>
        <p>Matches the same 30-day window shown on each user row. Not unique callers — inbound + outbound attempts per logging rules.</p>
      </>
    ),
  },
  "admin-metric-talk-seconds": {
    eyebrow: "Operator",
    storyline: "Aggregate connected talk time — pairs with metering if you bill on minutes.",
    title: "Talk seconds (30d)",
    description: (
      <>
        <p>Long durations with low call counts can mean a few marathon conferences or stuck legs — worth spot-checking CDRs.</p>
      </>
    ),
  },
  "admin-open-feedback-queue": {
    eyebrow: "Operator",
    storyline: "Open feedback rows still awaiting triage — click Support to read bodies and change status.",
    title: "Open feedback",
    description: (
      <>
        <p>Requires feedback table migration. Count should trend down during business hours if SLAs are healthy.</p>
      </>
    ),
  },
  "admin-users-directory": {
    eyebrow: "Operator",
    storyline: "Ledger balances, 30d usage, and operator flag in one grid — Manage opens the drill sheet.",
    title: "Users &amp; usage table",
    description: (
      <>
        <p>Operator switch grants this console — use sparingly and audit who has access.</p>
        <p className="mt-2">Manage loads recent call_logs for the account and credit tooling.</p>
      </>
    ),
  },
  "admin-user-sheet-snapshot": {
    eyebrow: "Operator",
    storyline: "Three tiles summarize money, traffic, and surface area (team + DIDs) for the opened account.",
    title: "Account snapshot tiles",
    description: (
      <>
        <p>Balance is prepaid ledger. Team / numbers counts help guess routing complexity before reading calls.</p>
      </>
    ),
  },
  "admin-user-sheet-operator": {
    eyebrow: "Operator",
    storyline: "Platform admin can open this console — separate from who answers phones.",
    title: "Operator switch",
    description: (
      <>
        <p>Toggle only for trusted staff. Removing admin does not sign them out immediately but hides operator routes on next load.</p>
      </>
    ),
  },
  "admin-user-sheet-call-log": {
    eyebrow: "Operator",
    storyline: "Latest call_logs for quick forensic when a member reports missed routing.",
    title: "Recent calls",
    description: (
      <>
        <p>Newest first — use timestamps with the member&apos;s timezone when comparing to their story.</p>
        <p className="mt-2">Durations are seconds as stored; zero may mean abandoned before connect.</p>
      </>
    ),
  },
  "admin-user-sheet-credit": {
    eyebrow: "Operator",
    storyline: "Ledger credit or debit with reason string — auditable support action.",
    title: "Adjust prepaid balance",
    description: (
      <>
        <p>Positive adds goodwill or refunds; negative recovers mistaken credits. Reason shows in internal ledger views.</p>
        <p className="mt-2">Double-check account email before Apply — mistakes are painful to unwind.</p>
      </>
    ),
  },
  "admin-feedback-triage": {
    eyebrow: "Operator",
    storyline: "Workflow state on feedback_submissions — not the same as Zendesk unless you wire export.",
    title: "Feedback status",
    description: (
      <>
        <p>Open → triaged → closed is the minimal loop. Status drives counts on Fleet overview.</p>
        <p className="mt-2">Body may contain PII — treat like support mail when copying out.</p>
      </>
    ),
  },
  "admin-support-queue-intro": {
    eyebrow: "Operator",
    storyline: "Each card is one ticket — tap to open the full sheet for triage.",
    title: "Support queue",
    description: (
      <>
        <p>Newest first. Category hints routing to billing vs engineering.</p>
      </>
    ),
  },
  "admin-advanced-console": {
    eyebrow: "Operator",
    storyline: "Env vars and SQL migrations are intentionally outside this UI — pointers only.",
    title: "Advanced",
    description: (
      <>
        <p>ZING_ADMIN_EMAILS bootstraps first admins; thereafter use the Users table operator switch.</p>
        <p className="mt-2">Schema changes belong in numbered scripts and Neon SQL editor — never from here.</p>
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
