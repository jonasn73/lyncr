import { VoiceResponse, getAppUrl } from "@/lib/telnyx"
import { texmlSayNatural } from "@/lib/texml-say-voice"

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

/** Second hop — play recording twice, then hang up. */
export function buildTestEchoPlaybackTexml(recordingUrl: string): string {
  const texml = new VoiceResponse()
  const url = recordingUrl.trim()
  if (url) {
    texml.play({ loop: 2 }, url)
    texmlSayNatural(texml, "Thank you for testing the Lyncr audio line. Goodbye.")
  } else {
    texmlSayNatural(texml, "We could not retrieve your recording. Please try again later. Goodbye.")
  }
  texml.hangup()
  return texml.toString()
}
