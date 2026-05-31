# lyncr - Cursor Setup Guide

## Quick Start

### 1. Install Dependencies
```bash
pnpm install
pnpm add telnyx twilio @neondatabase/serverless ai @ai-sdk/openai
# OR for Supabase:
pnpm add telnyx twilio @supabase/supabase-js ai @ai-sdk/openai
```

### 2. Create Database
Run `scripts/001-create-schema.sql` against your Postgres database (Supabase SQL editor or Neon console).

### 3. Environment Variables
Create `.env.local`:
```env
# Database
DATABASE_URL=postgresql://...

# Telnyx
TELNYX_API_KEY=KEY...
TELNYX_PUBLIC_KEY=PK... # optional webhook signature validation
NEXT_PUBLIC_APP_URL=https://your-app.vercel.app

# AI (optional - for AI receptionist)
OPENAI_API_KEY=sk-...
```

### 4. Implement Database Functions
Open `lib/db.ts` -- every function has the correct type signature and a TODO comment with the example query. Replace the `throw` statements with real queries.

### 5. Configure Telnyx
1. Create a Telnyx account.
2. Buy a number in Telnyx (or use the app's Buy Number UI).
3. Point voice routing to your lyncr TeXML webhook: `https://your-app.vercel.app/api/voice/telnyx/incoming`.
4. Ensure fallback/status callbacks resolve under `/api/voice/telnyx/*`.

### 6. Wire Up the Frontend
The UI components use `useState` with mock data. To connect to real data:
- Replace mock data arrays with SWR hooks that fetch from /api/* routes
- Replace state setters with API calls (e.g., PUT /api/routing when user changes receptionist)
- Example pattern:
```tsx
import useSWR from "swr"
const { data: routing, mutate } = useSWR("/api/routing", fetcher)

async function updateRouting(receptionistId: string | null) {
  await fetch("/api/routing", {
    method: "PUT",
    body: JSON.stringify({ selected_receptionist_id: receptionistId }),
  })
  mutate()
}
```

## File Map

```
zing/
├── app/
│   ├── api/
│   │   ├── voice/
│   │   │   ├── incoming/route.ts      ← Telnyx calls this when phone rings
│   │   │   ├── fallback/route.ts      ← Handles no-answer (owner/AI/voicemail)
│   │   │   ├── ai-assistant/route.ts  ← AI converses with caller
│   │   │   ├── status/route.ts        ← Logs call completion
│   │   │   └── recording-status/      ← Attaches recording URLs
│   │   ├── routing/route.ts           ← GET/PUT who receives calls
│   │   ├── calls/route.ts             ← GET call history
│   │   ├── numbers/
│   │   │   ├── route.ts               ← GET owned / POST search available
│   │   │   ├── buy/route.ts           ← Purchase a number
│   │   │   └── port/route.ts          ← Submit port request
│   │   └── analytics/route.ts         ← Talk time + pay data
│   ├── page.tsx                       ← Entry point, renders AppShell
│   ├── layout.tsx                     ← Root layout, fonts, metadata
│   └── globals.css                    ← Theme tokens, Tailwind config
├── components/
│   ├── app-shell.tsx                  ← Bottom tab nav + header
│   ├── dashboard-page.tsx             ← Main routing screen
│   ├── activity-page.tsx              ← Call log
│   ├── contacts-page.tsx              ← Manage receptionists
│   ├── analytics-page.tsx             ← Talk time + pay tracking
│   ├── settings-page.tsx              ← Settings + buy/port numbers
│   └── ui/                            ← shadcn component library
├── lib/
│   ├── types.ts                       ← All TypeScript interfaces
│   ├── db.ts                          ← Database query functions (implement these)
│   ├── telnyx.ts                      ← Telnyx client + TeXML helpers
│   └── utils.ts                       ← cn() utility
├── scripts/
│   └── 001-create-schema.sql          ← Postgres schema
└── .cursorrules                       ← AI assistant context (this project's rules)
```

## Call Flow Diagram

```
Incoming Call
    │
    ▼
POST /api/voice/incoming
    │
    ├── Look up user by business number (getUserByPhoneNumber)
    ├── Get routing config (getRoutingConfig)
    ├── Log the call (insertCallLog)
    │
    ├── Receptionist selected?
    │   YES → <Dial> receptionist phone
    │   │      timeout=20s
    │   │      action=/api/voice/fallback
    │   │
    │   NO → <Dial> owner's phone directly
    │
    ▼
POST /api/voice/fallback (if no answer)
    │
    ├── fallback_type = "owner"
    │   → <Dial> owner's cell phone
    │
    ├── fallback_type = "ai"
    │   → <Say> AI greeting
    │   → <Gather> caller's response
    │   → POST /api/voice/ai-assistant (loop)
    │
    └── fallback_type = "voicemail"
        → <Say> "Leave a message"
        → <Record> maxLength=120
        → POST /api/voice/recording-status

POST /api/voice/status (always, when call ends)
    → Update call_logs with duration + final status
```

## Priority Prompts for Cursor

Paste these into Cursor one at a time:

### Prompt 1: Database
> "Implement all functions in lib/db.ts using @neondatabase/serverless. The schema is in scripts/001-create-schema.sql and all type signatures are already defined. Use parameterized queries."

### Prompt 2: Auth
> "Add authentication to the app. Create a login/signup page, use bcrypt for password hashing, store sessions in HTTP-only cookies. Protect all /api/* routes. Add a password_hash column to the users table."

### Prompt 3: Wire Dashboard
> "Connect dashboard-page.tsx to real data. Replace the mock receptionists array and useState with SWR hooks that fetch from /api/routing and /api/calls. When the user selects a receptionist or changes fallback settings, call PUT /api/routing."

### Prompt 4: Wire All Screens
> "Connect activity-page.tsx, contacts-page.tsx, analytics-page.tsx, and settings-page.tsx to real API data. Replace all mock data with SWR hooks. Wire up form submissions to POST/PUT endpoints."

### Prompt 5: Telnyx Setup
> "I have a Telnyx account. Help me configure voice routing so my number points to my deployed app's /api/voice/telnyx/incoming endpoint. Then test a call end-to-end."

### Prompt 6: AI Assistant
> "Complete the AI receptionist in /api/voice/ai-assistant/route.ts. Use the Vercel AI SDK to generate conversational responses based on the ai_greeting from routing_config. The AI should be able to take messages, share business hours, and help direct callers."
