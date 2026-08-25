// ============================================
// Default agreement wording
// ============================================
// Starting points, not legal advice, and deliberately plain. An owner can replace
// them per business (agreement_templates.owner_user_id), and the clauses that carry
// real legal weight — restrictive covenants, arbitration, IP assignment, state-specific
// notices — are absent on purpose: those belong to the owner's own counsel, and
// shipping generic versions of them would be worse than shipping none.
//
// {{placeholders}} are filled by lib/agreements/render.ts. Every one of them must
// resolve, because an agreement that goes out saying "{{pay_summary}}" is not one
// anybody can be asked to sign.

export type AgreementKind = "W2_OFFER" | "CONTRACTOR_AGREEMENT" | "PAY_ADDENDUM"

export interface AgreementTemplate {
  kind: AgreementKind
  version: number
  title: string
  body_md: string
}

const W2_OFFER = `# Employment terms

**{{business_name}}** ("the Company") is offering **{{worker_name}}** a position as
{{role_label}}, starting {{start_date}}.

## Your pay

{{pay_summary}}

Pay is calculated for each pay period and paid on the Company's regular schedule.
{{wage_floor_clause}}

## Employment status

You are being hired as an **employee (W-2)**. The Company will withhold income tax,
Social Security and Medicare from your pay, and will report your earnings on a Form W-2.

This is at-will employment: either you or the Company may end it at any time, with or
without cause or notice, unless a separate written agreement signed by both of us says
otherwise. Nothing here is a promise of employment for any fixed period.

## Your hours

{{hours_clause}}

Record your working time accurately. If your recorded hours are wrong, tell the Company
so they can be corrected — pay is calculated from them.

## Changes

If your pay changes, the Company will send you a written summary of the new terms before
it takes effect. Work already done is paid at the rate that applied when you did it.

---

By signing below you confirm you have read these terms, that they describe what you
agreed to, and that you are signing electronically with the same intent as signing on
paper.`

const CONTRACTOR_AGREEMENT = `# Independent contractor agreement

This agreement is between **{{business_name}}** ("the Company") and
**{{worker_name}}** ("the Contractor"), starting {{start_date}}.

## Services

The Contractor will provide services as {{role_label}}. The Contractor decides how and
in what manner the services are performed, subject to the results the Company needs and
to any deadline or standard the parties agree on.

## Fees

{{pay_summary}}

Fees are calculated for each period and paid on the Company's regular schedule.
The Contractor is paid for results as described above and not for time spent as such.

## Independent contractor status

The Contractor is an independent contractor, not an employee. Accordingly:

- The Contractor is responsible for their own federal, state and local taxes, including
  self-employment tax. No tax will be withheld from these fees.
- The Contractor is not eligible for employee benefits, unemployment insurance, or
  workers' compensation through the Company.
- Minimum wage and overtime laws that apply to employees do not apply to these fees.
- The Contractor may work for others, and provides their own tools and equipment except
  where the parties agree otherwise in writing.

The Company will report payments on a Form 1099-NEC where the law requires it.

Both parties intend this relationship to be one of independent contracting. Whether it
is one in law depends on how the work is actually performed, not only on this document.

## Ending this agreement

Either party may end this agreement at any time with written notice. The Company will pay
for services already performed.

## Changes

If these fees change, the Company will send a written summary of the new terms before they
take effect. Work already done is paid at the rate that applied when it was done.

---

By signing below you confirm you have read this agreement, that it describes what you
agreed to, and that you are signing electronically with the same intent as signing on
paper.`

const PAY_ADDENDUM = `# Change to your pay

**{{business_name}}** and **{{worker_name}}** agree that, effective {{start_date}}, the
pay terms are:

{{pay_summary}}

{{wage_floor_clause}}

This replaces the pay terms in your existing {{agreement_label}}. Everything else in that
document is unchanged.

Work already completed before {{start_date}} is paid at the rate that applied when it was
done. This change is not retroactive.

---

By signing below you confirm you have read this change and are signing electronically with
the same intent as signing on paper.`

const TEMPLATES: Record<AgreementKind, AgreementTemplate> = {
  W2_OFFER: { kind: "W2_OFFER", version: 1, title: "Employment terms", body_md: W2_OFFER },
  CONTRACTOR_AGREEMENT: {
    kind: "CONTRACTOR_AGREEMENT",
    version: 1,
    title: "Independent contractor agreement",
    body_md: CONTRACTOR_AGREEMENT,
  },
  PAY_ADDENDUM: {
    kind: "PAY_ADDENDUM",
    version: 1,
    title: "Change to your pay",
    body_md: PAY_ADDENDUM,
  },
}

/** The Lyncr default for a kind. */
export function defaultTemplate(kind: AgreementKind): AgreementTemplate {
  return TEMPLATES[kind]
}

/** Which agreement a new hire signs, given how they are being engaged. */
export function templateKindForEmployment(
  employmentType: "W2_EMPLOYEE" | "CONTRACTOR_1099"
): AgreementKind {
  return employmentType === "W2_EMPLOYEE" ? "W2_OFFER" : "CONTRACTOR_AGREEMENT"
}
