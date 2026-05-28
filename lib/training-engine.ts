// Receptionist certification & training engine — catalog, grading, and skill sync.

import {
  appendReceptionistCertificationSkills,
  getCertificationByCode,
  listCertifications,
  listReceptionistBadgesForUser,
  setReceptionistBadgeActiveToggle,
  upsertCertificationModule,
  upsertReceptionistBadge,
} from "@/lib/db"
import {
  certificationsData,
  getCertificationDatasetEntry,
  gradeCertificationAnswers,
  type CertificationConfig,
} from "@/lib/data/certifications"
import type {
  Certification,
  CertificationModuleData,
  CertificationQuizQuestion,
  TrainingCertificationCard,
} from "@/lib/types"

/** Quiz payload safe for the browser — correct answers stripped. */
export type PublicCertificationModuleData = Omit<CertificationModuleData, "quiz"> & {
  quiz: Array<Omit<CertificationQuizQuestion, "correctAnswer">>
}

export type PublicTrainingCertificationCard = Omit<TrainingCertificationCard, "certification"> & {
  certification: Omit<Certification, "module_data"> & { module_data: PublicCertificationModuleData }
}

function staticConfigToModuleData(entry: CertificationConfig): CertificationModuleData {
  return {
    description: entry.title,
    lessons: [],
    quiz: entry.questions.map((q) => ({
      id: q.id,
      question: q.question,
      options: q.options,
      correctAnswer: q.correct_answer,
    })),
  }
}

async function ensureCertificationRegistered(entry: CertificationConfig) {
  let dbCertification = await getCertificationByCode(entry.certification_code)
  if (dbCertification) return dbCertification

  const upserted = await upsertCertificationModule({
    code_identifier: entry.certification_code,
    name: entry.title,
    module_data: staticConfigToModuleData(entry),
  })
  if (upserted) return upserted

  return getCertificationByCode(entry.certification_code)
}

function staticConfigToCertification(entry: CertificationConfig, dbCert: Certification | undefined): Certification {
  return {
    id: dbCert?.id ?? entry.certification_code,
    name: entry.title,
    code_identifier: entry.certification_code,
    module_data: staticConfigToModuleData(entry),
    created_at: dbCert?.created_at ?? new Date(0).toISOString(),
  }
}

function stripCorrectAnswers(module: CertificationModuleData): PublicCertificationModuleData {
  return {
    ...module,
    quiz: module.quiz.map(({ id, question, options }) => ({ id, question, options })),
  }
}

function toPublicCard(card: TrainingCertificationCard): PublicTrainingCertificationCard {
  return {
    ...card,
    certification: {
      ...card.certification,
      module_data: stripCorrectAnswers(card.certification.module_data),
    },
  }
}

/** Merge static certifications with the user's badge rows for the training portal grid. */
export async function getTrainingCatalogForUser(userId: string): Promise<PublicTrainingCertificationCard[]> {
  const [dbCertifications, badges] = await Promise.all([
    listCertifications(),
    listReceptionistBadgesForUser(userId),
  ])
  const dbByCode = new Map(dbCertifications.map((c) => [c.code_identifier, c]))
  const badgeByCertId = new Map(badges.map((b) => [b.certification_id, b]))

  return certificationsData.map((datasetEntry) => {
    const dbCert = dbByCode.get(datasetEntry.certification_code)
    const certification = staticConfigToCertification(datasetEntry, dbCert)
    const badge = dbCert ? badgeByCertId.get(dbCert.id) ?? null : null
    const certified = badge?.status === "certified"
    const card: TrainingCertificationCard = {
      certification,
      badge,
      locked: !certified,
      certified,
    }
    return toPublicCard(card)
  })
}

export type QuizGradeResult =
  | { ok: true; score: number; total: number; percent: number; passed: boolean; message: string }
  | { ok: false; error: string }

/** Grade quiz answers against static dataset; award badge when passing_score is met. */
export async function gradeAndAwardCertification(params: {
  userId: string
  certCode: string
  answers: Record<string, string>
}): Promise<QuizGradeResult> {
  const datasetEntry = getCertificationDatasetEntry(params.certCode)
  if (!datasetEntry) return { ok: false, error: "Certification not found" }

  const questions = datasetEntry.questions
  if (!questions.length) return { ok: false, error: "This course has no quiz yet" }

  const { score, total, percent, passed } = gradeCertificationAnswers(datasetEntry, params.answers)

  const dbCertification = await ensureCertificationRegistered(datasetEntry)
  if (!dbCertification) {
    return {
      ok: false,
      error:
        "Certification tables are missing in Neon. Run scripts/043-certifications-training.sql in the Neon SQL Editor (see scripts/MIGRATE-ALL.md).",
    }
  }

  if (!passed) {
    await upsertReceptionistBadge({
      userId: params.userId,
      certificationId: dbCertification.id,
      status: "in_progress",
      activeToggle: false,
    })
    return {
      ok: true,
      score,
      total,
      percent,
      passed: false,
      message: `You scored ${score}/${total} (${percent}%). Review the study modules and try again — ${datasetEntry.passing_score}% is required to certify.`,
    }
  }

  await upsertReceptionistBadge({
    userId: params.userId,
    certificationId: dbCertification.id,
    status: "certified",
    activeToggle: true,
  })
  await appendReceptionistCertificationSkills({
    portalUserId: params.userId,
    codeIdentifier: datasetEntry.certification_code,
  })

  return {
    ok: true,
    score,
    total,
    percent,
    passed: true,
    message: `Perfect score! You are certified in ${datasetEntry.title} and added to the live routing pool.`,
  }
}

/** Flip active_toggle on a certified badge — controls live routing pool inclusion. */
export async function setCertificationFieldActive(params: {
  userId: string
  certCode: string
  isActive: boolean
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const certification = await getCertificationByCode(params.certCode)
  if (!certification) return { ok: false, error: "Certification not found" }

  const updated = await setReceptionistBadgeActiveToggle({
    userId: params.userId,
    certificationId: certification.id,
    activeToggle: params.isActive,
  })
  if (!updated) return { ok: false, error: "Complete the certification before toggling this field" }
  return { ok: true }
}

/** Server-side grading helper for unit tests. */
export function gradeQuizLocally(
  entry: Pick<CertificationConfig, "questions" | "passing_score">,
  answers: Record<string, string>
): { correct: number; total: number; passed: boolean } {
  const result = gradeCertificationAnswers(
    {
      certification_code: "test",
      title: "Test",
      passing_score: entry.passing_score,
      questions: entry.questions,
    },
    answers
  )
  return { correct: result.score, total: result.total, passed: result.passed }
}
