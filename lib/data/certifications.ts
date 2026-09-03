// Core certification quiz datasets — source of truth for training UI and server-side grading.

type CertificationQuestion = {
  id: string
  question: string
  options: string[]
  correct_answer: string
}

export type CertificationConfig = {
  certification_code: string
  title: string
  passing_score: number
  questions: CertificationQuestion[]
}

/** Quiz questions safe for the browser — correct answers never sent to the client. */
type PublicCertificationQuestion = Omit<CertificationQuestion, "correct_answer">

export type PublicCertificationConfig = Omit<CertificationConfig, "questions"> & {
  questions: PublicCertificationQuestion[]
}

/** @deprecated Alias — use CertificationConfig. */
export type CertificationDatasetEntry = CertificationConfig

/** @deprecated Alias — use PublicCertificationConfig. */
export type PublicCertificationDatasetEntry = PublicCertificationConfig

export const certificationsData: CertificationConfig[] = [
  {
    certification_code: "automotive_core",
    title: "Automotive & Locksmithing Intake Certification",
    passing_score: 100,
    questions: [
      {
        id: "q1",
        question: "What does the abbreviation 'AKL' stand for in automotive locksmithing?",
        options: [
          "Automatic Key Locking",
          "All Keys Lost (Vehicle has no working keys left)",
          "Advanced Keyless Link",
          "Assigned Key Location",
        ],
        correct_answer: "All Keys Lost (Vehicle has no working keys left)",
      },
      {
        id: "q2",
        question:
          "If a customer states their luxury vehicle uses a 'Fobik' or 'Proximity' system, what critical behavior should you verify to qualify the intake?",
        options: [
          "Whether the vehicle uses a physical metal key blade or a push-to-start dashboard button.",
          "The color of the car's interior trim.",
          "Whether the car battery has been replaced in the last 6 months.",
          "If the customer has a spare house key available.",
        ],
        correct_answer:
          "Whether the vehicle uses a physical metal key blade or a push-to-start dashboard button.",
      },
      {
        id: "q3",
        question:
          "A caller requests a new key for a vehicle. Which three specific pieces of information MUST be accurately collected for the dispatcher to verify hardware tool compatibility?",
        options: [
          "License plate state, car color, and insurance provider.",
          "Exact Year, Make, and Model of the vehicle.",
          "The current mileage, tire thread depth, and engine size.",
          "The driver's license number, home address, and registration state.",
        ],
        correct_answer: "Exact Year, Make, and Model of the vehicle.",
      },
      {
        id: "q4",
        question:
          "If an incoming caller specifies they are locked out of their vehicle trunk/glovebox and found a code matching 'M607' on a cylinder, how should this be logged?",
        options: [
          "Log it as a high-security ignition bypass error code.",
          "Log it as a secondary/glovebox lock code, distinct from the primary high-security mechanical vehicle key profile.",
          "Log it as an invalid registration ID and reject the lead.",
          "Log it as an automatic ignition replacement request.",
        ],
        correct_answer:
          "Log it as a secondary/glovebox lock code, distinct from the primary high-security mechanical vehicle key profile.",
      },
    ],
  },
]

function getCertificationByCode(certificationCode: string): CertificationConfig | null {
  const key = certificationCode.trim().toLowerCase()
  if (!key) return null
  return certificationsData.find((entry) => entry.certification_code.toLowerCase() === key) ?? null
}

/** @deprecated Use getCertificationByCode — alias for existing training routes. */
export function getCertificationDatasetEntry(idOrCode: string): CertificationConfig | null {
  return getCertificationByCode(idOrCode)
}

function stripCertificationForClient(entry: CertificationConfig): PublicCertificationConfig {
  return {
    certification_code: entry.certification_code,
    title: entry.title,
    passing_score: entry.passing_score,
    questions: entry.questions.map(({ id, question, options }) => ({ id, question, options })),
  }
}

/** @deprecated Alias for stripCertificationForClient. */
export function getPublicCertificationDatasetEntry(idOrCode: string): PublicCertificationConfig | null {
  const entry = getCertificationByCode(idOrCode)
  return entry ? stripCertificationForClient(entry) : null
}

/** Grade answers against the static dataset (server-side only). */
export function gradeCertificationAnswers(
  entry: CertificationConfig,
  answers: Record<string, string>
): { score: number; total: number; percent: number; passed: boolean } {
  let score = 0
  for (const question of entry.questions) {
    const given = String(answers[question.id] ?? "").trim()
    const expected = String(question.correct_answer ?? "").trim()
    if (given && given === expected) score += 1
  }
  const total = entry.questions.length
  const percent = total > 0 ? Math.round((score / total) * 100) : 0
  const passed = total > 0 && percent >= entry.passing_score
  return { score, total, percent, passed }
}
