import { VoiceResponse, getAppUrl } from "@/lib/telnyx"
import { texmlSayNatural } from "@/lib/texml-say-voice"
import { escapeXmlAttr } from "@/lib/telnyx-inbound-media-quality"

const TEST_ECHO_GREETING =
  "Welcome to the Lyncr audio test line. After the tone, speak for up to five seconds. We will play your recording back so you can verify call quality."

/** First hop — greeting + 5 second record window. */
export function buildTestEchoIntroTexml(): string {
  const appUrl = getAppUrl()
  const playbackAction = `${appUrl}/api/voice/test-echo?phase=playback`
  const texml = new VoiceResponse()
  texmlSayNatural(texml, TEST_ECHO_GREETING)
  texml.record({
    maxLength: 5,
    playBeep: true,
    timeout: 5,
    action: playbackAction,
    method: "POST",
  })
  return texml.toString()
}

/** Second hop — playback loop, then restart the test cycle. */
export function buildTestEchoPlaybackTexml(recordingUrl: string): string {
  const appUrl = getAppUrl()
  const safeUrl = escapeXmlAttr(recordingUrl.trim())
  const texml = new VoiceResponse()
  if (safeUrl) {
    texml.play({ loop: 2 }, recordingUrl.trim())
  }
  texmlSayNatural(
    texml,
    "That was your recording played twice. Starting another test cycle now. Hang up anytime to end."
  )
  texml.redirect({ method: "POST" }, `${appUrl}/api/voice/test-echo`)
  return texml.toString()
}
