# Competitive Landscape: How Do Other VoIP Apps Host Numbers?

## Short answer

**Grasshopper, RingCentral, Dialpad** and similar apps generally do not use a single CPaaS as their main number host. They use a mix of:

- **Own or leased carrier infrastructure** (e.g. softswitches, SIP trunks, direct carrier deals).
- **Underlying PSTN carriers** such as **Bandwidth** (which owns a tier‑1 network and powers many UCaaS platforms), or other SIP/PSTN providers.
- **White‑label / wholesale** arrangements with carriers rather than a single public CPaaS.

So they usually sit on different systems than a single-provider stack - often carrier-backed platforms (e.g. Bandwidth) or their own telephony stack. CPaaS is a developer API layer; those products are UCaaS and often hide who their underlying carrier is.

## What this means for lyncr

- **Using Telnyx does not mean you lack total ability.**  
  Telnyx gives you full control over:
  - Buying and searching numbers  
  - Porting and carrier workflows via API  
  - Setting voice URLs and call routing  
  - Recordings, status callbacks, and AI/assistant integration  

  From a **capability** standpoint, you can offer the same core behaviors as those competitors (numbers, porting, routing, fallbacks, recordings).

- **Where they may differ:**
  - **Carrier choice:** They may use Bandwidth or direct carrier deals (cost, redundancy, SLAs).
  - **Scale and ops:** They have dedicated carrier relations, NOC, and support.
  - **Product breadth:** More lines, more devices, more UC features (video, team messaging, etc.).

- **To compete on “total and complete ability” you want:**
  1. **Product parity** – Everything we’ve built: buy number, port (including from other carriers with LOA + webhook), route calls, fallbacks, recordings, analytics. ✅  
  2. **Reliability** – carrier SLA + your own monitoring and status pages.  
  3. **Optional later:** Add **Bandwidth** (or another carrier) as a second source for numbers/voice so you are not single-vendor and can optimize cost/redundancy.

## Summary

- **Do they use a single CPaaS?** Typically no; they use other carrier infrastructure (e.g. Bandwidth) or their own systems.  
- **Different system?** Yes—different carrier/backend, not “Twilio as main host.”  
- **Can you have total and complete ability on Telnyx?** Yes - number hosting, porting, routing, and features are all under your control via APIs. Adding a second carrier later is the main way to match enterprise multi-provider setups.
