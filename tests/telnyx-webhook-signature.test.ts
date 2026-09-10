import { describe, expect, it, afterEach } from "vitest"
import { generateKeyPairSync, sign as cryptoSign } from "crypto"
import { validateTelnyxRequest } from "@/lib/telnyx"

// Matches lib/telnyx.ts's ED25519_SPKI_PREFIX handling: generate a real Ed25519 keypair, expose
// the raw 32-byte public key as base64 (what TELNYX_PUBLIC_KEY holds), and sign with the private key.
const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const rawPublicKeyB64 = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64")

function sign(payload: string, timestamp: string): string {
  return cryptoSign(null, Buffer.from(`${timestamp}|${payload}`, "utf8"), privateKey).toString("base64")
}

describe("validateTelnyxRequest", () => {
  const previousKey = process.env.TELNYX_PUBLIC_KEY

  afterEach(() => {
    if (previousKey == null) delete process.env.TELNYX_PUBLIC_KEY
    else process.env.TELNYX_PUBLIC_KEY = previousKey
  })

  it("accepts a correctly signed, fresh payload", () => {
    process.env.TELNYX_PUBLIC_KEY = rawPublicKeyB64
    const payload = JSON.stringify({ event: "call.initiated" })
    const timestamp = String(Math.floor(Date.now() / 1000))
    expect(validateTelnyxRequest(payload, sign(payload, timestamp), timestamp)).toBe(true)
  })

  it("rejects a tampered payload", () => {
    process.env.TELNYX_PUBLIC_KEY = rawPublicKeyB64
    const payload = JSON.stringify({ event: "call.initiated" })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const signature = sign(payload, timestamp)
    expect(validateTelnyxRequest(JSON.stringify({ event: "call.hangup" }), signature, timestamp)).toBe(false)
  })

  it("rejects a signature from a different key", () => {
    process.env.TELNYX_PUBLIC_KEY = rawPublicKeyB64
    const other = generateKeyPairSync("ed25519")
    const payload = JSON.stringify({ event: "call.initiated" })
    const timestamp = String(Math.floor(Date.now() / 1000))
    const forgedSignature = cryptoSign(
      null,
      Buffer.from(`${timestamp}|${payload}`, "utf8"),
      other.privateKey
    ).toString("base64")
    expect(validateTelnyxRequest(payload, forgedSignature, timestamp)).toBe(false)
  })

  it("rejects a stale/replayed timestamp", () => {
    process.env.TELNYX_PUBLIC_KEY = rawPublicKeyB64
    const payload = JSON.stringify({ event: "call.initiated" })
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 3600)
    expect(validateTelnyxRequest(payload, sign(payload, staleTimestamp), staleTimestamp)).toBe(false)
  })

  it("rejects when TELNYX_PUBLIC_KEY is not configured", () => {
    delete process.env.TELNYX_PUBLIC_KEY
    const payload = JSON.stringify({ event: "call.initiated" })
    const timestamp = String(Math.floor(Date.now() / 1000))
    expect(validateTelnyxRequest(payload, sign(payload, timestamp), timestamp)).toBe(false)
  })

  it("rejects missing signature or timestamp", () => {
    process.env.TELNYX_PUBLIC_KEY = rawPublicKeyB64
    expect(validateTelnyxRequest("{}", "", "123")).toBe(false)
    expect(validateTelnyxRequest("{}", "sig", "")).toBe(false)
  })
})
