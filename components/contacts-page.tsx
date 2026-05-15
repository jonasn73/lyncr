"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import {
  Search,
  Plus,
  Phone,
  MoreVertical,
  Star,
  Trash2,
  X,
} from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetFooter } from "@/components/ui/sheet"
import { StorySheetHeader } from "@/components/story-sheet-header"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { EmptyState } from "@/components/ui/empty-state"
import { useToast } from "@/hooks/use-toast"
import { IconSurface } from "@/components/ui/icon-surface"

interface Contact {
  id: string
  name: string
  phone: string
  initials: string
  color: string
  active: boolean
  priority: boolean
}

const initialContacts: Contact[] = [
  { id: "1", name: "Sarah Miller", phone: "(555) 234-5678", initials: "SM", color: "bg-primary", active: true, priority: true },
  { id: "2", name: "James Wilson", phone: "(555) 345-6789", initials: "JW", color: "bg-chart-2", active: false, priority: false },
  { id: "3", name: "Rachel Kim", phone: "(555) 456-7890", initials: "RK", color: "bg-chart-5", active: true, priority: true },
  { id: "4", name: "David Chen", phone: "(555) 567-8901", initials: "DC", color: "bg-chart-3", active: false, priority: false },
  { id: "5", name: "Emma Taylor", phone: "(555) 678-9012", initials: "ET", color: "bg-chart-4", active: true, priority: false },
]

