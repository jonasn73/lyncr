import type { FormEvent } from "react"

/** Prevent full-page reload on form submit — use on every `<form onSubmit>`. */
export function submitFormEvent(e: FormEvent): void {
  e.preventDefault()
}
