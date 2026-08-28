import { describe, expect, it, vi, beforeEach } from "vitest"

const getUserIdFromRequest = vi.fn()
const getReceptionistPortalContext = vi.fn()
const saveCallIntake = vi.fn()
const createUnassignedJobFromIntake = vi.fn()
const listOrganizationsForOwner = vi.fn()

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  // `after` needs a request scope that a unit test does not have.
  after: (fn: () => unknown) => void fn,
}))
vi.mock("@/lib/auth", () => ({
  getUserIdFromRequest: (...a: unknown[]) => getUserIdFromRequest(...a),
}))
vi.mock("@/lib/receptionist-portal-auth", () => ({
  getReceptionistPortalContext: (...a: unknown[]) => getReceptionistPortalContext(...a),
}))
vi.mock("@/lib/intake-engine", () => ({
  saveCallIntake: (...a: unknown[]) => saveCallIntake(...a),
}))
vi.mock("@/lib/create-intake-job", () => ({
  createUnassignedJobFromIntake: (...a: unknown[]) => createUnassignedJobFromIntake(...a),
}))
vi.mock("@/lib/db", () => ({
  listOrganizationsForOwner: (...a: unknown[]) => listOrganizationsForOwner(...a),
}))
vi.mock("@/lib/geocode-persist", () => ({
  persistLeadAddressFromFields: vi.fn(),
}))

import { POST as receptionistIntakePost } from "@/app/api/receptionist/intake/route"

function intakeRequest(body: Record<string, unknown>) {
  return new Request("https://lyncr.app/api/receptionist/intake", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: "lyncr_session=abc" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof receptionistIntakePost>[0]
}

const LOCKSMITH_CALL = {
  callLogId: "call-1",
  businessType: "locksmith",
  callerNumber: "+15025551234",
  callerName: "Dana Reyes",
  fields: {
    job_address: "123 Main St, Louisville KY 40202",
    job_notes: "Gate code 4412",
    job_type: "Lockout",
    vehicle_year: "2021",
    vehicle_make: "Ford",
    vehicle_model: "F-150",
    vin: "1FTFW1E50MFA00000",
    all_keys_lost: true,
  },
}

beforeEach(() => {
  // Call history has to reset too — these assertions read mock.calls[0].
  vi.clearAllMocks()
  getUserIdFromRequest.mockReturnValue("recep-1")
  getReceptionistPortalContext.mockResolvedValue({
    owner_user_id: "owner-1",
    receptionist: { id: "recep-row-1", name: "Dana" },
  })
  saveCallIntake.mockResolvedValue({ id: "lead-1", sms_sent: true, sms_error: null, sms_to: "+15025559999" })
  createUnassignedJobFromIntake.mockResolvedValue({ id: "lead-1" })
  listOrganizationsForOwner.mockResolvedValue([{ id: "org-1", is_default: true }])
})

describe("receptionist intake → scheduler hopper", () => {
  it("promotes the lead it just wrote instead of inserting a second row", async () => {
    const res = await receptionistIntakePost(intakeRequest(LOCKSMITH_CALL))
    const json = (await res.json()) as { data: { intake_id: string; hopper_job_created: boolean } }

    expect(json.data).toMatchObject({ intake_id: "lead-1", hopper_job_created: true })
    expect(createUnassignedJobFromIntake).toHaveBeenCalledTimes(1)
    expect(createUnassignedJobFromIntake.mock.calls[0][0]).toMatchObject({
      ownerUserId: "owner-1",
      existingLeadId: "lead-1",
      organizationId: "org-1",
    })
  })

  it("carries the intake fields onto the job the owner will see", async () => {
    await receptionistIntakePost(intakeRequest(LOCKSMITH_CALL))
    expect(createUnassignedJobFromIntake.mock.calls[0][0]).toMatchObject({
      callerE164: "+15025551234",
      customerName: "Dana Reyes",
      addressLine1: "123 Main St, Louisville KY 40202",
      notes: "Gate code 4412",
      jobType: "Lockout",
      vehicleYear: "2021",
      vehicleMake: "Ford",
      vehicleModel: "F-150",
      vehicleVin: "1FTFW1E50MFA00000",
      pendingCallback: false,
    })
  })

  it("never texts the caller — that would be a new outbound message", async () => {
    await receptionistIntakePost(intakeRequest(LOCKSMITH_CALL))
    expect(createUnassignedJobFromIntake.mock.calls[0][0].deferCustomerSms).toBe(true)
  })

  it("files a job with no address as a callback rather than inventing one", async () => {
    const noAddress = { ...LOCKSMITH_CALL, fields: { ...LOCKSMITH_CALL.fields, job_address: "" } }
    await receptionistIntakePost(intakeRequest(noAddress))
    expect(createUnassignedJobFromIntake.mock.calls[0][0].pendingCallback).toBe(true)
  })

  it("falls back to the caller's number when no name was captured", async () => {
    const noName = { ...LOCKSMITH_CALL, callerName: null, fields: { ...LOCKSMITH_CALL.fields } }
    await receptionistIntakePost(intakeRequest(noName))
    expect(createUnassignedJobFromIntake.mock.calls[0][0].customerName).toBe("+15025551234")
  })

  it("keeps her intake when the job cannot be built — a live call must not lose it", async () => {
    createUnassignedJobFromIntake.mockRejectedValue(new Error("Customer name is required."))
    const res = await receptionistIntakePost(intakeRequest(LOCKSMITH_CALL))
    const json = (await res.json()) as { data: { intake_id: string; hopper_job_created: boolean } }

    expect(res.status).toBe(200)
    expect(json.data.intake_id).toBe("lead-1")
    expect(json.data.hopper_job_created).toBe(false)
  })

  it("still records the owner's lead-alert SMS outcome", async () => {
    const res = await receptionistIntakePost(intakeRequest(LOCKSMITH_CALL))
    const json = (await res.json()) as { data: { sms_sent: boolean; sms_to: string } }
    expect(json.data.sms_sent).toBe(true)
    expect(json.data.sms_to).toBe("+15025559999")
  })
})
