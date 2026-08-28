"use client"

// Finger / stylus signature pad for post-payment slips (tips + sign).
// Supports a fullscreen / landscape-friendly mode so customers can see a large pad.

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { Eraser, Maximize2, X } from "lucide-react"
import { cn } from "@/lib/utils"

type Point = { x: number; y: number }

export type CustomerSignaturePadHandle = {
  clear: () => void
}

type PadProps = {
  /** Called with a PNG data URL when the customer draws, or null when cleared. */
  onChange: (dataUrl: string | null) => void
  className?: string
  /** Extra classes on the canvas element (height, etc.). */
  canvasClassName?: string
  /** Hide the expand control (e.g. already inside fullscreen). */
  hideExpand?: boolean
  /** Notify parent when ink appears / clears. */
  onHasInkChange?: (hasInk: boolean) => void
  /** When true, label says signature is optional (never required). */
  optional?: boolean
}

/** Try to lock landscape while the big pad is open (phones that allow it). */
async function tryLockLandscape(): Promise<void> {
  try {
    const orientation = window.screen?.orientation as ScreenOrientation & {
      lock?: (orientation: string) => Promise<void>
    }
    if (typeof orientation?.lock === "function") {
      await orientation.lock("landscape")
    }
  } catch {
    // Browser / PWA may deny — rotating the phone still helps.
  }
}

async function tryUnlockOrientation(): Promise<void> {
  try {
    const orientation = window.screen?.orientation as ScreenOrientation & {
      unlock?: () => void
    }
    orientation?.unlock?.()
  } catch {
    /* ignore */
  }
}

const SignatureCanvas = forwardRef<CustomerSignaturePadHandle, PadProps>(
  function SignatureCanvas({ onChange, canvasClassName, onHasInkChange }, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const drawingRef = useRef(false)
    const lastRef = useRef<Point | null>(null)
    const hasInkRef = useRef(false)
    const [hasInk, setHasInk] = useState(false)

    const setInk = useCallback(
      (next: boolean) => {
        hasInkRef.current = next
        setHasInk(next)
        onHasInkChange?.(next)
      },
      [onHasInkChange]
    )

    // Size the canvas to its CSS box (crisp on retina phones).
    const syncCanvasSize = useCallback(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = Math.max(1, Math.floor(rect.width * dpr))
      const h = Math.max(1, Math.floor(rect.height * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext("2d")
        if (ctx) {
          ctx.fillStyle = "#ffffff"
          ctx.fillRect(0, 0, w, h)
          ctx.strokeStyle = "#0f172a"
          ctx.lineWidth = 2.8 * dpr
          ctx.lineCap = "round"
          ctx.lineJoin = "round"
        }
        setInk(false)
        onChange(null)
      }
    }, [onChange, setInk])

    useEffect(() => {
      syncCanvasSize()
      const onResize = () => syncCanvasSize()
      window.addEventListener("resize", onResize)
      window.addEventListener("orientationchange", onResize)
      return () => {
        window.removeEventListener("resize", onResize)
        window.removeEventListener("orientationchange", onResize)
      }
    }, [syncCanvasSize])

    function eventPoint(e: React.PointerEvent<HTMLCanvasElement>): Point {
      const canvas = canvasRef.current!
      const rect = canvas.getBoundingClientRect()
      const dpr = canvas.width / Math.max(rect.width, 1)
      return {
        x: (e.clientX - rect.left) * dpr,
        y: (e.clientY - rect.top) * dpr,
      }
    }

    function emitPng() {
      const canvas = canvasRef.current
      if (!canvas || !hasInkRef.current) {
        onChange(null)
        return
      }
      onChange(canvas.toDataURL("image/png"))
    }

    const clear = useCallback(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      setInk(false)
      onChange(null)
    }, [onChange, setInk])

    useImperativeHandle(ref, () => ({ clear }), [clear])

    return (
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-zinc-600 bg-white">
        <canvas
          ref={canvasRef}
          className={cn("w-full touch-none cursor-crosshair", canvasClassName)}
          aria-label="Sign here with your finger"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            drawingRef.current = true
            lastRef.current = eventPoint(e)
          }}
          onPointerMove={(e) => {
            if (!drawingRef.current) return
            const canvas = canvasRef.current
            const ctx = canvas?.getContext("2d")
            const last = lastRef.current
            if (!canvas || !ctx || !last) return
            const next = eventPoint(e)
            ctx.beginPath()
            ctx.moveTo(last.x, last.y)
            ctx.lineTo(next.x, next.y)
            ctx.stroke()
            lastRef.current = next
            if (!hasInkRef.current) setInk(true)
          }}
          onPointerUp={() => {
            drawingRef.current = false
            lastRef.current = null
            emitPng()
          }}
          onPointerCancel={() => {
            drawingRef.current = false
            lastRef.current = null
            emitPng()
          }}
        />
        {!hasInk ? (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-base text-muted-foreground sm:text-lg">
            Sign here
          </p>
        ) : null}
      </div>
    )
  }
)

