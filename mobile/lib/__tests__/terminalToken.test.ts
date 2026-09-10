import { fetchTerminalConnectionToken } from "../terminalToken"

function mockFetchOnce(response: { ok: boolean; json: () => Promise<unknown> }) {
  const fetchMock = jest.fn().mockResolvedValue(response)
  global.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

describe("fetchTerminalConnectionToken", () => {
  afterEach(() => jest.restoreAllMocks())

  it("returns the connection-token secret on success", async () => {
    mockFetchOnce({ ok: true, json: () => Promise.resolve({ data: { secret: "term_secret_abc" } }) })
    const secret = await fetchTerminalConnectionToken()
    expect(secret).toBe("term_secret_abc")
  })

  it("sends credentials so the session cookie authorizes the request", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: () => Promise.resolve({ data: { secret: "x" } }) })
    await fetchTerminalConnectionToken()
    const [, options] = fetchMock.mock.calls[0]
    expect(options).toMatchObject({ method: "POST", credentials: "include" })
  })

  it("throws the server's error message when the session has expired", async () => {
    mockFetchOnce({ ok: false, json: () => Promise.resolve({ error: "Session expired" }) })
    await expect(fetchTerminalConnectionToken()).rejects.toThrow("Session expired")
  })

  it("throws a fallback message when ok but the secret is missing", async () => {
    mockFetchOnce({ ok: true, json: () => Promise.resolve({ data: {} }) })
    await expect(fetchTerminalConnectionToken()).rejects.toThrow("Could not fetch Terminal connection token")
  })

  it("throws a fallback message when the response body isn't valid JSON", async () => {
    mockFetchOnce({ ok: false, json: () => Promise.reject(new Error("not json")) })
    await expect(fetchTerminalConnectionToken()).rejects.toThrow("Could not fetch Terminal connection token")
  })
})
