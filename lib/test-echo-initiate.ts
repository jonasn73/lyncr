import { getForwardingPhoneNumberForUser, getPhoneNumbers, normalizePhoneNumberE164 } from "@/lib/db"
import { getAppUrl } from "@/lib/telnyx"
import { initiateTexmlOutboundCall } from "@/lib/telnyx-outbound-texml-call"

export type InitiateTestEchoForUserResult = {
  call_status: string
  dialed: string
  from: string
  message: string
}

/** Dial the account forwarding phone and connect to the test-echo TeXML loop. */
export async function initiateTestEchoForUser(
  userId: string,
  businessNumber?: string
): Promise<InitiateTestEchoForUserResult> {
  const forwardingRaw = await getForwardingPhoneNumberForUser(userId)
  if (!forwardingRaw) {
    throw new Error("Add your mobile number in Settings before running audio diagnostics.")
  }

  const numbers = await getPhoneNumbers(userId)
  const activeNumbers = numbers.filter((n) => n.status === "active" && n.number?.trim())
  if (activeNumbers.length === 0) {
    throw new Error("Activate a business line before running audio diagnostics.")
  }

  const requested = businessNumber?.trim()
  const fromRecord =
    (requested &&
      activeNumbers.find(
        (n) => normalizePhoneNumberE164(n.number) === normalizePhoneNumberE164(requested)
      )) ||
    activeNumbers[0]

  const fromE164 = normalizePhoneNumberE164(fromRecord.number)
  const toE164 = normalizePhoneNumberE164(forwardingRaw)
  const instructionUrl = `${getAppUrl()}/api/voice/test-echo`

  const call = await initiateTexmlOutboundCall({
    fromE164,
    toE164,
    instructionUrl,
  })

  return {
    call_status: call.call_status,
    dialed: toE164,
    from: fromE164,
    message:
      "Calling your connected device now. Answer to verify voice line quality — speak after the beep, then listen for your recording played back twice.",
  }
}
