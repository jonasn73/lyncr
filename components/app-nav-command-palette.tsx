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
  BookUser,
  BarChart3,
  Settings,
  LifeBuoy,
  Package,
  Hash,
  ExternalLink,
  CalendarDays,
  Map,
  Radio,
  Pencil,
  UserCog,
} from "lucide-react"
import { useDispatchCommandBridge } from "@/lib/dispatch-command-bridge"
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
  { id: "dashboard", label: "Routing", href: "/dashboard", icon: Zap },
  { id: "scheduler", label: "Scheduler", href: "/dashboard/scheduler", icon: CalendarDays },
  { id: "activity", label: "Activity", href: "/dashboard/activity", icon: ClipboardList },
  { id: "leads", label: "Leads", href: "/dashboard/leads", icon: Inbox },
  { id: "customers", label: "Customers", href: "/dashboard/customers", icon: BookUser },
  { id: "contacts", label: "Map", href: "/dashboard/contacts", icon: Map },
  { id: "pay", label: "Pay", href: "/dashboard/pay", icon: BarChart3 },
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

export function AppNavCommandPalette({ enabled, open, onOpenChange }: AppNavCommandPaletteProps) {
  const router = useRouter()
  const { commands: dispatchCommands } = useDispatchCommandBridge()

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
      className="max-w-xl border border-slate-800/80 bg-slate-950/95 shadow-2xl backdrop-blur-xl"
    >
      <CommandInput placeholder="Search commands or actions…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
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
                <Radio className="size-4 shrink-0 text-emerald-400" aria-hidden />
                <span className="font-mono text-emerald-300">{command.slash}</span>
                <span>{command.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        <CommandGroup heading="Pages">
          {JUMP_PAGES.map(({ id, label, href, icon: Icon }) => (
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
            <span className="font-mono text-emerald-300">/tech</span>
            <span>Open team roster</span>
          </CommandItem>
          <CommandItem
            value="/status dispatch live status scheduler"
            onSelect={() => {
              go("/dashboard/scheduler")
            }}
          >
            <Radio className="size-4 shrink-0" aria-hidden />
            <span className="font-mono text-emerald-300">/status</span>
            <span>View dispatch status board</span>
          </CommandItem>
          <CommandItem
            value="/edit job details scheduler drawer"
            onSelect={() => {
              go("/dashboard/scheduler")
            }}
          >
            <Pencil className="size-4 shrink-0" aria-hidden />
            <span className="font-mono text-emerald-300">/edit</span>
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
      <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
        Press <kbd className="rounded border border-border bg-muted px-1 font-mono">⌘K</kbd> or{" "}
        <kbd className="rounded border border-border bg-muted px-1 font-mono">Ctrl+K</kbd> to toggle
      </div>
    </CommandDialog>
  )
}
