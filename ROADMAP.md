# Roadmap: from prototype to shops that pay

Checked 12 Sep 2026. Competitor claims are their own.

## The honest starting point

Voice billing in Indian languages already exists, and one competitor gives it away.

| Product | What it offers | Price signal |
|---|---|---|
| Dukaan AI | Voice billing, khata, GST invoices in 24 Indian languages, offline. Says it is built for kirana, medical and other small shops. | Free, no subscription |
| VoiceKhata | Voice-first bookkeeping in 12 Indian languages | Not checked |
| Vyapar, myBillBook, Khatabook | Established billing and khata apps with regional-language screens | Free tiers plus paid plans |
| Marg ERP | Pharmacy and distribution software, batch and expiry heavy | ₹5,550–26,000 + yearly AMC |

A shop will not pay for "voice" alone. Three bets to test with real shops:

1. **Right product, not just right words.** Every spoken item is matched to the shop's own catalog, flagged
   when uncertain, and remembered after one correction. Test: dictate the same 20 bills into this and into
   Dukaan AI, count the fixes needed per bill.
2. **Restocking by voice.** Reading a supplier bill aloud is where paper registers go wrong.
   Test: time a 30-line stock receipt spoken versus typed.
3. **Chemist-grade records.** Batch and expiry at stock-in, near-expiry alerts, Schedule H register,
   reorder list for the distributor. Test: ask each pilot pharmacy which they would pay for.

## Phases

Durations assume one developer part-time. Each phase ends with a go or no-go check.

### Phase 0 — Prototype (done)
Voice bills and voice stock-in, review with confidence flags, inventory with local names, packs and loose
units, physical count, per-product history, CSV import. Measured on generated audio: 19 of 20 products
matched, 5–11 seconds a bill. First real phone recording matched 3 of 3 products.

### Phase 1 — Feedback pilot (weeks 1–6)
Goal: learn whether shops use it every day.
- Hosted beta with a fixed address, phone-number login, daily backups, a "Report a wrong item" button.
- Recruit 5 pharmacies and 5 kirana shops in Bhubaneswar and one smaller town.
- Sit with each shop for its first 20 bills; run a WhatsApp group for issues.
- Record 30 real counter clips; rerun the accuracy eval weekly; run the side-by-side against Dukaan AI.

**Go if:** 6 of 10 shops still billing after four weeks, under 1 in 10 lines needing a fix, and 3 shops
naming a price they would pay.

### Phase 2 — Make it sellable (weeks 6–14)
- Batch and expiry at stock-in, near-expiry alerts, Schedule H register export.
- GST invoice PDF on WhatsApp, 58 mm Bluetooth receipt printing.
- One-tap repeat of frequent items, which is faster and costs nothing per bill.
- Screens in English, Hindi and Odia as a setting.
- Privacy policy, consent, data deletion (India's DPDP rules are fully in force from 13 May 2027).
- Paid Gemini key so shop data is not used to improve Google's models.
- Subscriptions with UPI autopay.

**Go if:** 5 pilot shops agree to a paid plan starting on launch day.

### Phase 3 — Launch (weeks 14–20)
One web app reaches every screen a shop owns:
- **Website** — any phone or desktop browser.
- **Desktop** — installed from Chrome or Edge, no separate build.
- **Play Store** — the same web app packaged as a Trusted Web Activity with PWABuilder or Bubblewrap,
  plus a Digital Asset Links file proving domain ownership. A new personal developer account must run a
  closed test with 12 testers opted in for 14 consecutive days, so start that in week 12. Accounts
  registered to a business are exempt.
- **iPhone** — Add to Home Screen.

### Phase 4 — Grow beyond Odisha (months 5–12)
- Pharma distributors and stockists as resellers; their salespeople already visit every chemist weekly.
- District chemists' association meetings; member discount.
- One 30-second real-bill video per language on YouTube Shorts and Instagram.
- Referrals: one free month for both shops.
- Per new language: local aliases in the starter catalogs, 30 clips passing the eval, 3 pilot shops, then sales.
  Candidate order after Odia: Hindi, Bengali, Telugu, Tamil.

## Pricing, and why not ₹199 flat

Measured cost per bill: ₹0.05–0.25 speech-to-text, about ₹0.20–0.30 for matching on the paid tier.
A shop doing 50 voice bills a day runs 1,500 a month, so AI alone costs ₹375–825 for that shop.

| Plan (hypothesis) | Includes | Price |
|---|---|---|
| Free | Typed billing, inventory, 100 voice bills a month | ₹0 |
| Shop | 1,500 voice bills, voice stock-in, WhatsApp invoices | ₹399–499 / month |
| Pharmacy | Batch and expiry, Schedule H register, reorder lists, two devices | ₹799 / month |

Cap voice bills per plan and push one-tap repeat items, so voice is spent where it saves the most time.

## Next two weeks

1. Put the beta on free hosting with a fixed address (see `DEPLOY.md`).
2. Add phone-number login and daily backups before real shop data goes in.
3. Add the "Report a wrong item" button and a short feedback form after a shop's tenth bill.
4. Line up 10 pilot shops and 12 Android testers for the Play Store closed test.
5. Record 30 real counter clips and run both evals on them.
6. Run the side-by-side against Dukaan AI on the same 20 bills.
