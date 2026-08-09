import { describe, expect, it } from "vitest"
import { deriveRingsNowStrip, planInboundDial } from "@/lib/inbound-dial-plan-core"

describe("planInboundDial", () => {
  const owner = "+15022602716"
  const alex = {
    receptionistId: "recv-alex",
    name: "Alex Jonas",
    phoneE164: "+15029995874",
  }

  it("Available owner (your_phone) rings owner first", () => {
    const plan = planInboundDial({
      mode: "your_phone",
      ownerPhoneE164: owner,
      captureKind: "day_dial",
    })
    expect(plan.reason).toBe("day_dial")
    expect(plan.dialTargetE164).toBe(owner)
    expect(plan.primaryHop.type).toBe("owner")
    expect(plan.ivrLive).toBe(false)
    expect(plan.busyBackupLive).toBe(false)
    expect(plan.ringsNowLabel).toBe("Owner")
    expect(plan.ifNoAnswerLabel).toBe("Booking menu")
    expect(plan.presenceStatusLabel).toBe("Available")
  })

  it("Busy + Available teammate rings teammate first", () => {
    const plan = planInboundDial({
      mode: "your_phone",
      ownerPhoneE164: owner,
      captureKind: "presence_on_job",
      busyBackup: alex,
    })
    expect(plan.reason).toBe("busy_backup_recv")
    expect(plan.dialTargetE164).toBe(alex.phoneE164)
    expect(plan.receptionistId).toBe("recv-alex")
    expect(plan.busyBackupLive).toBe(true)
    expect(plan.ivrLive).toBe(false)
    expect(plan.ringsNowLabel).toBe("Alex Jonas")
    expect(plan.ifNoAnswerLabel).toBe("Hold queue")
    expect(plan.presenceStatusLabel).toBe("Busy")
  })

  it("Busy + no teammate → hold queue (stay on line)", () => {
    const plan = planInboundDial({
      mode: "smart_ivr",
      ownerPhoneE164: owner,
      captureKind: "presence_on_job",
      busyBackup: null,
    })
    expect(plan.reason).toBe("busy_automation")
    expect(plan.dialTargetE164).toBeNull()
    expect(plan.ivrLive).toBe(true)
    expect(plan.busyBackupLive).toBe(false)
    expect(plan.ringsNowLabel).toBe("Hold queue")
    expect(plan.ifNoAnswerLabel).toBe("Booking text")
    expect(plan.presenceStatusLabel).toBe("Busy")
  })

  it("team_receptionist Available teammate rings them before owner", () => {
    const plan = planInboundDial({
      mode: "team_receptionist",
      ownerPhoneE164: owner,
      captureKind: "day_dial",
      teamReceptionist: { ...alex, isActive: true },
    })
    expect(plan.reason).toBe("team_receptionist")
    expect(plan.dialTargetE164).toBe(alex.phoneE164)
    expect(plan.fallbackHop.type).toBe("owner")
    expect(plan.ringsNowLabel).toBe("Alex Jonas")
  })

  it("team_receptionist Busy with inactive teammate → IVR", () => {
    const plan = planInboundDial({
      mode: "team_receptionist",
      ownerPhoneE164: owner,
      captureKind: "presence_closed",
      teamReceptionist: { ...alex, isActive: false },
    })
    expect(plan.reason).toBe("busy_automation")
    expect(plan.dialTargetE164).toBeNull()
    expect(plan.ivrLive).toBe(true)
  })

  it("custom_routing dials the configured number", () => {
    const plan = planInboundDial({
      mode: "custom_routing",
      ownerPhoneE164: owner,
      captureKind: "day_dial",
      customPhoneE164: "+15025551212",
    })
    expect(plan.reason).toBe("custom_routing")
    expect(plan.dialTargetE164).toBe("+15025551212")
  })
  it("Available + owner already on a live call → hold queue (no barge)", () => {
    const plan = planInboundDial({
      mode: "your_phone",
      ownerPhoneE164: owner,
      captureKind: "day_dial",
      ownerOnLiveCall: true,
    })
    expect(plan.reason).toBe("busy_automation")
    expect(plan.dialTargetE164).toBeNull()
    expect(plan.ivrLive).toBe(true)
    expect(plan.ringsNowLabel).toBe("Hold queue")
    expect(plan.presenceStatusLabel).toBe("Available")
    expect(plan.ownerAvailable).toBe(false)
  })

  it("Available + on live call + Available teammate rings teammate first", () => {
    const plan = planInboundDial({
      mode: "your_phone",
      ownerPhoneE164: owner,
      captureKind: "day_dial",
      ownerOnLiveCall: true,
      busyBackup: alex,
    })
    expect(plan.reason).toBe("busy_backup_recv")
    expect(plan.dialTargetE164).toBe(alex.phoneE164)
    expect(plan.ringsNowLabel).toBe("Alex Jonas")
    expect(plan.ifNoAnswerLabel).toBe("Hold queue")
    expect(plan.presenceStatusLabel).toBe("Available")
  })
})

