---
name: lyncr-live-testers
description: >-
  Live tester accounts for Lyncr product agents. Simulators sign up as their own
  users and click through lyncr.app. Do not use the owner’s real shop (Key Squad)
  as a test login. No Telnyx number buy, no texts to real customers, no live charges.
---

# Live tester accounts

Owner standing order (Aug 18, 2026): agents **create their own usernames and test the app**. That is how real leaks are found. Reading Key Squad’s live numbers is evidence, not a substitute for signing up.

Lyncr Boss loads this skill whenever Flow Tester, Solo Owner, Customer Booking, or Customer Journey run.

## Who is who

| Persona | Signs up? | What they do |
|---------|-----------|----------------|
| **Pat** (busy locksmith owner) | Yes — new shop on lyncr.app | Sign up, onboarding, Lines, Activity, leftover pings, schedule, Collect |
| **Riley** (locked-out customer) | No account | Open **Pat’s** public book on a phone, fill ASAP and window, stop or submit only with a test phone |
| Key Squad 502 | Never log in as JR | Read-only shop evidence only |

Stable Pat login (create if missing):

- Email: `pat.tester.owner@example.com`
- Business name: `TEST Pat's Lock & Key` (must stay obviously TEST)
- Cell on signup: `+15025550111` (555 — not a real person)
- Password: only in gitignored `.cursor/test-accounts.local.md` — never commit, never put in chat with the owner unless they ask

Riley’s form phone: `+15025550112` unless the owner gave a spare test cell they control.

## Required loop (every “use the app” pass)

1. **Pat signs up** (or logs in if the TEST shop already exists).
2. Finish onboarding in **simulation / demo** — never Buy or Port a real Telnyx number.
3. **Riley** opens Pat’s book link (`/book?line=` + Pat’s demo line), not Key Squad’s shop line.
4. Click the real screens. Status each step **did it / stuck / leak**.
5. Submit Riley’s form only when the phone is 555 or the owner’s spare test cell — **never** a customer from Key Squad.
6. As Pat, see whether the lead, leftover, “we got it” text, and home alerts actually show up.

Code inspection is extra. It does not replace this loop.

## Hard bans (even while testing live)

- Do not log into Key Squad / JR’s account.
- Do not buy or port Telnyx numbers.
- Do not text Key Squad customers or random real phones.
- Do not create live charges or use a real card.
- Do not change Key Squad routing, Amber, or production Telnyx.
- Do not delete production data.
- Do not invent “I used the app” if signup, login, or a screen was blocked.

## If signup or login is blocked

Report to Lyncr Boss: what you tried, the exact screen/error, and what you could not click. Then inspect UI as **Partial**. Never pretend the loop passed.

## SMS leaks

555 numbers will not receive texts. UI leaks still count. To prove a real SMS, Boss must get a **spare test cell from the owner** first. Never “borrow” a customer number.

## Parked build (do not start until owner says Approve Phase 1)

Leftover jobs stay on home until Book / Call / Clear; next leftover does not wait all day; “skip [name]” skips. Owner said keep this in mind — not approved to build yet.