function FullscreenSignatureOverlay({
  onDone,
  onCancel,
  onChange,
}: {
  onDone: () => void
  onCancel: () => void
  onChange: (dataUrl: string | null) => void
}) {
  const titleId = useId()
  const padRef = useRef<CustomerSignaturePadHandle>(null)
  const [hasInk, setHasInk] = useState(false)

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    void tryLockLandscape()
    return () => {
      document.body.style.overflow = prevOverflow
      void tryUnlockOrientation()
    }
  }, [])

  if (typeof document === "undefined") return null

  return createPortal(
    <div
      className="fixed inset-0 z-[8000] flex flex-col bg-[#0b0b12] text-white"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="min-w-0">
          <p id={titleId} className="text-base font-bold">
            Customer signature
          </p>
          <p className="text-xs text-muted-foreground">
            Rotate sideways to sign, tap Done, then hand the phone back.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg p-2 text-muted-foreground hover:bg-zinc-900 hover:text-white"
          aria-label="Close large signature"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] landscape:px-4">
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => padRef.current?.clear()}
            disabled={!hasInk}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-slate-300 hover:bg-zinc-900 disabled:opacity-40"
          >
            <Eraser className="h-4 w-4" aria-hidden />
            Clear
          </button>
        </div>

        <SignatureCanvas
          ref={padRef}
          onChange={onChange}
          onHasInkChange={setHasInk}
          hideExpand
          canvasClassName="h-full min-h-[min(56dvh,480px)] landscape:min-h-[min(70dvh,560px)]"
        />

        <button
          type="button"
          onClick={onDone}
          className="w-full rounded-xl bg-emerald-600 py-4 text-base font-semibold text-white hover:bg-emerald-500"
        >
          {hasInk ? "Done — hand phone back" : "Done"}
        </button>
      </div>
    </div>,
    document.body
  )
}

export function CustomerSignaturePad({
  onChange,
  className,
  canvasClassName,
  hideExpand = false,
  optional = false,
}: PadProps) {
  const padRef = useRef<CustomerSignaturePadHandle>(null)
  const [expanded, setExpanded] = useState(false)
  const [hasInk, setHasInk] = useState(false)
  // Preview after signing in the fullscreen pad (inline canvas stays separate).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const latestFullscreenRef = useRef<string | null>(null)

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {optional ? "Customer signature (optional)" : "Customer signature"}
        </span>
        <div className="flex items-center gap-1">
          {!hideExpand ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/10"
            >
              <Maximize2 className="h-3.5 w-3.5" aria-hidden />
              Larger / landscape
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              padRef.current?.clear()
              setPreviewUrl(null)
              latestFullscreenRef.current = null
              onChange(null)
            }}
            disabled={!hasInk && !previewUrl}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-zinc-800 hover:text-slate-200 disabled:opacity-40"
          >
            <Eraser className="h-3.5 w-3.5" aria-hidden />
            Clear
          </button>
        </div>
      </div>

      {previewUrl && !hasInk ? (
        <div className="relative overflow-hidden rounded-xl border border-emerald-500/40 bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Customer signature"
            className="h-36 w-full object-contain sm:h-40"
          />
          <p className="absolute bottom-2 left-2 rounded bg-emerald-600/90 px-2 py-0.5 text-[10px] font-semibold text-white">
            Signed
          </p>
        </div>
      ) : (
        <SignatureCanvas
          ref={padRef}
          onChange={(url) => {
            setPreviewUrl(null)
            onChange(url)
          }}
          onHasInkChange={setHasInk}
          // Compact default for content-height tip sheets; use Larger / landscape for a big pad.
          canvasClassName={cn("h-36 w-full sm:h-40", canvasClassName)}
        />
      )}

      {expanded ? (
        <FullscreenSignatureOverlay
          onChange={(url) => {
            latestFullscreenRef.current = url
            onChange(url)
          }}
          onCancel={() => setExpanded(false)}
          onDone={() => {
            if (latestFullscreenRef.current) {
              setPreviewUrl(latestFullscreenRef.current)
              setHasInk(false)
            }
            setExpanded(false)
          }}
        />
      ) : null}
    </div>
  )
}
