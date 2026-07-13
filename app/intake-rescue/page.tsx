"use client"

// Customer Pending Info Intake: /intake-rescue?t=… — low-friction photos + name + vehicle.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"

type PhotoSlot = {
  previewUrl: string | null
  mimeType: string
  dataBase64: string
  fileName: string
}

/** Shrink a photo on-device so Neon base64 stays under the API size cap. */
async function compressImageFile(file: File): Promise<{ mimeType: string; dataBase64: string; fileName: string }> {
  // Prefer canvas JPEG for phone camera HEIC / huge PNGs.
  const bitmap = await createImageBitmap(file)
  // Max edge ~1280 keeps ignition/lock details readable.
  const maxEdge = 1280
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas unavailable")
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const dataUrl = canvas.toDataURL("image/jpeg", 0.72)
  const dataBase64 = dataUrl.replace(/^data:image\/\w+;base64,/, "")
  return {
    mimeType: "image/jpeg",
    dataBase64,
    fileName: (file.name || "job-photo.jpg").replace(/\.\w+$/, ".jpg"),
  }
}

function emptySlot(): PhotoSlot {
  return { previewUrl: null, mimeType: "", dataBase64: "", fileName: "" }
}

/** Year options for the locked-vehicle fallback (recent → older). */
function vehicleYearChoices(): string[] {
  const now = new Date().getFullYear() + 1
  const years: string[] = []
  for (let y = now; y >= 1990; y -= 1) years.push(String(y))
  return years
}

function PhotoCaptureBox({
  label,
  hint,
  slot,
  disabled,
  onPicked,
}: {
  label: string
  hint: string
  slot: PhotoSlot
  disabled: boolean
  onPicked: (file: File | null) => void
}) {
  return (
    <label
      className={
        disabled
          ? "flex min-h-[140px] cursor-wait flex-col items-center justify-center rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50 px-3 text-center opacity-70"
          : "flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-emerald-500 bg-emerald-50 px-3 text-center active:scale-[0.99]"
      }
    >
      {slot.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={slot.previewUrl}
          alt={label}
          className="mb-2 max-h-28 w-full rounded-xl object-cover"
        />
      ) : (
        <span className="text-3xl" aria-hidden>
          📷
        </span>
      )}
      <span className="mt-1 text-sm font-semibold text-emerald-900">{label}</span>
      <span className="mt-0.5 text-[11px] text-emerald-800/80">{hint}</span>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null
          e.target.value = ""
          onPicked(file)
        }}
      />
    </label>
  )
}

