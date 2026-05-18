import type { FormEvent, KeyboardEvent } from "react"

/** Prevent full-page reload on form submit — use on every `<form onSubmit>`. */
export function submitFormEvent(e: FormEvent): void {
  e.preventDefault()
}

/**
 * Run `action` when Enter is pressed on a single-line field.
 * Skips textarea (native line break) and IME composition.
 */
export function onEnterKeyDown(
  e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  action: () => void,
  options?: { when?: () => boolean }
): void {
  if (e.key !== "Enter") return
  if (e.shiftKey) return
  if (e.nativeEvent.isComposing) return
  if (e.currentTarget instanceof HTMLTextAreaElement) return
  e.preventDefault()
  e.stopPropagation()
  if ((options?.when ?? (() => true))()) action()
}
