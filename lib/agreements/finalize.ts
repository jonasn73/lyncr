// ============================================
// Turning a signature into a live pay plan
// ============================================
// The order matters. Sign first, then build the plan from the components the agreement
// carries — never from whatever the owner's editor says right now. A worker's plan must
// not be able to differ from the document they put their name to.

import { getReceptionistByPortalUserId } from "@/lib/db"
import { attachAgreementPlan, signAgreement, type WorkerAgreement } from "@/lib/agreements/store"
import { attachAgreementToPlan, savePlan } from "@/lib/compensation/plans"
import type { User } from "@/lib/types"

/**
 * Record the signature, then put the agreed terms into force.
 *
 * The two are linked in both directions — the plan points at the agreement that
 * authorized it, and the agreement points at the plan it produced — so a payout can be
 * traced back to a signature and a signature forward to what it actually paid.
 */
export async function finalizeSignedAgreement(params: {
  agreement: WorkerAgreement
  user: User
  signerName: string
  signatureData: string
  signatureType: "TYPED" | "DRAWN"
  ip?: string | null
  userAgent?: string | null
}): Promise<{ agreementId: string; planId: string | null }> {
  const { agreement, user } = params

  // The roster row the invite created, which is what a plan hangs off.
  const receptionist =
    agreement.worker_role === "receptionist"
      ? await getReceptionistByPortalUserId(user.id).catch(() => null)
      : null

  const signed = await signAgreement({
    agreementId: agreement.id,
    signerName: params.signerName,
    signatureType: params.signatureType,
    signatureData: params.signatureData,
    consentElectronic: true,
    workerUserId: user.id,
    receptionistId: receptionist?.id ?? null,
    ip: params.ip ?? null,
    userAgent: params.userAgent ?? null,
  })

  if (!signed) {
    // Already signed, or no longer pending. Not an error worth failing a signup over.
    return { agreementId: agreement.id, planId: null }
  }

  if (agreement.plan_components.length === 0) {
    return { agreementId: agreement.id, planId: null }
  }
  if (!receptionist) {
    // Nothing to hang the plan off yet — the signature still stands, and the owner can
    // apply the terms from the Team page.
    return { agreementId: agreement.id, planId: null }
  }

  const plan = await savePlan({
    ownerUserId: agreement.owner_user_id,
    organizationId: null,
    ref: { role: "receptionist", receptionist_id: receptionist.id },
    workerUserId: user.id,
    employmentType: agreement.employment_type,
    components: agreement.plan_components,
    agreementId: agreement.id,
    createdBy: agreement.owner_user_id,
  })

  await attachAgreementPlan(agreement.id, plan.id)
  await attachAgreementToPlan(plan.id, agreement.id)

  return { agreementId: agreement.id, planId: plan.id }
}