function IntakeRescueInner() {
  const search = useSearchParams()
  const token = (search.get("t") || search.get("token") || "").trim()

  const [status, setStatus] = useState<"loading" | "ready" | "submitting" | "done" | "error">("loading")
  const [message, setMessage] = useState("Preparing your secure intake link…")
  const [fullName, setFullName] = useState("")
  const [vehicleVin, setVehicleVin] = useState("")
  const [specialNotes, setSpecialNotes] = useState("")
  const [damageSlot, setDamageSlot] = useState<PhotoSlot>(emptySlot)
  const [idSlot, setIdSlot] = useState<PhotoSlot>(emptySlot)
  const [decodedLine, setDecodedLine] = useState<string | null>(null)
  // Default: upload ID now for faster dispatch.
  const [verifyOnArrival, setVerifyOnArrival] = useState(false)
  // Locked vehicle / no VIN access → show Year / Make / Model fields.
  const [vinUnavailable, setVinUnavailable] = useState(false)
  const [vehicleYear, setVehicleYear] = useState("")
  const [vehicleMake, setVehicleMake] = useState("")
  const [vehicleModel, setVehicleModel] = useState("")

  const yearChoices = useMemo(() => vehicleYearChoices(), [])

  useEffect(() => {
    if (!token) {
      setStatus("error")
      setMessage("This intake link is missing or invalid.")
      return
    }
    let cancel = false
    void fetch(`/api/intake-rescue/${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (cancel) return
        if (r.status === 410) {
          setStatus("error")
          setMessage("This intake link has expired. Ask us to text a new one.")
          return
        }
        if (!r.ok) {
          setStatus("error")
          setMessage("This intake link is no longer valid.")
          return
        }
        const json = (await r.json()) as {
          data?: { already_submitted?: boolean; customer_name?: string | null }
        }
        if (json.data?.already_submitted) {
          setStatus("done")
          setMessage("Thanks — we already have your info. Key Squad will follow up shortly.")
          if (json.data.customer_name) setFullName(json.data.customer_name)
          return
        }
        setStatus("ready")
        setMessage("A few quick details help us quote accurately and dispatch faster.")
      })
      .catch(() => {
        if (!cancel) {
          setStatus("error")
          setMessage("Could not open this link. Check your connection and try again.")
        }
      })
    return () => {
      cancel = true
    }
  }, [token])

  const assignSlot = useCallback(async (file: File | null, which: "damage" | "id") => {
    if (!file) return
    const localPreview = URL.createObjectURL(file)
    const setter = which === "damage" ? setDamageSlot : setIdSlot
    setter((prev) => {
      if (prev.previewUrl) URL.revokeObjectURL(prev.previewUrl)
      return { ...emptySlot(), previewUrl: localPreview }
    })
    try {
      const compressed = await compressImageFile(file)
      setter({
        previewUrl: localPreview,
        mimeType: compressed.mimeType,
        dataBase64: compressed.dataBase64,
        fileName: compressed.fileName,
      })
    } catch {
      setter(emptySlot())
      setMessage("Could not process that photo. Try another picture.")
    }
  }, [])

  const submit = useCallback(async () => {
    if (!token) return
    if (!fullName.trim()) {
      setMessage("Please enter your full name.")
      return
    }
    if (!damageSlot.dataBase64) {
      setMessage("Please add a lock / ignition damage photo.")
      return
    }
    setStatus("submitting")
    setMessage("Submitting your intake info…")
    setDecodedLine(null)
    try {
      const photos: Array<Record<string, string>> = [
        {
          category: "damage",
          mime_type: damageSlot.mimeType,
          file_name: damageSlot.fileName,
          data_base64: damageSlot.dataBase64,
        },
      ]
      // Only attach ID photo when the customer chose to upload now.
      if (!verifyOnArrival && idSlot.dataBase64) {
        photos.push({
          category: "id_verification",
          mime_type: idSlot.mimeType,
          file_name: idSlot.fileName,
          data_base64: idSlot.dataBase64,
        })
      }
      const res = await fetch(`/api/intake-rescue/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName.trim(),
          vehicle_vin: vinUnavailable ? undefined : vehicleVin.trim() || undefined,
          special_notes: specialNotes.trim() || undefined,
          verify_on_arrival: verifyOnArrival,
          vin_unavailable: vinUnavailable,
          vehicle_year: vinUnavailable ? vehicleYear.trim() || undefined : undefined,
          vehicle_make: vinUnavailable ? vehicleMake.trim() || undefined : undefined,
          vehicle_model: vinUnavailable ? vehicleModel.trim() || undefined : undefined,
          photos,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        error?: string
        data?: {
          vehicle?: {
            year?: string | null
            make?: string | null
            model?: string | null
            trim?: string | null
          }
        }
      }
      if (!res.ok) {
        setStatus("ready")
        setMessage(json.error || "We could not save your intake. Please try again.")
        return
      }
      const v = json.data?.vehicle
      if (v?.year || v?.make || v?.model) {
        setDecodedLine([v.year, v.make, v.model, v.trim].filter(Boolean).join(" "))
      }
      setStatus("done")
      setMessage("Got it — your info was sent to Key Squad. You can close this page.")
    } catch {
      setStatus("ready")
      setMessage("Network error. Check your connection and try again.")
    }
  }, [
    token,
    fullName,
    vehicleVin,
    specialNotes,
    damageSlot,
    idSlot,
    verifyOnArrival,
    vinUnavailable,
    vehicleYear,
    vehicleMake,
    vehicleModel,
  ])

  const busy = status === "submitting" || status === "loading"

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col gap-5 px-5 py-10">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Key Squad</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
          Pending Info Intake
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-600">{message}</p>
        {decodedLine ? (
          <p className="mt-1 text-xs font-medium text-emerald-700">Vehicle: {decodedLine}</p>
        ) : null}
      </div>

      {status === "ready" || status === "submitting" ? (
        <div className="space-y-4">
          <PhotoCaptureBox
            label="Lock / Ignition Damage Photos"
            hint={damageSlot.dataBase64 ? "Tap to replace" : "Required — camera or gallery"}
            slot={damageSlot}
            disabled={busy}
            onPicked={(f) => void assignSlot(f, "damage")}
          />

          {/* ID verification: upload now vs present on arrival */}
          <fieldset className="space-y-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-zinc-700">
              ID / Registration
            </legend>
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-transparent bg-white px-3 py-2.5 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50">
              <input
                type="radio"
                name="id-mode"
                className="mt-1"
                checked={!verifyOnArrival}
                disabled={busy}
                onChange={() => setVerifyOnArrival(false)}
              />
              <span className="text-sm text-zinc-800">
                <span className="font-semibold">Upload ID now for faster dispatch</span>
                <span className="mt-0.5 block text-[11px] text-zinc-500">Default — speeds up quoting</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-transparent bg-white px-3 py-2.5 has-[:checked]:border-amber-500 has-[:checked]:bg-amber-50">
              <input
                type="radio"
                name="id-mode"
                className="mt-1"
                checked={verifyOnArrival}
                disabled={busy}
                onChange={() => setVerifyOnArrival(true)}
              />
              <span className="text-sm text-zinc-800">
                <span className="font-semibold">I will present physical ID to the technician on arrival</span>
                <span className="mt-0.5 block text-[11px] text-zinc-500">No photo needed right now</span>
              </span>
            </label>
            {!verifyOnArrival ? (
              <PhotoCaptureBox
                label="Photo of ID / Registration"
                hint={idSlot.dataBase64 ? "Tap to replace" : "Optional but recommended"}
                slot={idSlot}
                disabled={busy}
                onPicked={(f) => void assignSlot(f, "id")}
              />
            ) : (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                Our technician will verify your ID on site before unlocking.
              </p>
            )}
          </fieldset>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-700">
              Full Name <span className="text-emerald-600">*</span>
            </span>
            <input
              type="text"
              autoComplete="name"
              value={fullName}
              disabled={busy}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="First and last name"
              className="h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-base text-zinc-900 outline-none focus:border-emerald-500"
            />
          </label>

          <div className="space-y-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-700">
                Vehicle VIN <span className="font-normal normal-case text-zinc-500">(optional)</span>
              </span>
              <input
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                value={vehicleVin}
                disabled={busy || vinUnavailable}
                onChange={(e) => setVehicleVin(e.target.value.toUpperCase())}
                placeholder="17-character VIN"
                maxLength={17}
                className="h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 font-mono text-base tracking-wide text-zinc-900 outline-none focus:border-emerald-500 disabled:bg-zinc-100 disabled:text-zinc-400"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setVinUnavailable((v) => {
                  const next = !v
                  if (next) setVehicleVin("")
                  return next
                })
              }}
              className={
                vinUnavailable
                  ? "inline-flex w-full items-center justify-center rounded-full border border-amber-500 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900"
                  : "inline-flex w-full items-center justify-center rounded-full border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700"
              }
              aria-pressed={vinUnavailable}
            >
              Vehicle is locked / I don&apos;t have access to the VIN
            </button>
            {vinUnavailable ? (
              <div className="grid gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-[11px] text-zinc-600">
                  Type what you know — e.g. 2018 Kia Optima.
                </p>
                <select
                  value={vehicleYear}
                  disabled={busy}
                  onChange={(e) => setVehicleYear(e.target.value)}
                  className="h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-base text-zinc-900"
                >
                  <option value="">Year</option>
                  {yearChoices.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={vehicleMake}
                  disabled={busy}
                  onChange={(e) => setVehicleMake(e.target.value)}
                  placeholder="Make (e.g. Kia)"
                  className="h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-base text-zinc-900 outline-none focus:border-emerald-500"
                />
                <input
                  type="text"
                  value={vehicleModel}
                  disabled={busy}
                  onChange={(e) => setVehicleModel(e.target.value)}
                  placeholder="Model (e.g. Optima)"
                  className="h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 text-base text-zinc-900 outline-none focus:border-emerald-500"
                />
              </div>
            ) : (
              <p className="text-[11px] text-zinc-500">
                If provided, we decode Year / Make / Model / Trim automatically.
              </p>
            )}
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-700">
              Special Notes
            </span>
            <textarea
              value={specialNotes}
              disabled={busy}
              onChange={(e) => setSpecialNotes(e.target.value)}
              placeholder="Anything else we should know (gate code, parking, key symptoms…)"
              rows={3}
              className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-emerald-500"
            />
          </label>

          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="h-12 w-full rounded-xl bg-emerald-600 text-base font-semibold text-white disabled:opacity-60"
          >
            {status === "submitting" ? "Submitting…" : "Submit intake info"}
          </button>
        </div>
      ) : null}

      {status === "done" ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Intake received. Our dispatcher has been notified.
        </p>
      ) : null}
    </main>
  )
}

export default function IntakeRescuePage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-[100dvh] max-w-md items-center justify-center px-6">
          <p className="text-sm text-zinc-600">Loading…</p>
        </main>
      }
    >
      <IntakeRescueInner />
    </Suspense>
  )
}
