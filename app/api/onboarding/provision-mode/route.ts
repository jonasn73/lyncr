import { NextResponse } from "next/server"
import {
  isOnboardingTelnyxSimulationMode,
  ONBOARDING_DEV_MODE_NOTICE,
} from "@/lib/onboarding-telnyx-provision-mode"

/** Returns whether onboarding skips live Telnyx carrier purchases (for UI badge). */
export async function GET() {
  const simulation = isOnboardingTelnyxSimulationMode()
  return NextResponse.json({
    data: {
      simulation_mode: simulation,
      notice: simulation ? ONBOARDING_DEV_MODE_NOTICE : null,
    },
  })
}
