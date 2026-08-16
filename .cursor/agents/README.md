# Lyncr Product Readiness System

Owner-facing entry: **Lyncr Boss** only.

## Internal roles (report to Boss only)

| Role | Agent id |
|------|----------|
| Product Doctor | `product-doctor` |
| UX and Interaction Designer | `ux-designer` |
| Solo Service Owner Simulator | `solo-owner-simulator` |
| Customer Booking Simulator | `customer-booking-simulator` |
| Customer Journey | `customer-journey` |
| Flow Tester | `flow-tester` |
| Reliability Watcher | `reliability-watcher` |
| Data and Metrics Analyst | `data-metrics-analyst` |
| Product Copywriter | `product-copywriter` |
| Security and Trust Reviewer | `safety-checker` |
| Release Manager | `release-manager` |
| Builder (after Approve Phase 1) | `builder` |
| Checker | `checker` |

## Docs

- Rules: `.cursor/rules/lyncr-product-team.mdc`
- Skills: `.cursor/skills/lyncr-boss/SKILL.md`, `.cursor/skills/lyncr-product-readiness/SKILL.md`
- Commands: `/lyncr-boss`, `/lyncr-weekly-report`, `/lyncr-reliability-watch`

## Hard rules

- Inspect / recommend by default — **no** automatic product code, deploy, SMS, charges, Telnyx, or deletes.
- Product app changes require owner: `Approve Phase 1`.
- Deploy / live actions require a **separate** explicit OK after Boss’s final report + Release Manager input.
- `.cursor/` team setup may be committed so the system persists; skip app production deploy unless the owner asks.
