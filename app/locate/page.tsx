"use client"

// Customer-facing page: /locate?c=[token] — request GPS and post to /api/locate/[token].

import { Suspense, useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"

function LocateInner() {
  const search = useSearchParams()
  const token = (search.get("c") || search.get("token") || "").trim()
  const [status, setStatus] = useState<"loading" | "ready" | "sharing" | "done" | "error">("loading")
  const [message, setMessage] = useState("Preparing secure location link…")

  useEffect(() => {
    if (!token) {
      setStatus("error")
      setMessage("This locate link is missing or invalid.")
      return
    }
    let cancel = false
    void fetch(`/api/locate/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (cancel) return
        if (r.status === 410) {
          setStatus("error")
          setMessage("This locate link has expired. Ask us to text a new one.")
          return
        }
        if (!r.ok) {
          setStatus("error")
          setMessage("This locate link is no longer valid.")
          return
        }
        const json = (await r.json()) as { data?: { status?: string } }
        if (json.data?.status === "shared") {
          setStatus("done")
          setMessage("Location already shared — thank you!")
          return
        }
        setStatus("ready")
        setMessage("Tap Allow when your phone asks for location so we can find you faster.")
      })
      .catch(() => {
        if (!cancel) {
          setStatus("error")
          setMessage("Could not open this locate link. Check your connection and try again.")
        }
      })
    return () => {
      cancel = true
    }
  }, [token])

  const shareLocation = useCallback(() => {
    if (!token || !navigator.geolocation) {
      setStatus("error")
      setMessage("Location is not available on this device.")
      return
    }
    setStatus("sharing")
    setMessage("Requesting your location…")
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const latitude = pos.coords.latitude
        const longitude = pos.coords.longitude
        void fetch(`/api/locate/${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ latitude, longitude }),
        })
          .then(async (r) => {
            if (!r.ok) {
              setStatus("error")
              setMessage("We could not save your location. Please try again.")
              return
            }
            setStatus("done")
            setMessage("Got it — we have your live location. You can close this page.")
          })
          .catch(() => {
            setStatus("error")
            setMessage("Network error while sharing location.")
          })
      },
      () => {
        setStatus("error")
        setMessage("Location permission was denied. Enable location and try again.")
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    )
  }, [token])

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Key Squad</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">Share your location</h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600">{message}</p>
      </div>
      {status === "ready" || status === "sharing" ? (
        <button
          type="button"
          onClick={shareLocation}
          disabled={status === "sharing"}
          className="rounded-xl bg-emerald-600 px-4 py-3 text-base font-semibold text-white disabled:opacity-60"
        >
          {status === "sharing" ? "Sharing…" : "Allow live GPS"}
        </button>
      ) : null}
      {status === "done" ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Location shared successfully.
        </p>
      ) : null}
    </main>
  )
}

export default function LocatePage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-[100dvh] max-w-md items-center justify-center px-6">
          <p className="text-sm text-zinc-600">Loading…</p>
        </main>
      }
    >
      <LocateInner />
    </Suspense>
  )
}
