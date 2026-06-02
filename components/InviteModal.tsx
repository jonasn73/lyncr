"use client"

// Admin "Invite receptionist" modal — dark Tailwind UI with an Email / SMS toggle.
// Self-contained: renders its own trigger button + modal. POSTs { target, type } to
// /api/admin/invite, which creates a 48h invite and sends the /register link.

import { useState } from "react"
import { UserPlus, Mail, Phone, Loader2, CheckCircle2, X, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

type Channel = "EMAIL" | "SMS"

type InviteSuccess = {
  type: Channel
  target: string
  register_url: string
  sent: boolean
  send_error?: string
}

export function InviteModal() {
  const [open, setOpen] = useState(false)
  const [channel, setChannel] = useState<Channel>("EMAIL")
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<InviteSuccess | null>(null)

  function reset() {
    setChannel("EMAIL")
    setValue("")
    setError(null)
    setSuccess(null)
    setBusy(false)
  }

  function close() {
    setOpen(false)
    // Clear after the close animation so the modal doesn't flash old state when reopened.
    setTimeout(reset, 150)
  }

  async function submit() {
    const target = value.trim()
    if (!target) {
      setError(channel === "EMAIL" ? "Enter an email address" : "Enter a cell phone number")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/invite", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, type: channel }),
      })
      const json = (await res.json().catch(() => ({}))) as { data?: InviteSuccess; error?: string }
      if (!res.ok || !json.data) {
        setError(json.error ?? "Could not send the invitation.")
        return
      }
      setSuccess(json.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error — please try again.")
    } finally {
      setBusy(false)
    }
  }

  const isEmail = channel === "EMAIL"

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500"
      >
        <UserPlus className="h-4 w-4" aria-hidden />
        Invite receptionist
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close()
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-700/80 bg-slate-900 p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-100">Invite a receptionist</h2>
                <p className="mt-0.5 text-sm text-slate-400">
                  They&apos;ll get a link to set up their own account — no manual entry.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {success ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 rounded-lg border border-emerald-600/40 bg-emerald-950/40 px-4 py-3">
                  <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-400" aria-hidden />
                  <div className="text-sm text-emerald-100">
                    Invitation created for <span className="font-medium">{success.target}</span>.
                    <div className="mt-0.5 text-emerald-300/80">
                      {success.sent
                        ? `Sent via ${success.type === "EMAIL" ? "email" : "SMS"}.`
                        : `Link created, but auto-send is off${success.send_error ? ` (${success.send_error})` : ""}. Copy it below.`}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-400">Registration link</label>
                  <input
                    readOnly
                    value={success.register_url}
                    onFocus={(e) => e.currentTarget.select()}
                    className="w-full rounded-lg border border-slate-600 bg-slate-950/80 px-3 py-2 text-sm text-slate-200"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={reset}
                    className="rounded-lg border border-slate-600 px-3.5 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
                  >
                    Invite another
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-violet-500"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Email / SMS toggle */}
                <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-700 bg-slate-950/60 p-1">
                  {(["EMAIL", "SMS"] as Channel[]).map((c) => {
                    const active = channel === c
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          setChannel(c)
                          setError(null)
                        }}
                        className={cn(
                          "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                          active ? "bg-violet-600 text-white" : "text-slate-300 hover:bg-slate-800"
                        )}
                        aria-pressed={active}
                      >
                        {c === "EMAIL" ? <Mail className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
                        {c === "EMAIL" ? "Email" : "SMS"}
                      </button>
                    )
                  })}
                </div>

                <div>
                  <label htmlFor="invite-target" className="mb-1 block text-sm font-medium text-slate-300">
                    {isEmail ? "Email Address" : "Cell Phone Number"}
                  </label>
                  <input
                    id="invite-target"
                    type={isEmail ? "email" : "tel"}
                    inputMode={isEmail ? "email" : "tel"}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !busy) void submit()
                    }}
                    placeholder={isEmail ? "jordan@example.com" : "(555) 123-4567"}
                    autoFocus
                    className="w-full rounded-lg border border-slate-600 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 rounded-lg border border-red-600/40 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                    {error}
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-lg border border-slate-600 px-3.5 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void submit()}
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    {busy ? "Sending…" : "Send invite"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
