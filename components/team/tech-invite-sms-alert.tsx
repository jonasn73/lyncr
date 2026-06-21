"use client"

import type { TechInviteSmsErrorType } from "@/lib/tech-invite-sms-types"
import { TECH_INVITE_SMS_ERROR_HEADLINES } from "@/lib/tech-invite-sms-types"

export type TechInviteAlertProps = {
  name: string
  phone?: string
  setupUrl: string
  smsSent?: boolean
  success?: boolean
  errorType?: TechInviteSmsErrorType
  message?: string | null
  smsError?: string | null
  expiresHint?: boolean
}

function formatPhoneDisplay(phone: string): string {
  const d = phone.replace(/\D/g, "")
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return phone
}

/** Owner-facing banner after adding or re-inviting a field technician. */
export function TechInviteSmsAlert({
  name,
  phone,
  setupUrl,
  smsSent,
  success,
  errorType,
  message,
  smsError,
  expiresHint = true,
}: TechInviteAlertProps) {
  const sentOk = smsSent && success !== false && !errorType

  if (sentOk) {
    return (
      <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-200">
          Invite texted to {name}
        </p>
        {phone ? (
          <p className="mt-1 text-xs text-emerald-100/80">
            We sent a secure setup link to {formatPhoneDisplay(phone)}. They tap it, pick a password,
            and they&apos;re in — no password for you to manage.
          </p>
        ) : null}
        {expiresHint ? (
          <p className="mt-2 text-[11px] text-emerald-100/60">Link expires in 48 hours.</p>
        ) : null}
      </div>
    )
  }

  const is10Dlc = errorType === "10DLC_BLOCK"
  const headline =
    message?.trim() ||
    (errorType ? TECH_INVITE_SMS_ERROR_HEADLINES[errorType] : TECH_INVITE_SMS_ERROR_HEADLINES.OTHER)

  const detail =
    errorType === "10DLC_BLOCK"
      ? "Register 10DLC under Settings → SMS lead-alert registration, or share this setup link manually:"
      : errorType === "PORTING"
        ? "Copy the setup link below and text it to your technician until the port finishes:"
        : errorType === "NO_SMS_LINE" || errorType === "INVALID_SENDER"
          ? "Add or finish your business line under Settings → Lines, or share this setup link manually:"
          : smsError && !message
            ? `(${smsError}) Share this setup link with them directly:`
            : "Share this setup link with them directly:"

  return (
    <div
      className={
        is10Dlc
          ? "mb-4 rounded-xl border border-red-500/40 bg-red-950/50 p-4"
          : "mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4"
      }
    >
      <p
        className={`text-sm font-semibold ${is10Dlc ? "text-red-200" : "text-amber-200"}`}
      >
        {is10Dlc ? "⚠️ " : ""}
        Invite created for {name}
      </p>
      <p className={`mt-1 text-xs ${is10Dlc ? "text-red-100/80" : "text-amber-100/80"}`}>
        <span className="block font-medium">{headline}</span>
        <span className="mt-1 block">{detail}</span>
      </p>
      <p
        className={`mt-2 break-all rounded-lg p-2 font-mono text-[11px] ${
          is10Dlc ? "bg-black/40 text-red-100/90" : "bg-black/30 text-amber-100"
        }`}
      >
        {setupUrl}
      </p>
      {expiresHint ? (
        <p className={`mt-2 text-[11px] ${is10Dlc ? "text-red-200/60" : "text-amber-100/60"}`}>
          Link expires in 48 hours.
        </p>
      ) : null}
    </div>
  )
}
