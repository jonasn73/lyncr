"use client"

// Validated structured job-site address — must pick a complete suggestion.

import { useEffect, useRef, useState } from "react"
import { Loader2, MapPin } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  isCompleteStructuredAddress,
  structuredAddressValidationError,
  type StructuredAddress,
} from "@/lib/structured-address"

type AddressSuggestion = StructuredAddress & { place_id?: string | null }

type JobAddressAutocompleteProps = {
  value: StructuredAddress | null
  onChange: (value: StructuredAddress | null) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function JobAddressAutocomplete({
  value,
  onChange,
  placeholder = "123 Main St, city, state ZIP",
  className,
  disabled,
}: JobAddressAutocompleteProps) {
  const [query, setQuery] = useState(value?.formatted ?? "")
  const [validated, setValidated] = useState(Boolean(value && isCompleteStructuredAddress(value)))
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (value?.formatted) {
      setQuery(value.formatted)
      setValidated(isCompleteStructuredAddress(value))
    }
  }, [value])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = query.trim()
    if (validated || trimmed.length < 3) {
      if (!validated) setSuggestions([])
      setLoading(false)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(() => {
      void fetch(`/api/geocode/autocomplete?q=${encodeURIComponent(trimmed)}`, {
        credentials: "include",
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("suggest"))))
        .then((j: { data?: { suggestions?: AddressSuggestion[] } }) => {
          setSuggestions(Array.isArray(j.data?.suggestions) ? j.data!.suggestions! : [])
          setOpen(true)
        })
        .catch(() => setSuggestions([]))
        .finally(() => setLoading(false))
    }, 320)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, validated])

  const validationError = validated ? null : structuredAddressValidationError(value)

  return (
    <div ref={wrapRef} className="relative grid gap-1">
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" aria-hidden />
        <input
          type="text"
          className={cn(
            "w-full rounded-lg border border-border/70 bg-background py-2 pl-9 pr-9 text-sm text-foreground placeholder:text-zinc-500 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary",
            validated && "border-emerald-500/50",
            className
          )}
          placeholder={placeholder}
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value)
            setValidated(false)
            onChange(null)
          }}
          onFocus={() => suggestions.length > 0 && !validated && setOpen(true)}
          autoComplete="off"
        />
        {loading ? (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-500" aria-hidden />
        ) : null}
      </div>
      {open && !validated && suggestions.length > 0 ? (
        <ul className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border/70 bg-card py-1 shadow-lg top-full">
          {suggestions.map((s) => (
            <li key={`${s.formatted}-${s.postal_code}`}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted/60"
                onClick={() => {
                  setQuery(s.formatted)
                  setValidated(true)
                  onChange(s)
                  setOpen(false)
                }}
              >
                {s.formatted}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {!validated && query.trim().length >= 3 && !loading && suggestions.length === 0 ? (
        <p className="text-xs text-amber-400">Pick a suggested address with street number, city, and ZIP.</p>
      ) : null}
      {validationError && query.trim() ? <p className="text-xs text-destructive">{validationError}</p> : null}
      {validated && value ? (
        <p className="text-[11px] text-zinc-500">
          {value.street_number} {value.route}, {value.locality} {value.postal_code}
        </p>
      ) : null}
    </div>
  )
}

export function structuredAddressFromFormValue(raw: unknown): StructuredAddress | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Partial<StructuredAddress>
  return isCompleteStructuredAddress(o) ? o : null
}
