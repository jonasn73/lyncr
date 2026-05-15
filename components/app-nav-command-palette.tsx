"use client"

// ============================================
// Quick jump dialog: lists every dashboard route + a few shortcuts (cmdk).
// ============================================
// Keyboard shortcut (⌘K / Ctrl+K) is registered in `AppShell` so `open` state never goes stale.

import { useRouter } from "next/navigation"
import {
  Zap,
  ClipboardList,
  Inbox,
  Users,
  BarChart3,
  Settings,
  LifeBuoy,
  Hash,
  ExternalLink,
} from "lucide-react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

/** Every member area you can jump to (includes Help, which is not a bottom tab). */
const JUMP_PAGES = [
  { id: "dashboard", label: "Routing", href: "/dashboard", icon: Zap },
  { id: "activity", label: "Activity", href: "/dashboard/activity", icon: ClipboardList },
  { id: "leads", label: "Leads", href: "/dashboard/leads", icon: Inbox },
  { id: "contacts", label: "Team", href: "/dashboard/contacts", icon: Users },
  { id: "analytics", label: "Pay", href: "/dashboard/analytics", icon: BarChart3 },
  { id: "settings", label: "Settings", href: "/dashboard/settings", icon: Settings },
  { id: "help", label: "Help & feedback", href: "/dashboard/help", icon: LifeBuoy },
] as const

type AppNavCommandPaletteProps = {
  /** Only render when the shell is on real `/dashboard/*` URLs (not the marketing preview). */
  enabled: boolean
  /** Radix-controlled visibility for the jump dialog. */
  open: boolean
  /** Lets the shell close the dialog after navigation or when the user dismisses it. */
  onOpenChange: (open: boolean) => void
}

export function AppNavCommandPalette({ enabled, open, onOpenChange }: AppNavCommandPaletteProps) {
  const router = useRouter()

  if (!enabled) return null

  /** Push a new route and hide the palette so the next screen is unobstructed. */
  function go(href: string) {
    router.push(href)
    onOpenChange(false)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Jump to"
      description="Open any section of the app"
      showCloseButton
    >
      <CommandInput placeholder="Search pages and actions…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Pages">
          {JUMP_PAGES.map(({ id, label, href, icon: Icon }) => (
            <CommandItem key={id} value={`${label} ${id}`} onSelect={() => go(href)}>
              <Icon className="size-4 shrink-0" aria-hidden />
              <span>{label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Quick actions">
          <CommandItem value="numbers phone add business" onSelect={() => go("/dashboard/settings#business-numbers")}>
            <Hash className="size-4 shrink-0" aria-hidden />
            <span>Business numbers</span>
          </CommandItem>
          <CommandItem value="support website" onSelect={() => go("/support")}>
            <ExternalLink className="size-4 shrink-0" aria-hidden />
            <span>Support site</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
      <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
        Press <kbd className="rounded border border-border bg-muted px-1 font-mono">⌘K</kbd> or{" "}
        <kbd className="rounded border border-border bg-muted px-1 font-mono">Ctrl+K</kbd> to toggle
      </div>
    </CommandDialog>
  )
}
