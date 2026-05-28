"use server"

// Server actions for the receptionist training portal.

import { revalidatePath } from "next/cache"
import { getReceptionistPortalContext, isReceptionistPortalUser } from "@/lib/receptionist-portal-auth"
import { getSessionUser } from "@/lib/server-session-user"
import { gradeAndAwardCertification, setCertificationFieldActive } from "@/lib/training-engine"

export type SubmitQuizAnswersResult =
  | {
      ok: true
      score: number
      total: number
      percent: number
      passed: boolean
      message: string
    }
  | { ok: false; error: string }

export type ToggleFieldStatusResult = { ok: true } | { ok: false; error: string }

async function assertPortalUserMatches(userId: string): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const sessionUser = await getSessionUser()
  if (!sessionUser) return { ok: false, error: "Not signed in" }
  const targetId = userId.trim()
  if (!targetId || targetId !== sessionUser.id) {
    return { ok: false, error: "Unauthorized" }
  }
  if (!isReceptionistPortalUser(sessionUser)) {
    const ctx = await getReceptionistPortalContext(sessionUser.id)
    if (!ctx) {
      return { ok: false, error: "Training portal is for receptionist accounts only" }
    }
  }
  return { ok: true, userId: sessionUser.id }
}

/** Grade quiz answers against static certification data; award badge on pass. */
export async function submitQuizAnswers(
  userId: string,
  certCode: string,
  answers: Record<string, string>
): Promise<SubmitQuizAnswersResult> {
  const auth = await assertPortalUserMatches(userId)
  if (!auth.ok) return auth

  const code = certCode.trim()
  if (!code) return { ok: false, error: "Certification code is required" }

  const result = await gradeAndAwardCertification({
    userId: auth.userId,
    certCode: code,
    answers,
  })

  if (!result.ok) return result

  revalidatePath("/receptionist/training")
  revalidatePath(`/receptionist/training/${code}`)
  revalidatePath("/receptionist")

  return {
    ok: true,
    score: result.score,
    total: result.total,
    percent: result.percent,
    passed: result.passed,
    message: result.message,
  }
}

/** Enable or disable a certified specialty in the live routing pool. */
export async function toggleFieldStatus(
  userId: string,
  certCode: string,
  isActive: boolean
): Promise<ToggleFieldStatusResult> {
  const auth = await assertPortalUserMatches(userId)
  if (!auth.ok) return auth

  const code = certCode.trim()
  if (!code) return { ok: false, error: "Certification code is required" }

  const result = await setCertificationFieldActive({
    userId: auth.userId,
    certCode: code,
    isActive,
  })

  if (!result.ok) return result

  revalidatePath("/receptionist/training")
  revalidatePath(`/receptionist/training/${code}`)
  revalidatePath("/receptionist")

  return { ok: true }
}
