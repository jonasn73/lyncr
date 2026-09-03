import { describe, expect, it } from "vitest"
import {
  MASTER_TEST_ACCOUNT_EMAIL,
  buildServiceContext,
  hasPremiumCapability,
  isMasterTestAccount,
} from "@/lib/service-context"

describe("service-context", () => {
  it("recognizes Jonas master test account", () => {
    expect(isMasterTestAccount(MASTER_TEST_ACCOUNT_EMAIL)).toBe(true)
    expect(isMasterTestAccount("  JonasN73@Gmail.com ")).toBe(true)
    expect(isMasterTestAccount("other@example.com")).toBe(false)
  })

  it("grants all premium capabilities for master bypass", () => {
    const ctx = buildServiceContext({ email: MASTER_TEST_ACCOUNT_EMAIL }, { subscription_tier: "starter" })
    expect(ctx.master_test_bypass).toBe(true)
    expect(ctx.capabilities.multi_tenant_workspaces).toBe(true)
    expect(ctx.capabilities.operator_pooling).toBe(true)
    expect(ctx.capabilities.unlimited_text_dispatches).toBe(true)
    expect(ctx.capabilities.ai_voice_assistant).toBe(true)
    expect(ctx.active_number_limit).toBe(999)
  })

  it("requires professional or business for multi-tenant", () => {
    expect(hasPremiumCapability("a@b.com", "starter", "multi_tenant_workspaces")).toBe(false)
    expect(hasPremiumCapability("a@b.com", "professional", "multi_tenant_workspaces")).toBe(true)
    expect(hasPremiumCapability("a@b.com", "business", "multi_tenant_workspaces")).toBe(true)
  })

  it("requires professional or business for the AI voice assistant (087)", () => {
    expect(hasPremiumCapability("a@b.com", "free_trial", "ai_voice_assistant")).toBe(false)
    expect(hasPremiumCapability("a@b.com", "starter", "ai_voice_assistant")).toBe(false)
    expect(hasPremiumCapability("a@b.com", "professional", "ai_voice_assistant")).toBe(true)
    expect(hasPremiumCapability("a@b.com", "business", "ai_voice_assistant")).toBe(true)

    const starterCtx = buildServiceContext({ email: "a@b.com" }, { subscription_tier: "starter" })
    expect(starterCtx.capabilities.ai_voice_assistant).toBe(false)
    const proCtx = buildServiceContext({ email: "a@b.com" }, { subscription_tier: "professional" })
    expect(proCtx.capabilities.ai_voice_assistant).toBe(true)
  })
})
