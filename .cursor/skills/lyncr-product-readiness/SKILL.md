---
name: lyncr-product-readiness
description: >-
  Lyncr Product Readiness System — continuous inspect/test/recommend workflow
  for Lyncr Boss. Use for weekly product reports, daily reliability watch,
  multi-agent debates, and release readiness. Never auto-builds or deploys.
---

# Lyncr Product Readiness System

Lyncr Boss loads this skill when running continuous readiness work.

## North star

Solo service businesses. IVR-first. Fast calls. ASAP + one-day From–To booking. SMS, pay links, invoices, receipts. Polish before big features. Mobile-first. Data separation. Webhook safety.

## Absolute bans (all agents)

Never automatically: write product code, merge, deploy, send SMS to real customers, create payments, change Telnyx, delete data, or alter the owner’s live shop. Builds only after owner `Approve Phase 1`. Deploy only after separate owner OK + Release Manager input.

## Live testers (required for “using the app”)

Load `.cursor/skills/lyncr-live-testers/SKILL.md`. Solo Owner, Customer Booking, Flow Tester, and Customer Journey **create or log into their own TEST usernames** on lyncr.app and click the real screens. They never use Key Squad as a test login. Demo/simulation numbers only. 555 phones or an owner-given spare cell only. Looking at Key Squad’s database is evidence, not the user test.

## Debate loop

1. Product Doctor → problem  
2. UX → 2–3 solutions  
3. Solo Owner → fastest/clearest  
4. Customer Booking (if public book)  
5. Reliability → ops risk  
6. Data → importance or “no data”  
7. Security → if sensitive  
8. Boss → **one** owner recommendation  

## Weekly report (owner-facing)

Boss delivers exactly:

```
LYNCR WEEKLY PRODUCT REPORT

PRODUCT-READINESS STATUS:
Improving / Stable / At risk

WHAT WORKED WELL:
- ...

WHAT MAY BE CONFUSING USERS:
- ...

WHAT BROKE OR ALMOST BROKE:
- ...

BIGGEST LEAK IN THE CALL-TO-PAID-JOB JOURNEY:
- ...

BEST DESIGN OR INTERACTION IMPROVEMENT:
- ...

BEST SMALL BUILD FOR NEXT WEEK:
- ...

WHAT WE SHOULD NOT BUILD YET:
- ...

DECISION I NEED TO MAKE:
- ...
```

Evidence-based only. If a section has nothing real, say “None found this week.”

## Daily Reliability Watch (owner-facing via Boss)

Short:

```
LYNCR DAILY RELIABILITY WATCH

STATUS: Quiet / Watch / At risk

CHECKED:
- ...

FINDINGS:
- ... (or None)

SAFEST NEXT STEP:
- ... (usually: none / keep watching / Phase 1 proposal / urgent owner OK needed)
```

## First three audits (when starting cold)

1. Call → paid → done (Solo Owner + Doctor + Flow)  
2. Public book ASAP / window (Customer Booking + Copy)  
3. Reliability pulse (Reliability + Security skim)

## Release gate

Before asking for deploy: Checker + Release Manager (and Security if sensitive). Verdict READY / READY WITH RISKS / NOT READY.