export function ContactsPage() {
  const { toast } = useToast()
  const [contacts, setContacts] = useState<Contact[]>(initialContacts)
  const [searchQuery, setSearchQuery] = useState("")
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [newName, setNewName] = useState("")
  const [newPhone, setNewPhone] = useState("")
  const [teamSheet, setTeamSheet] = useState<Contact | null>(null)

  const filtered = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone.includes(searchQuery)
  )

  const teamSheetLive = useMemo(() => {
    if (!teamSheet) return null
    return contacts.find((c) => c.id === teamSheet.id) ?? teamSheet
  }, [teamSheet, contacts])

  const activeCount = contacts.filter((c) => c.active).length

  function toggleContact(id: string) {
    setContacts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, active: !c.active } : c))
    )
  }

  function togglePriority(id: string) {
    setContacts((prev) =>
      prev.map((c) => (c.id === id ? { ...c, priority: !c.priority } : c))
    )
  }

  function removeContact(id: string) {
    const removed = contacts.find((c) => c.id === id)
    setContacts((prev) => prev.filter((c) => c.id !== id))
    if (removed) {
      toast({
        title: "Team member removed",
        description: `${removed.name} will no longer receive calls.`,
      })
    }
  }

  function addContact() {
    if (!newName.trim() || !newPhone.trim()) return
    const initials = newName
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2)
    const colors = ["bg-primary", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"]
    const color = colors[Math.floor(Math.random() * colors.length)]
    setContacts((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        name: newName.trim(),
        phone: newPhone.trim(),
        initials,
        color,
        active: false,
        priority: false,
      },
    ])
    setNewName("")
    setNewPhone("")
    setShowAddDialog(false)
    toast({
      title: "Team member added",
      description: `${newName.trim()} can now be enabled for call routing.`,
    })
  }

  return (
    <div className="flex flex-col gap-4 p-4 pb-8">
      {/* Header */}
      <div className="sigo-section-header">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Team</h2>
          <p className="text-sm text-muted-foreground">
            {activeCount} of {contacts.length} currently receiving calls
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowAddDialog(true)}
          className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search contacts..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="border-border bg-card pl-9 text-foreground placeholder:text-muted-foreground"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Bulk actions */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setContacts((prev) => prev.map((c) => ({ ...c, active: true })))
          }
          className="text-xs border-border bg-card text-foreground hover:bg-secondary hover:text-secondary-foreground"
        >
          Enable All
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setContacts((prev) => prev.map((c) => ({ ...c, active: false })))
          }
          className="text-xs border-border bg-card text-foreground hover:bg-secondary hover:text-secondary-foreground"
        >
          Disable All
        </Button>
      </div>

      {/* Contact list */}
      <div className="flex flex-col gap-2">
        {filtered.map((contact) => (
          <div
            key={contact.id}
            className={cn(
              "sigo-card flex items-center justify-between p-4 transition-all",
              contact.active && "border-primary/30 bg-primary/5"
            )}
          >
            <button
              type="button"
              onClick={() => setTeamSheet(contact)}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left outline-none ring-offset-background transition-colors hover:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-primary"
            >
              <div className="relative">
                <Avatar className="h-11 w-11">
                  <AvatarFallback
                    className={cn(
                      contact.color,
                      "text-primary-foreground text-xs font-semibold"
                    )}
                  >
                    {contact.initials}
                  </AvatarFallback>
                </Avatar>
                {contact.active && (
                  <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-success" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium text-foreground">
                    {contact.name}
                  </p>
                  {contact.priority && (
                    <Star className="h-3 w-3 fill-warning text-warning" />
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <IconSurface className="h-5 w-5 rounded-md">
                    <Phone className="h-3 w-3 text-muted-foreground" />
                  </IconSurface>
                  <p className="text-xs text-muted-foreground">
                    {contact.phone}
                  </p>
                </div>
              </div>
            </button>
            <div className="flex items-center gap-2">
              <Switch
                checked={contact.active}
                onCheckedChange={() => toggleContact(contact.id)}
                aria-label={`Route calls to ${contact.name}`}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label={`Options for ${contact.name}`}>
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-card border-border text-foreground">
                  <DropdownMenuItem onClick={() => togglePriority(contact.id)} className="gap-2 text-foreground focus:bg-secondary focus:text-secondary-foreground">
                    <Star className="h-4 w-4" />
                    {contact.priority ? "Remove Priority" : "Set Priority"}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => removeContact(contact.id)} className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive">
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <EmptyState
            icon={<Search className="h-8 w-8" />}
            title="No team members found"
            description="Add a team member so you can route calls to them."
            action={(
              <button
                onClick={() => setShowAddDialog(true)}
                className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15"
              >
                Add team member
              </button>
            )}
          />
        )}
      </div>

      {/* Add contact dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="bg-card border-border text-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Add Contact</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Add a team member to receive forwarded calls.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 pt-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name" className="text-foreground">Name</Label>
              <Input
                id="name"
                placeholder="Full name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="border-border bg-secondary text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="phone" className="text-foreground">Phone Number</Label>
              <Input
                id="phone"
                placeholder="(555) 000-0000"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="border-border bg-secondary text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <Button onClick={addContact} className="mt-2 bg-primary text-primary-foreground hover:bg-primary/90">
              Add Contact
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Sheet open={teamSheet != null} onOpenChange={(o) => !o && setTeamSheet(null)} modal>
        <SheetContent side="bottom" className="gap-0 p-0 sm:mx-auto sm:max-w-lg [&>button]:top-3">
          {teamSheetLive ? (
            <>
              <StorySheetHeader
                eyebrow="Team story"
                storyline="Who answers when your business line rings — flip routing without leaving the narrative."
                title={teamSheetLive.name}
                description={
                  <>
                    {teamSheetLive.phone} · {teamSheetLive.active ? "Receiving calls" : "Paused"} ·{" "}
                    {teamSheetLive.priority ? "Priority ring order" : "Standard order"}
                  </>
                }
              />
              <div className="space-y-4 px-4 pb-4 pt-3">
                <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/60 px-3 py-2.5">
                  <span className="text-sm text-foreground">Route calls here</span>
                  <Switch
                    checked={teamSheetLive.active}
                    onCheckedChange={() => toggleContact(teamSheetLive.id)}
                    aria-label={`Route calls to ${teamSheetLive.name}`}
                  />
                </div>
                <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/60 px-3 py-2.5">
                  <span className="text-sm text-foreground">Priority</span>
                  <Switch
                    checked={teamSheetLive.priority}
                    onCheckedChange={() => togglePriority(teamSheetLive.id)}
                    aria-label="Priority"
                  />
                </div>
              </div>
              <SheetFooter className="flex flex-col gap-2 border-t border-border/70 bg-secondary/15 px-4 py-3 sm:flex-row sm:justify-between">
                <Link
                  href="/dashboard"
                  className="text-xs font-semibold text-primary underline-offset-2 hover:underline"
                  onClick={() => setTeamSheet(null)}
                >
                  Choose who answers on Call console →
                </Link>
                <button
                  type="button"
                  className="text-xs font-semibold text-destructive hover:underline"
                  onClick={() => {
                    removeContact(teamSheetLive.id)
                    setTeamSheet(null)
                  }}
                >
                  Remove from team
                </button>
              </SheetFooter>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  )
}