describe("deriveRingsNowStrip", () => {
  it("Available shows your phone", () => {
    const strip = deriveRingsNowStrip({
      presenceBypass: false,
      presenceReady: true,
      teamRosterReady: true,
      busyBackupName: null,
      ownerLabel: "Your phone",
    })
    expect(strip.ringsNow).toBe("Your phone")
    expect(strip.ifNoAnswer).toBe("Booking menu")
    expect(strip.statusLabel).toBe("Available")
  })

  it("Available + on live call shows hold queue (honest strip)", () => {
    const strip = deriveRingsNowStrip({
      presenceBypass: false,
      presenceReady: true,
      teamRosterReady: true,
      busyBackupName: null,
      ownerLabel: "Your phone",
      ownerOnLiveCall: true,
    })
    expect(strip.ringsNow).toBe("Hold queue")
    expect(strip.ifNoAnswer).toBe("Booking text")
    expect(strip.statusLabel).toBe("Available")
  })

  it("Available + on live call + Alex shows teammate", () => {
    const strip = deriveRingsNowStrip({
      presenceBypass: false,
      presenceReady: true,
      teamRosterReady: true,
      busyBackupName: "Alex Jonas",
      ownerLabel: "Your phone",
      ownerOnLiveCall: true,
    })
    expect(strip.ringsNow).toBe("Alex Jonas")
    expect(strip.ifNoAnswer).toBe("Hold queue")
    expect(strip.statusLabel).toBe("Available")
  })

  it("Busy + Alex shows teammate LIVE story", () => {
    const strip = deriveRingsNowStrip({
      presenceBypass: true,
      presenceReady: true,
      teamRosterReady: true,
      busyBackupName: "Alex Jonas",
      ownerLabel: "Your phone",
    })
    expect(strip.ringsNow).toBe("Alex Jonas")
    expect(strip.ifNoAnswer).toBe("Hold queue")
    expect(strip.statusLabel).toBe("Busy")
  })

  it("Busy alone shows hold queue (after roster ready)", () => {
    const strip = deriveRingsNowStrip({
      presenceBypass: true,
      presenceReady: true,
      teamRosterReady: true,
      busyBackupName: null,
      ownerLabel: "Your phone",
    })
    expect(strip.ringsNow).toBe("Hold queue")
    expect(strip.ifNoAnswer).toBe("Booking text")
    expect(strip.statusLabel).toBe("Busy")
  })

  it("Busy before roster ready does not flash Hold queue", () => {
    const strip = deriveRingsNowStrip({
      presenceBypass: true,
      presenceReady: true,
      teamRosterReady: false,
      busyBackupName: null,
      ownerLabel: "Your phone",
    })
    expect(strip.ringsNow).toBe("…")
    expect(strip.statusLabel).toBe("Busy")
  })
})
