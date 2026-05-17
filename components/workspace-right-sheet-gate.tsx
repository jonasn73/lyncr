"use client"

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { WORKSPACE_SHEET_CLASS } from "@/lib/workspace-sheet-classes"

const OpenContext = createContext<((value: unknown) => void) | null>(null)

/**
 * Keeps sheet open/close state in this gate so memoized table children do not
 * re-render when the drawer toggles (stable `open` fn in context).
 */
export function WorkspaceRightSheetGate<T>({
  children,
  render,
  sheetClassName = WORKSPACE_SHEET_CLASS,
}: {
  children: ReactNode
  render: (value: T, close: () => void) => ReactNode
  sheetClassName?: string
}) {
  const [value, setValue] = useState<T | null>(null)
  const open = useCallback((next: T) => setValue(next), [])
  const close = useCallback(() => setValue(null), [])

  return (
    <>
      <OpenContext.Provider value={open as (value: unknown) => void}>{children}</OpenContext.Provider>
      <Sheet open={value != null} onOpenChange={(o) => !o && close()} modal>
        <SheetContent side="right" variant="drawer" className={sheetClassName}>
          {value != null ? render(value, close) : null}
        </SheetContent>
      </Sheet>
    </>
  )
}

export function useWorkspaceRightSheet<T>(): (value: T) => void {
  const open = useContext(OpenContext)
  if (!open) {
    throw new Error("useWorkspaceRightSheet must be used inside WorkspaceRightSheetGate")
  }
  return open as (value: T) => void
}
