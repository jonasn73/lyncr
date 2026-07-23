"use client"

// Finger / stylus signature pad for post-payment slips (tips + sign).

import { useCallback, useEffect, useRef, useState } from "react"
import { Eraser } from "lucide-react"
import { cn } from "@/lib/utils"

type Point = { x: number; y: number }

export function CustomerSignaturePad({
  onChange,
  className,
}: {
  /** Called with a PNG data URL when the customer draws, or null when cleared. */
  onChange: (dataUrl: string | null) => void
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const lastRef = useRef<Point | null>(null)
  const hasInkRef = useRef(false)
  const [hasInk, setHasInk] = useState(false)

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
        ctx.lineWidth = 2.4 * dpr
        ctx.lineCap = "round"
        ctx.lineJoin = "round"
      }
      hasInkRef.current = false
      setHasInk(false)
      onChange(null)
    }
  }, [onChange])

  useEffect(() => {
    syncCanvasSize()
    const onResize = () => syncCanvasSize()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [syncCanvasSize])

  function eventPoint(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const dpr = canvas.width / rect.width
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
    // Compressed PNG for storage / email embed.
    onChange(canvas.toDataURL("image/png"))
  }

  function clear() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    hasInkRef.current = false
    setHasInk(false)
    onChange(null)
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Customer signature
        </span>
        <button
          type="button"
          onClick={clear}
          disabled={!hasInk}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-400 hover:bg-zinc-800 hover:text-slate-200 disabled:opacity-40"
        >
          <Eraser className="h-3.5 w-3.5" aria-hidden />
          Clear
        </button>
      </div>
      <div className="relative overflow-hidden rounded-xl border border-zinc-600 bg-white">
        <canvas
          ref={canvasRef}
          className="h-36 w-full touch-none cursor-crosshair"
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
            if (!hasInkRef.current) {
              hasInkRef.current = true
              setHasInk(true)
            }
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
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
            Sign here
          </p>
        ) : null}
      </div>
    </div>
  )
}
