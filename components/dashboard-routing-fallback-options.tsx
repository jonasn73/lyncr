"use client"

import type { ComponentType } from "react"
import { Phone, Voicemail, Bot, Headphones } from "lucide-react"
import type { FallbackOption } from "@/lib/dashboard-routing-utils"

export const fallbackOptions: {
  id: FallbackOption
  label: string
  description: string
  icon: ComponentType<{ className?: string }>
  color: string
  bgColor: string
}[] = [
  { id: "owner", label: "Ring Your Phone", description: "Call forwards to your cell phone", icon: Phone, color: "text-primary", bgColor: "bg-primary/10" },
  {
    id: "ai",
    label: "AI receptionist",
    description: "Voice AI answers with your industry script, collects job details, can text you leads",
    icon: Bot,
    color: "text-chart-4",
    bgColor: "bg-chart-4/10",
  },
  { id: "voicemail", label: "Voicemail", description: "Send caller to voicemail", icon: Voicemail, color: "text-warning", bgColor: "bg-warning/10" },
  {
    id: "hold",
    label: "Hold queue",
    description: "If your phone doesn’t answer, put them on hold music so you can Answer from Lines",
    icon: Headphones,
    color: "text-chart-2",
    bgColor: "bg-chart-2/10",
  },
]
