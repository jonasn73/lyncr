"use client"

// ============================================
// Quick jump dialog: lists every dashboard route + a few shortcuts (cmdk).
// ============================================
// Keyboard shortcut (⌘K / Ctrl+K) is registered in `AppShell` so `open` state never goes stale.

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Zap,
  ClipboardList,
  ContactRound,
  BarChart3,
  Settings,
  LifeBuoy,
  Package,
  Hash,
  ExternalLink,
  CalendarDays,
  Map,
  MessageSquare,
  Radio,
  Pencil,
  UserCog,
} from "lucide-react"
import { useDispatchCommandBridge } from "@/lib/dispatch-command-bridge"
import { useDashboardSessionOptional } from "@/components/dashboard-session-context"
import { formatPhoneDisplay } from "@/lib/dashboard-routing-utils"
import {
  requestOpenBuyNumberModal,
  requestOpenManageNumbersModal,
} from "@/components/dashboard-numbers-modal-context"
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
  // Same order as `dashboardNavItems` so the palette and the rail agree.
  { id: "dashboard", label: "Lines", href: "/dashboard", icon: Zap },
  { id: "activity", label: "Activity", href: "/dashboard/activity", icon: ClipboardList },
  { id: "messages", label: "Messages", href: "/dashboard/messages", icon: MessageSquare },
  { id: "scheduler", label: "Scheduler", href: "/dashboard/scheduler", icon: CalendarDays },
  { id: "contacts", label: "Map", href: "/dashboard/contacts", icon: Map },
  { id: "customers", label: "CRM — Customers & Leads", href: "/dashboard/customers", icon: ContactRound },
  { id: "pay", label: "Billing", href: "/dashboard/pay", icon: BarChart3 },
  { id: "settings", label: "Settings", href: "/dashboard/settings", icon: Settings },
  { id: "inventory", label: "Key inventory", href: "/dashboard/inventory", icon: Package },
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

type CustomerSearchResult = { id: string; name: string; phone: string }

export function AppNavCommandPalette({ enabled, open, onOpenChange }: AppNavCommandPaletteProps) {
  const router = useRouter()
  const { commands: dispatchCommands } = useDispatchCommandBridge()
  const accountIndustry = useDashboardSessionOptional()?.industry
  const isLocksmithAccount = !accountIndustry || accountIndustry.trim().toLowerCase() === "locksmith"
  // Key inventory (barcode scan for keys/FCC IDs) makes sense only for locksmith accounts.
  const jumpPages = isLocksmithAccount ? JUMP_PAGES : JUMP_PAGES.filter((p) => p.id !== "inventory")

  // Live customer search — reuses the same /api/crm/customers the CRM list itself calls (owner-
  // scoped, capability-gated server-side), so this was wiring, not a new search index. A failed
  // or unauthorized fetch just clears the group rather than showing an error — this is a jump
  // shortcut, not a place that needs its own error UI.
  const [search, setSearch] = useState("")
  const [customerResults, setCustomerResults] = useState<CustomerSearchResult[]>([])

  useEffect(() => {
    if (!open) {
      setSearch("")
      setCustomerResults([])
    }
  }, [open])

  useEffect(() => {
    const q = search.trim()
    if (q.length < 2) {
      setCustomerResults([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      fetch(`/api/crm/customers?q=${encodeURIComponent(q)}&limit=6`, {
        credentials: "include",
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("search"))))
        .then((json: { data?: { customers?: { id: string; display_name: string; phone_e164: string }[] } }) => {
          if (cancelled) return
          setCustomerResults(
            (json.data?.customers ?? []).map((c) => ({
              id: c.id,
              name: c.display_name?.trim() || formatPhoneDisplay(c.phone_e164),
              phone: c.phone_e164,
            }))
          )
        })
        .catch(() => {
          if (!cancelled) setCustomerResults([])
        })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [search])

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
      title="Command center"
      description="Search commands or actions"
      showCloseButton
      className="max-w-xl border border-border/80 bg-background/95 shadow-overlay backdrop-blur-xl"
    >
      <CommandInput
        placeholder="Search commands, pages, or a customer…"
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        {customerResults.length > 0 ? (
          <CommandGroup heading="Customers">
            {customerResults.map((c) => (
              <CommandItem
                key={c.id}
                value={`${search} ${c.name} ${c.phone}`}
                onSelect={() => go(`/dashboard/customers?customer=${c.id}`)}
              >
                <ContactRound className="size-4 shrink-0 text-info" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="shrink-0 text-2xs text-muted-foreground">
                  {formatPhoneDisplay(c.phone)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {dispatchCommands.length > 0 ? (
          <CommandGroup heading="Dispatch shortcuts">
            {dispatchCommands.map((command) => (
              <CommandItem
                key={command.id}
                value={`${command.slash} ${command.label} ${command.keywords ?? ""}`}
                onSelect={() => {
                  command.run()
                  onOpenChange(false)
                }}
              >
                <Radio className="size-4 shrink-0 text-success" aria-hidden />
                <span className="font-mono text-success">{command.slash}</span>
                <span>{command.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        <CommandGroup heading="Pages">
          {jumpPages.map(({ id, label, href, icon: Icon }) => (
            <CommandItem key={id} value={`${label} ${id}`} onSelect={() => go(href)}>
              <Icon className="size-4 shrink-0" aria-hidden />
              <span>{label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Quick actions">
          <CommandItem
            value="/tech team technicians contacts roster"
            onSelect={() => {
              go("/dashboard/contacts")
            }}
          >
            <UserCog className="size-4 shrink-0" aria-hidden />
            <span className="font-mono text-success">/tech</span>
            <span>Open team roster</span>
          </CommandItem>
          <CommandItem
            value="/status dispatch live status scheduler"
            onSelect={() => {
              go("/dashboard/scheduler")
            }}
          >
            <Radio className="size-4 shrink-0" aria-hidden />
            <span className="font-mono text-success">/status</span>
            <span>View dispatch status board</span>
          </CommandItem>
          <CommandItem
            value="/edit job details scheduler drawer"
            onSelect={() => {
              go("/dashboard/scheduler")
            }}
          >
            <Pencil className="size-4 shrink-0" aria-hidden />
            <span className="font-mono text-success">/edit</span>
            <span>Edit job on scheduler</span>
          </CommandItem>
          <CommandItem
            value="buy number add business phone"
            onSelect={() => {
              go("/dashboard")
              requestOpenBuyNumberModal()
              onOpenChange(false)
            }}
          >
            <Hash className="size-4 shrink-0" aria-hidden />
            <span>Buy a business number</span>
          </CommandItem>
          <CommandItem
            value="lines numbers manage phone"
            onSelect={() => {
              go("/dashboard")
              requestOpenManageNumbersModal()
              onOpenChange(false)
            }}
          >
            <Hash className="size-4 shrink-0" aria-hidden />
            <span>Lines & numbers</span>
          </CommandItem>
          <CommandItem value="support website" onSelect={() => go("/support")}>
            <ExternalLink className="size-4 shrink-0" aria-hidden />
            <span>Support site</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
      <div className="border-t border-border px-3 py-2 text-2xs text-muted-foreground">
        Press <kbd className="rounded border border-border bg-muted px-1 font-mono">⌘K</kbd> or{" "}
        <kbd className="rounded border border-border bg-muted px-1 font-mono">Ctrl+K</kbd> to toggle
      </div>
    </CommandDialog>
  )
}
