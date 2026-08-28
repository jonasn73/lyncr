// Reusable "Intellectual Property & Usage Restrictions" legal block.
// Drop it into the Terms page, a footer, or inline in the registration/signup flow.
// NOTE: This is a strongly-worded template, not legal advice — have counsel review it.

import { Lock, Ban, Scale } from "lucide-react" // Small section icons (already a project dependency).
import { SITE_NAME } from "@/lib/brand" // Product name ("lyncr") so copy stays in sync with the brand.

// Props let the host screen tweak the block without editing the copy itself.
type Props = {
  // Which US state governs disputes. Defaults to Kentucky per our current policy.
  governingState?: string
  // When true, renders a tighter version (smaller text, no big header) for inline use in signup.
  compact?: boolean
  // Optional extra classes from the parent (spacing, max-width, etc.).
  className?: string
}

export function IpUsageRestrictions({
  governingState = "Kentucky", // Default jurisdiction = Kentucky.
  compact = false, // Default to the full, page-sized layout.
  className = "", // Default to no extra classes.
}: Props) {
  return (
    // Outer wrapper: vertical spacing between sections + any parent-supplied classes.
    <section className={`space-y-6 text-foreground ${className}`}>
      {/* Header is hidden in compact (inline) mode to save vertical space in the signup form. */}
      {!compact && (
        <div className="flex items-center gap-3">
          {/* Icon chip in the brand's violet/indigo signal color. */}
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
            <Scale className="h-6 w-6 text-primary" aria-hidden />
          </div>
          <div>
            {/* Section title. */}
            <h2 className="text-2xl font-bold text-foreground">Intellectual Property &amp; Usage Restrictions</h2>
            {/* Sub-line referencing the product name. */}
            <p className="text-sm text-muted-foreground">
              How {SITE_NAME}&apos;s proprietary technology is protected
            </p>
          </div>
        </div>
      )}

      {/* ============================================================= */}
      {/* 1. OWNERSHIP OF PLATFORM PROPERTY                              */}
      {/* ============================================================= */}
      <div className="rounded-xl border border-border bg-card p-4">
        {/* Clause heading with an icon for scannability. */}
        <h3 className="mb-2 flex items-center gap-2 font-semibold text-foreground">
          <Lock className="h-4 w-4 text-primary" aria-hidden />
          1. Ownership of Platform Property
        </h3>
        {/* Body copy: asserts exclusive ownership of every layer of the product. */}
        <p className={compact ? "text-xs text-muted-foreground" : "text-sm text-muted-foreground"}>
          All software source code, system and network architectures, database and call-routing
          schemas, application programming interfaces, user-interface layouts and designs, visual
          workflows, dispatch and fallback logic, and algorithmic configurations that make up {SITE_NAME}{" "}
          (collectively, the &ldquo;Platform&rdquo;) are and shall remain the exclusive proprietary
          property of {SITE_NAME} and its licensors. The Platform is protected by copyright, trade
          secret, trademark, and other intellectual-property laws. No ownership right, title, license,
          or interest of any kind is transferred to you by accessing, viewing, or using the dashboard.
          All rights not expressly granted are reserved.
        </p>
      </div>

      {/* ============================================================= */}
      {/* 2. ANTI-COMPETE & REVERSE-ENGINEERING PROHIBITIONS            */}
      {/* ============================================================= */}
      <div className="rounded-xl border border-border bg-card p-4">
        {/* Clause heading. */}
        <h3 className="mb-2 flex items-center gap-2 font-semibold text-foreground">
          <Ban className="h-4 w-4 text-primary" aria-hidden />
          2. Reverse-Engineering &amp; Anti-Competition
        </h3>
        {/* First paragraph: the hard prohibitions. */}
        <p className={compact ? "text-xs text-muted-foreground" : "text-sm text-muted-foreground"}>
          You, and any agent, employee, contractor, or entity accessing the dashboard through your
          account, are absolutely prohibited from: (a) reverse-engineering, decompiling, disassembling,
          or otherwise attempting to derive the source code or internal call-routing mechanics of the
          Platform; (b) cloning, copying, mirroring, or replicating any part of the Platform; and
          (c) scraping, harvesting, or systematically extracting data, layouts, or workflow logic from
          the application by any automated or manual means.
        </p>
        {/* Second paragraph: derivative-product ban + consequences. Bordered + accented to stand out. */}
        <p
          className={`mt-3 border-l-2 border-primary/60 pl-3 ${
            compact ? "text-xs text-muted-foreground" : "text-sm text-muted-foreground"
          }`}
        >
          Creating, developing, or marketing any derivative product, service, or feature that
          substantially copies, imitates, or is derived from the workflow design, routing architecture,
          or core utility of the Platform based on your access to this dashboard is strictly prohibited.
          Any such violation constitutes grounds for <strong className="text-foreground">immediate
          termination of access</strong>, <strong className="text-foreground">permanent banning</strong>{" "}
          from the Platform, and <strong className="text-foreground">aggressive legal escalation</strong>,
          including injunctive relief, without prior notice.
        </p>
      </div>

      {/* ============================================================= */}
      {/* 3. LIQUIDATED DAMAGES & FORUM SELECTION                       */}
      {/* ============================================================= */}
      <div className="rounded-xl border border-border bg-card p-4">
        {/* Clause heading. */}
        <h3 className="mb-2 flex items-center gap-2 font-semibold text-foreground">
          <Scale className="h-4 w-4 text-primary" aria-hidden />
          3. Damages &amp; Governing Jurisdiction
        </h3>
        {/* Body copy: damages + Kentucky forum-selection clause. */}
        <p className={compact ? "text-xs text-muted-foreground" : "text-sm text-muted-foreground"}>
          Any violation of this section resulting in intellectual-property theft or unauthorized
          cloning will subject the violator to all available statutory damages, liquidated damages,
          actual damages, disgorgement of profits, and recovery of {SITE_NAME}&apos;s attorneys&apos;
          fees and costs, in addition to equitable remedies. These Terms, and any dispute, claim, or
          controversy arising out of or relating to them or the Platform, shall be governed by and
          construed in accordance with the laws of the State of {governingState}, without regard to its
          conflict-of-laws principles. You irrevocably consent to the exclusive jurisdiction and venue
          of the state and federal courts located in the State of {governingState} for the resolution
          of all such disputes.
        </p>
      </div>

      {/* Closing acknowledgement line — useful when embedded above a signup "I agree" checkbox. */}
      <p className={compact ? "text-2xs text-muted-foreground" : "text-xs text-muted-foreground"}>
        By creating an account or accessing the {SITE_NAME} dashboard, you acknowledge that you have
        read, understood, and agree to be bound by these Intellectual Property &amp; Usage Restrictions.
      </p>
    </section>
  )
}
