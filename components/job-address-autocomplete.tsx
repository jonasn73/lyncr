"use client"

// Validated structured job-site address — must pick a complete suggestion.

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react"
import { createPortal } from "react-dom"
import { Loader2, MapPin } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  isCompleteStructuredAddress,
  isSelectableAddressSuggestion,
  structuredAddressValidationError,
  type StructuredAddress,
} from "@/lib/structured-address"
import { DEFAULT_502_SERVICE_BIAS } from "@/lib/geocode-service-bias"
import { resolveStructuredAddressFromQuery } from "@/lib/intake-address-helpers"

type AddressSuggestion = StructuredAddress & { place_id?: string | null; label?: string }

type JobAddressAutocompleteProps = {
  value: StructuredAddress | null
  onChange: (value: StructuredAddress | null) => void
  /** Pre-fill the input when CRM has a saved address (before structured verify). */
  seedQuery?: string
  /** Fired on blur with whatever is in the box — parent can parse street + city for dispatch. */
  onQueryCommit?: (query: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export type JobAddressAutocompleteHandle = {
  focus: () => void
}

function suggestionLabel(s: AddressSuggestion): string {
  return s.label?.trim() || s.formatted?.trim() || ""
}

export const JobAddressAutocomplete = forwardRef<
  JobAddressAutocompleteHandle,
  JobAddressAutocompleteProps
>(function JobAddressAutocomplete(
  {
    value,
    onChange,
    seedQuery = "",
    onQueryCommit,
    placeholder = "123 Main St, city, state ZIP",
    className,
    disabled,
  },
  ref
) {
  const [query, setQuery] = useState(value?.formatted ?? "")
  const [validated, setValidated] = useState(Boolean(value && isCompleteStructuredAddress(value)))
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [menuRect, setMenuRect] = useState<{
    top: number
    left: number
    width: number
    strategy: "fixed" | "absolute"
  } | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLUListElement>(null)
  const portalRef = useRef<HTMLElement | null>(null)

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }))

  const resolvePortalTarget = useCallback((): HTMLElement => {
    if (typeof document === "undefined") return document.body
    // Must render inside the sheet so Radix modal does not swallow clicks.
    const sheet = document.querySelector('[data-slot="sheet-content"]')
    portalRef.current = (sheet as HTMLElement | null) ?? document.body
    return portalRef.current
  }, [])

  const syncMenuRect = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    const container = resolvePortalTarget()
    const inputRect = el.getBoundingClientRect()
    const inSheet = container.dataset.slot === "sheet-content"
    if (inSheet) {
      const containerRect = container.getBoundingClientRect()
      setMenuRect({
        top: inputRect.bottom - containerRect.top + 4,
        left: inputRect.left - containerRect.left,
        width: inputRect.width,
        strategy: "absolute",
      })
      return
    }
    setMenuRect({
      top: inputRect.bottom + 4,
      left: inputRect.left,
      width: inputRect.width,
      strategy: "fixed",
    })
  }, [resolvePortalTarget])

  useEffect(() => {
    if (value?.formatted) {
      setQuery(value.formatted)
      setValidated(isCompleteStructuredAddress(value))
      return
    }
    const seed = seedQuery.trim()
    if (seed && !validated) {
      setQuery(seed)
    }
  }, [value, seedQuery, validated])

  useEffect(() => {
    function onDocPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (wrapRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener("pointerdown", onDocPointerDown)
    return () => document.removeEventListener("pointerdown", onDocPointerDown)
  }, [])

  useEffect(() => {
    if (!open) return
    syncMenuRect()
    const onMove = () => syncMenuRect()
    window.addEventListener("resize", onMove)
    window.addEventListener("scroll", onMove, true)
    return () => {
      window.removeEventListener("resize", onMove)
      window.removeEventListener("scroll", onMove, true)
    }
  }, [open, syncMenuRect, suggestions])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = query.trim()
    const minLen = /^\d/.test(trimmed) ? 2 : 3
    if (validated || trimmed.length < minLen) {
      if (!validated) setSuggestions([])
      setLoading(false)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(() => {
      void fetch(
        `/api/geocode/autocomplete?q=${encodeURIComponent(trimmed)}` +
          `&lat=${DEFAULT_502_SERVICE_BIAS.lat}&lon=${DEFAULT_502_SERVICE_BIAS.lon}`,
        {
        credentials: "include",
        cache: "no-store",
      }
      )
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("suggest"))))
        .then((j: { data?: { suggestions?: AddressSuggestion[] } }) => {
          const list = Array.isArray(j.data?.suggestions) ? j.data!.suggestions! : []
          setSuggestions(list.filter(isSelectableAddressSuggestion))
          setOpen(true)
        })
        .catch(() => setSuggestions([]))
        .finally(() => setLoading(false))
    }, 150)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, validated])

  async function pickSuggestion(s: AddressSuggestion) {
    if (isCompleteStructuredAddress(s)) {
      setQuery(s.formatted)
      setValidated(true)
      onChange(s)
      setOpen(false)
      return
    }
    const placeId = s.place_id?.trim()
    if (!placeId) return
    setResolving(true)
    try {
      const res = await fetch(`/api/geocode/place-details?place_id=${encodeURIComponent(placeId)}`, {
        credentials: "include",
        cache: "no-store",
      })
      const json = (await res.json()) as { data?: { address?: StructuredAddress } }
      const addr = json.data?.address
      if (!addr || !isCompleteStructuredAddress(addr)) return
      setQuery(addr.formatted)
      setValidated(true)
      onChange(addr)
      setOpen(false)
    } catch {
      /* keep typing */
    } finally {
      setResolving(false)
    }
  }

  async function tryResolveOnBlur() {
    if (validated || resolving || disabled) return
    const trimmed = query.trim()
    if (trimmed.length < minLen) return

    if (suggestions.length > 0) {
      await pickSuggestion(suggestions[0]!)
      return
    }

    setResolving(true)
    try {
      const addr = await resolveStructuredAddressFromQuery(trimmed)
      if (addr) {
        setQuery(addr.formatted)
        setValidated(true)
        onChange(addr)
        setOpen(false)
        return
      }
    } catch {
      /* fall through to loose commit */
    } finally {
      setResolving(false)
    }

    onQueryCommit?.(trimmed)
  }

  const validationError = validated ? null : structuredAddressValidationError(value)
  const minLen = /^\d/.test(query.trim()) ? 2 : 3

  const dropdown =
    open && !validated && suggestions.length > 0 && menuRect ? (
      <ul
        ref={dropdownRef}
        data-address-suggestions
        style={{
          position: menuRect.strategy,
          top: menuRect.top,
          left: menuRect.left,
          width: menuRect.width,
          zIndex: 120,
        }}
        className="pointer-events-auto max-h-48 overflow-y-auto rounded-lg border border-border/70 bg-card py-1 shadow-xl"
      >
        {suggestions.map((s, idx) => (
          <li key={`${s.place_id ?? s.formatted}-${idx}`}>
            <button
              type="button"
              className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted/60"
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                void pickSuggestion(s)
              }}
            >
              {suggestionLabel(s)}
            </button>
          </li>
        ))}
      </ul>
    ) : null

  return (
    <div ref={wrapRef} className="relative grid gap-1">
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          data-intake-primary-search=""
          className={cn(
            "w-full rounded-lg border border-border/70 bg-background py-2 pl-9 pr-9 text-sm text-foreground placeholder:text-zinc-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary",
            validated && "border-emerald-500/50",
            className
          )}
          placeholder={placeholder}
          value={query}
          disabled={disabled || resolving}
          onChange={(e) => {
            setQuery(e.target.value)
            setValidated(false)
            onChange(null)
          }}
          onFocus={() => {
            resolvePortalTarget()
            syncMenuRect()
            if (!validated && query.trim().length >= minLen) setOpen(true)
          }}
          onBlur={() => {
            window.setTimeout(() => void tryResolveOnBlur(), 180)
          }}
          autoComplete="off"
        />
        {loading || resolving ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-500" aria-hidden />
        ) : null}
      </div>
      {typeof document !== "undefined" && dropdown
        ? createPortal(dropdown, resolvePortalTarget())
        : null}
      {!validated && query.trim().length >= minLen && !loading && !resolving && suggestions.length === 0 ? (
        <p className="text-xs text-amber-400">Keep typing — pick a suggested address with street number, city, and ZIP.</p>
      ) : null}
      {validationError && query.trim() ? <p className="text-xs text-destructive">{validationError}</p> : null}
      {validated && value ? (
        <p className="text-[11px] text-zinc-500">
          {value.street_number} {value.route}, {value.locality} {value.postal_code}
        </p>
      ) : null}
    </div>
  )
})

export function structuredAddressFromFormValue(raw: unknown): StructuredAddress | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Partial<StructuredAddress>
  return isCompleteStructuredAddress(o) ? o : null
}
