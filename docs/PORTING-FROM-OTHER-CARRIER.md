# How Number Porting Works (Different Carrier)

## Current behavior in the app

When a customer chooses **Port Existing** and enters a carrier that is not your current provider (e.g. AT&T, Verizon, T-Mobile):

- We **save** the number and carrier in our database with status **"porting"**.
- We show **"Porting in progress"** in Settings.
- We do not submit the request until required account details and documents are provided.

The app records intent first, then submits the request once all required data is present.

**Update:** We now support full in-app porting when the user completes the account-details form and uploads a utility bill (see Settings → Port Existing and **docs/PORTING-IMPLEMENTATION-PLAN.md**).

---

## How real porting works (industry)

1. **Who requests the transfer**  
   The **gaining** carrier (the one who will own the number after the port) must request the number from the **losing** carrier (customer’s current provider).  
   For lyncr, the gaining carrier/provider is **Telnyx** (or configured provider). The provider requests the transfer from AT&T, Verizon, etc., on your behalf.

2. **What’s needed from the customer**  
   - **Letter of Authorization (LOA)** – customer authorizes the losing carrier to release the number to your provider.  
   - Often: **account number**, **PIN**, and sometimes **bill copy** from the losing carrier.

3. **Where the number lives once ported**  
   After the port completes, the number lives on your lyncr provider account. So:
   - Bought numbers -> provider account
   - Ported numbers (after completion) -> provider account
   All numbers lyncr routes should point voice webhooks to the app (e.g. `/api/voice/telnyx/incoming`).

---

## What we’d need to implement real porting

To actually port from another carrier through the app:

1. **Use provider Port In API** (or manual port process where required).
   - Create a port-in request with number + losing carrier.
   - Provider can generate/send LOA for signature.
   - Provider submits the request to the losing carrier and handles the back-and-forth.

2. **Collect from the customer**  
   - Phone number, current carrier (and possibly account number / PIN if required).  
   - Any extra docs the provider needs (e.g. proof of ownership).

3. **When the port completes**  
   - Provider can notify us via webhook (or we poll).  
   - We then:  
     - Update DB: set status to **active** and store provider SID.
     - Set voice URL to your app (e.g. `NEXT_PUBLIC_APP_URL + '/api/voice/telnyx/incoming'`), same as bought numbers.

If full automation is unavailable in a region, “Port from different carrier” can remain intent-first with manual follow-up and webhook activation.
