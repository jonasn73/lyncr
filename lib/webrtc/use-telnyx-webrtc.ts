"use client"

// Receptionist browser-calling engine. Lazily loads the @telnyx/webrtc SDK (client-only),
// fetches a short-lived login token from /api/receptionist/sip-token (which auto-provisions a
// Telnyx SIP credential for the agent on first use), registers the browser as a SIP endpoint,
// and surfaces incoming-call state + answer/hangup controls.
//
// Designed to be GRACEFULLY INERT: if WebRTC isn't provisioned yet (no token), it reports
// "not_provisioned" and does nothing — the inbound route already falls back to the cell (PSTN),
// so a receptionist on WEB without a registered browser never drops a call.

import { useCallback, useEffect, useRef, useState } from "react"

export type WebRtcStatus =
  | "idle" // engine off (endpoint = CELL or disabled)
  | "connecting" // fetching token / connecting socket
  | "registered" // browser registered & waiting for calls
  | "ringing" // an inbound call is ringing this browser
  | "active" // call answered & in progress
  | "not_provisioned" // Telnyx WebRTC not set up yet → safely behaves like CELL
  | "error"

export interface WebRtcCallInfo {
  callerNumber: string | null
  callerName: string | null
}

/** id of the <audio> element the SDK pipes the remote caller audio into. */
export const WEBRTC_REMOTE_AUDIO_ID = "lyncr-webrtc-remote-audio"

// --- Minimal structural typings for the parts of the SDK we touch (avoids a hard type dependency) ---
interface TelnyxCallLike {
  state: string
  options?: {
    callerNumber?: string
    callerName?: string
    remoteCallerNumber?: string
    remoteCallerName?: string
  }
  answer: () => void
  hangup: () => void
}
interface TelnyxNotificationLike {
  type: string
  call?: TelnyxCallLike
}
interface TelnyxClientLike {
  remoteElement: string
  on: (event: string, cb: (arg: unknown) => void) => void
  connect: () => void
  disconnect: () => void
}
type TelnyxRtcCtor = new (config: { login_token: string }) => TelnyxClientLike

interface TokenResponse {
  status: "ready" | "not_provisioned"
  token?: string
  reason?: string
}

export interface UseTelnyxWebRtc {
  status: WebRtcStatus
  error: string | null
  /** Inbound call details when status is "ringing" / "active". */
  call: WebRtcCallInfo | null
  /** True once the browser is registered (ready, ringing, or in a call). */
  registered: boolean
  answer: () => void
  hangup: () => void
}

export function useTelnyxWebRtc(opts: { enabled: boolean }): UseTelnyxWebRtc {
  const { enabled } = opts
  const [status, setStatus] = useState<WebRtcStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const [call, setCall] = useState<WebRtcCallInfo | null>(null)

  // Live refs so the answer/hangup callbacks always hit the current call/client.
  const activeCallRef = useRef<TelnyxCallLike | null>(null)

  useEffect(() => {
    // Engine off: clear any state and bail.
    if (!enabled) {
      setStatus("idle")
      setError(null)
      setCall(null)
      activeCallRef.current = null
      return
    }

    let cancelled = false
    let client: TelnyxClientLike | null = null

    async function start() {
      setStatus("connecting")
      setError(null)

      // 1) Ask the server for a Telnyx login token (or learn that WebRTC isn't provisioned).
      let tokenData: TokenResponse
      try {
        const res = await fetch("/api/receptionist/sip-token", { credentials: "include", cache: "no-store" })
        const json = (await res.json()) as { data?: TokenResponse; error?: string }
        if (!res.ok) throw new Error(json.error ?? "Could not fetch WebRTC token")
        tokenData = json.data ?? { status: "not_provisioned" }
      } catch (e) {
        if (cancelled) return
        setStatus("error")
        setError(e instanceof Error ? e.message : "WebRTC token error")
        return
      }
      if (cancelled) return
      if (tokenData.status !== "ready" || !tokenData.token) {
        // Not set up yet — stay inert. Inbound calls keep flowing to the cell.
        setStatus("not_provisioned")
        return
      }

      // 2) Load the SDK in the browser only, then register.
      try {
        const mod = (await import("@telnyx/webrtc")) as unknown as { TelnyxRTC: TelnyxRtcCtor }
        if (cancelled) return
        client = new mod.TelnyxRTC({ login_token: tokenData.token })
        client.remoteElement = WEBRTC_REMOTE_AUDIO_ID

        client.on("telnyx.ready", () => {
          if (!cancelled) setStatus("registered")
        })
        client.on("telnyx.error", (e: unknown) => {
          if (cancelled) return
          setStatus("error")
          const msg = (e as { error?: { message?: string } })?.error?.message
          setError(msg ?? "Telnyx connection error")
        })
        client.on("telnyx.notification", (n: unknown) => {
          if (cancelled) return
          const note = n as TelnyxNotificationLike
          if (note.type !== "callUpdate" || !note.call) return
          const c = note.call
          switch (c.state) {
            case "ringing":
            case "trying":
            case "recovering":
              activeCallRef.current = c
              setCall({
                callerNumber: c.options?.remoteCallerNumber ?? c.options?.callerNumber ?? null,
                callerName: c.options?.remoteCallerName ?? c.options?.callerName ?? null,
              })
              setStatus("ringing")
              break
            case "early":
            case "answering":
            case "active":
              activeCallRef.current = c
              setStatus("active")
              break
            case "hangup":
            case "destroy":
            case "purge":
              activeCallRef.current = null
              setCall(null)
              setStatus("registered")
              break
            default:
              break
          }
        })

        client.connect()
      } catch (e) {
        if (cancelled) return
        setStatus("error")
        setError(e instanceof Error ? e.message : "WebRTC SDK failed to load")
      }
    }

    void start()

    // Teardown on disable/unmount: disconnect the socket and reset.
    return () => {
      cancelled = true
      try {
        client?.disconnect()
      } catch {
        /* ignore disconnect errors */
      }
      activeCallRef.current = null
      setStatus("idle")
      setCall(null)
    }
  }, [enabled])

  const answer = useCallback(() => {
    try {
      activeCallRef.current?.answer()
    } catch {
      /* ignore */
    }
  }, [])

  const hangup = useCallback(() => {
    try {
      activeCallRef.current?.hangup()
    } catch {
      /* ignore */
    }
  }, [])

  return {
    status,
    error,
    call,
    registered: status === "registered" || status === "ringing" || status === "active",
    answer,
    hangup,
  }
}
