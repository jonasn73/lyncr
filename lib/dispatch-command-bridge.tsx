"use client"

// Lets workspace views register slash commands into the global ⌘K palette.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

export type DispatchSlashCommand = {
  id: string
  /** Row label in the palette. */
  label: string
  /** Slash alias shown to dispatchers (e.g. /status). */
  slash: string
  /** Extra cmdk search tokens. */
  keywords?: string
  run: () => void
}

type DispatchCommandBridgeValue = {
  commands: DispatchSlashCommand[]
  setCommands: (commands: DispatchSlashCommand[]) => void
}

const DispatchCommandBridgeContext = createContext<DispatchCommandBridgeValue | null>(null)

export function DispatchCommandBridgeProvider({ children }: { children: ReactNode }) {
  const [commands, setCommands] = useState<DispatchSlashCommand[]>([])

  const value = useMemo(
    () => ({
      commands,
      setCommands,
    }),
    [commands]
  )

  return (
    <DispatchCommandBridgeContext.Provider value={value}>
      {children}
    </DispatchCommandBridgeContext.Provider>
  )
}

export function useDispatchCommandBridge(): DispatchCommandBridgeValue {
  const ctx = useContext(DispatchCommandBridgeContext)
  if (!ctx) {
    return {
      commands: [],
      setCommands: () => {},
    }
  }
  return ctx
}

/** Register dispatch slash commands while a workspace view is mounted. */
export function useRegisterDispatchCommands(
  commands: DispatchSlashCommand[],
  deps: readonly unknown[]
): void {
  const { setCommands } = useDispatchCommandBridge()

  useEffect(() => {
    setCommands(commands)
    return () => setCommands([])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- explicit dependency list from caller
  }, [setCommands, ...deps])
}
