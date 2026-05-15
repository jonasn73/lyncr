// ============================================
// Sigo - Legacy Porting API Helpers
// ============================================
// Compatibility layer for legacy porting/document APIs.

const NUMBERS_API_BASE = "https://numbers.twilio.com/v1"
const NUMBERS_UPLOAD_BASE = "https://numbers-upload.twilio.com/v1"

function getLegacyProviderAuthHeader(): string {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!accountSid || !authToken) {
    throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN")
  }
  return "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64")
}

export async function uploadLegacyUtilityBill(
  fileBuffer: Buffer,
  filename: string,
  mimeType: string = "application/pdf"
): Promise<string> {
  const form = new FormData()
  form.append("document_type", "utility_bill")
  form.append("friendly_name", filename || "Utility Bill")
  form.append("File", new Blob([fileBuffer], { type: mimeType }), filename)

  const res = await fetch(`${NUMBERS_UPLOAD_BASE}/Documents`, {
    method: "POST",
    headers: {
      Authorization: getLegacyProviderAuthHeader(),
    },
    body: form,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(
      err.message || `Documents API error: ${res.status} ${res.statusText}`
    )
  }

  const data = (await res.json()) as { sid?: string }
  if (!data.sid) throw new Error("Documents API did not return sid")
  return data.sid
}

export interface LosingCarrierInformation {
  customer_type: "Business" | "Individual"
  customer_name: string
  account_number: string
  account_telephone_number: string
  authorized_representative: string
  authorized_representative_email: string
  address: {
    street: string
    street_2?: string
    city: string
    state: string
    zip: string
    country: string
  }
}

export interface CreatePortInParams {
  accountSid: string
  targetPortInDate: string
  losingCarrierInformation: LosingCarrierInformation
  phoneNumbers: { phone_number: string; pin?: string | null }[]
  documentSids: string[]
  notificationEmails?: string[]
}

export async function createLegacyPortInRequest(
  params: CreatePortInParams
): Promise<{ port_in_request_sid: string; port_in_request_status: string }> {
  const body = {
    account_sid: params.accountSid,
    target_port_in_date: params.targetPortInDate,
    losing_carrier_information: {
      customer_type: params.losingCarrierInformation.customer_type,
      customer_name: params.losingCarrierInformation.customer_name,
      account_number: params.losingCarrierInformation.account_number,
      account_telephone_number:
        params.losingCarrierInformation.account_telephone_number,
      authorized_representative:
        params.losingCarrierInformation.authorized_representative,
      authorized_representative_email:
        params.losingCarrierInformation.authorized_representative_email,
      address: {
        street: params.losingCarrierInformation.address.street,
        ...(params.losingCarrierInformation.address.street_2 && {
          street_2: params.losingCarrierInformation.address.street_2,
        }),
        city: params.losingCarrierInformation.address.city,
        state: params.losingCarrierInformation.address.state,
        zip: params.losingCarrierInformation.address.zip,
        country: params.losingCarrierInformation.address.country,
      },
    },
    phone_numbers: params.phoneNumbers.map((p) => ({
      phone_number: p.phone_number,
      pin: p.pin ?? null,
    })),
    documents: params.documentSids,
    ...(params.notificationEmails?.length && {
      notification_emails: params.notificationEmails,
    }),
  }

  const res = await fetch(`${NUMBERS_API_BASE}/Porting/PortIn`, {
    method: "POST",
    headers: {
      Authorization: getLegacyProviderAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  const data = await res.json().catch(() => ({})) as {
    port_in_request_sid?: string
    port_in_request_status?: string
    message?: string
  }

  if (!res.ok) {
    throw new Error(
      data.message || `Port In API error: ${res.status} ${res.statusText}`
    )
  }

  if (!data.port_in_request_sid) {
    throw new Error("Port In API did not return port_in_request_sid")
  }

  return {
    port_in_request_sid: data.port_in_request_sid,
    port_in_request_status: data.port_in_request_status || "In Progress",
  }
}

export async function configureLegacyPortingWebhook(portInTargetUrl: string): Promise<void> {
  const res = await fetch(`${NUMBERS_API_BASE}/Porting/Configuration/Webhook`, {
    method: "POST",
    headers: {
      Authorization: getLegacyProviderAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      port_in_target_url: portInTargetUrl,
      notifications_of: [
        "PortInWaitingForSignature",
        "PortInInProgress",
        "PortInCompleted",
        "PortInActionRequired",
        "PortInCanceled",
        "PortInPhoneNumberWaitingForSignature",
        "PortInPhoneNumberSubmitted",
        "PortInPhoneNumberPending",
        "PortInPhoneNumberCompleted",
        "PortInPhoneNumberRejected",
        "PortInPhoneNumberCanceled",
      ],
    }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(
      data.message || `Porting webhook config error: ${res.status} ${res.statusText}`
    )
  }
}

// Backward-compat exports for existing call sites.
export const uploadUtilityBill = uploadLegacyUtilityBill
export const createPortInRequest = createLegacyPortInRequest
export const configurePortingWebhook = configureLegacyPortingWebhook
