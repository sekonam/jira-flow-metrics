# SUBMISSION-CHECKLIST — the five Marketplace listings

> **What this document is.** A pre-submission audit, written 2026-09-23. It answers, per listing
> and per form field: _is the content written, where does it live, or does a human have to make
> it?_ Nothing here was submitted, no account was created, and no network call was made except to
> read Atlassian's public partner documentation.
>
> **What this document is not.** It is not new listing copy. The only prose written here that is
> meant to be pasted anywhere is in § 4, and every line of it replaces a specific sentence that is
> now false.

---

## 0. What Atlassian actually requires — and where this document is unsure

Read on 2026-09-23 from Atlassian's public partner docs. **Where a requirement could not be
confirmed, this document says so instead of asserting one.** A field invented here would cost the
human more than a field left out.

| Confirmed                                                                                                                                                                                                                                                                                           | Source                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A **privacy policy URL is required of all partners** — "a requirement for all partners, as set out in Atlassian's Marketplace Partner Agreement"                                                                                                                                                    | [Privacy and Security tab](https://developer.atlassian.com/platform/marketplace/security-privacy-tab/)                                                                                                                                 |
| **End User Terms** (customer agreement / ToS) are required to transact in cloud; Atlassian offers a customisable standard end-user agreement. A **DPA** is additionally needed if you are a GDPR data processor                                                                                     | [List and manage apps](https://developer.atlassian.com/platform/marketplace/listing-and-managing-apps/)                                                                                                                                |
| The **Privacy & Security tab** is cloud-only, ~25 questions, and is **not itself mandatory** — "It is not mandatory to answer the Privacy & Security questionnaire. However… we encourage partners to submit their answers for all cloud apps." It replaced the deprecated Security Self-Assessment | [Privacy and Security tab](https://developer.atlassian.com/platform/marketplace/security-privacy-tab/)                                                                                                                                 |
| A paid Forge app **must set `app.licensing.enabled: true` in `manifest.yml`** and then deploy to production. Enabling it "creates a new version that requires approval of the Marketplace listing"                                                                                                  | [Distribute your apps](https://developer.atlassian.com/platform/forge/distribute-your-apps/), [List a Forge app](https://developer.atlassian.com/platform/marketplace/listing-forge-apps/)                                             |
| Once deployed to production with licensing on, **you cannot install from production until the listing is approved**                                                                                                                                                                                 | [List a Forge app](https://developer.atlassian.com/platform/marketplace/listing-forge-apps/)                                                                                                                                           |
| A **$0 price point for the 1–10 cloud user tier** exists and is the mechanism for "free under 10 users"                                                                                                                                                                                             | [Introducing a new $0 price point for your 1-10 cloud app user tier](https://community.developer.atlassian.com/t/introducing-a-new-0-price-point-for-your-1-10-cloud-app-user-tier/54225)                                              |
| Submission asks for **each API scope and why it is necessary**, and **any remote hostnames the app calls, what is sent and why**                                                                                                                                                                    | [List a Forge app](https://developer.atlassian.com/platform/marketplace/listing-forge-apps/)                                                                                                                                           |
| New listings are reviewed by Atlassian; **new versions of an approved listing are not** re-reviewed. Target decision time "within one week"                                                                                                                                                         | [List and manage apps](https://developer.atlassian.com/platform/marketplace/listing-and-managing-apps/), [List a Forge app](https://developer.atlassian.com/platform/marketplace/listing-forge-apps/)                                  |
| The listing data model carries `summary`, `tagLine`, `highlights` (structured: title, caption, summary, screenshot, thumbnail), `screenshots` (caption + imageId), `heroImage`, `youtubeId`, `developerLinks`, `moreDetails`                                                                        | [App listing REST v4](https://developer.atlassian.com/platform/marketplace/rest/v4/api-group-app-listing/), [App version listing REST v4](https://developer.atlassian.com/platform/marketplace/rest/v4/api-group-app-version-listing/) |

**Not confirmed — do not treat as requirements until read off the live form:**

- **Character limits** for name, tagline, summary and description. Atlassian's public pages do not
  publish them. `PROMOTION.md:236-238` already says this: _"Read the vendor console's own current
  asset specifications — image dimensions, character limits and required fields move, and a
  remembered number is worth nothing against the form in front of you."_
- **Image dimensions** for logo, hero/banner, screenshots and highlight thumbnails. Same reason.
- **The exact category list** for Jira Cloud. Candidates are proposed in § 1 and are flagged as
  unverified.
- **Whether a documentation URL is a hard required field** or a strongly-expected optional one.
  `PROMOTION.md:229` treats it as required (_"Documentation URL — live before submission;
  reviewers open it"_); Atlassian's docs describe it as one of the "developer links" without
  marking it mandatory. Plan for required.
- **Whether a "security statement" is a distinct free-text field** or is entirely subsumed by the
  Privacy & Security tab questionnaire. Both `PROMOTION.md:230-231` and every `LISTING-COPY-*`
  file assume a free-text field exists. Bring the text; paste it wherever the form takes it.

---

## 1. Field-by-field readiness, per listing

### 1.0 Facts shared by all five

| Field                             | State                                                                                                                                                                                                                                                                                    | Where it lives                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Supported hosting**             | ✅ Automatic — Forge is Cloud-only. Nothing to choose.                                                                                                                                                                                                                                   | all five `manifest.yml`                                                            |
| **Scopes + justification**        | ✅ Written. `read:jira-work`, `read:jira-user`, `storage:app`, each with a one-line reason                                                                                                                                                                                               | e.g. `apps/time-in-status/manifest.yml:165-173`                                    |
| **Remote hostnames**              | ✅ None. "Atlassian reports the build eligible for Runs on Atlassian — the app makes no external egress" — `apps/time-in-status/manifest.yml:8-11`. Answer the submission question "none".                                                                                               | manifests                                                                          |
| **Privacy statement text**        | ✅ Written, five per-listing variants, each ~5 bullets incl. the stated residual                                                                                                                                                                                                         | `docs/LISTING-COPY.md:99-120` and the equivalent section in each of the other four |
| **Security statement text**       | ✅ Same block as above. Source of record for the residual is `TECHNICAL-SPEC.md` § 11 item 6                                                                                                                                                                                             | as above                                                                           |
| **Privacy policy URL**            | ⚠️ **Content drafted, URL still missing.** The page text now exists at `docs/public-site/privacy-policy.md` (placeholders `[VENDOR NAME]`, `[CONTACT EMAIL]`, `[EFFECTIVE DATE]` unfilled); it must be hosted — see § 6 — before there is a URL to paste                                 | `docs/public-site/privacy-policy.md`                                               |
| **EULA / End User Terms**         | ❌ **Not decided.** No terms document, and no recorded decision to use Atlassian's standard end-user agreement                                                                                                                                                                           | —                                                                                  |
| **Documentation URL**             | ❌ **Does not exist.** The source repo is private (`package.json:7` — `"license": "UNLICENSED"`); only `github.com/sekonam/jira-flow-metrics-assets` is public, and it holds five PNG icons                                                                                              | —                                                                                  |
| **Support contact / URL**         | ⚠️ **Page drafted, contact still missing.** `docs/public-site/support.md` exists with a two-business-day first-reply commitment for the human to confirm; `[SUPPORT EMAIL]`, `[SUPPORT URL]`, `[TIMEZONE]`, `[DOCS URL]` unfilled, and the page is not hosted — see § 6                  | `docs/public-site/support.md`                                                      |
| **Vendor profile (name, logo)**   | ⚠️ Partial. Developer Space "AskMe Solutions" exists (`START-HERE.md:77`); the Marketplace **vendor account does not** (`START-HERE.md:79`, `ROADMAP.md:196`). No vendor logo in the repo                                                                                                | `assets/thumbnails/` holds app icons only                                          |
| **Highlights**                    | ❌ **No copy written for any listing.** The field is structured (title + caption + image). `PROMOTION.md:225` lists it — "the console's short bullets; nouns, not adjectives" — and nothing was drafted                                                                                  | —                                                                                  |
| **YouTube / demo video**          | ❌ None, and optional. Ship without it                                                                                                                                                                                                                                                   | —                                                                                  |
| **`app.licensing.enabled: true`** | ❌ **Absent from all five manifests.** Grep for `licensing` across `apps/` and `packages/` returns nothing. Required for a paid listing                                                                                                                                                  | all five `manifest.yml`                                                            |
| **Version notes / release notes** | ❌ Not written. `PROMOTION.md:233`: "what v1.0 is; the changelog page starts here". Note the repo says v1.1 shipped (`ROADMAP.md` stage 5) while `package.json` versions read `0.1.0` and the deployed time-in-status manifest header says `2.0.0` — pick one story before writing notes | `apps/*/package.json`                                                              |

---

### 1.1 Listing ① Time in Status & Cycle Time

**App id: `ari:cloud:ecosystem::app/05b589b7-c96b-40eb-8ded-0cc100ef851b`** —
`apps/time-in-status/manifest.yml:163`. The only app deployed (to `development`, v2.0.0).

| Field                                   | Ready?                                                                                                                                   | Where                                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| App name                                | ✅ `Time in Status & Cycle Time Reports for Jira`                                                                                        | `docs/LISTING-COPY.md:12-14`                                                          |
| Tagline                                 | ✅ `Cumulative time in every status — including re-entries Jira's control chart doesn't count.`                                          | `docs/LISTING-COPY.md:21-23`                                                          |
| Description                             | ⚠️ Written, **one false bullet** — see § 4.1                                                                                             | `docs/LISTING-COPY.md:35-96`                                                          |
| Highlights                              | ❌ Not written                                                                                                                           | —                                                                                     |
| Categories                              | 🧑 Not chosen. Unverified candidates: _Reports_, _Time tracking_, _Project management_                                                   | —                                                                                     |
| Screenshots                             | ⚠️ 6 PNGs exist in `docs/listing-assets/` but are **self-declared stale**: "⚠️ **Stale as of 2026-09-22 — re-shoot before submitting.**" | `docs/LISTING-COPY.md:126-146`                                                        |
| Screenshot captions                     | ✅ All six written                                                                                                                       | `docs/LISTING-COPY.md:139-146`                                                        |
| Alt text                                | ⚠️ A rule and one worked example, not six strings                                                                                        | `docs/LISTING-COPY.md:148-150`                                                        |
| Privacy/security statement              | ✅                                                                                                                                       | `docs/LISTING-COPY.md:99-120`                                                         |
| Pricing                                 | ✅ Ladder decided: $0 ≤10 · $6.50/user to 100 · $3.25 to 500 · $1.60 beyond                                                              | `packages/engine/src/config/pricing.ts:87-103`; table at `docs/LISTING-COPY.md:93-95` |
| Privacy URL / EULA / docs URL / support | ❌ See § 1.0                                                                                                                             | —                                                                                     |

---

### 1.2 Listing ② Worklog Reports & Time Tracking

**App id: `ari:cloud:ecosystem::app/1bdd9c5e-f1fb-47ca-b847-448dbd8eb021`** —
`apps/worklog-reports/manifest.yml:117`. Lint-clean, **not deployed** (`manifest.yml:7-8`).

| Field                                      | Ready?                                                                                                                                                                                                                                          | Where                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| App name                                   | ✅ `Worklog Reports & Time Tracking for Jira`                                                                                                                                                                                                   | `docs/LISTING-COPY-worklog-reports.md:65-67` |
| Tagline                                    | ✅ `Logged time totalled per person — exactly the durations people typed into Jira, never re-derived.`                                                                                                                                          | `:77-79`                                     |
| Description                                | ✅ Accurate against the shipped UI — the only one of the five that is                                                                                                                                                                           | `:93-151`                                    |
| Highlights                                 | ❌                                                                                                                                                                                                                                              | —                                            |
| Categories                                 | 🧑 Unverified candidates: _Time tracking_, _Reports_                                                                                                                                                                                            | —                                            |
| Screenshots                                | ❌ **0 of 5–6 captured.** `docs/listing-assets-worklog-reports/raw/` holds two `.jpg` working files (`full-page.jpg`, `csv-modal.jpg`), not shippable crops                                                                                     | `:214-233`                                   |
| Screenshot captions + capture instructions | ✅ Unusually detailed, incl. the prerequisite that ≥3 accounts must have worklogs                                                                                                                                                               | `:226-233`                                   |
| Privacy/security statement                 | ✅                                                                                                                                                                                                                                              | `:155-180`                                   |
| Pricing                                    | ✅ $0 ≤10 · $5.00 · $2.50 · $1.25 → **$250 @50**                                                                                                                                                                                                | `pricing.ts:106-125`; table `:144-146`       |
| Pricing warning                            | ✅ "Do not write 'the most affordable option'" — carry this into the form                                                                                                                                                                       | `:148-151`                                   |
| Stale internal note                        | ⚠️ `:205-206` asks someone to reword the gadget description and page subtitle; **both are already fixed** (`apps/worklog-reports/manifest.yml:50`, `apps/worklog-reports/src/frontend/index.tsx:155`). Delete the note so it is not re-actioned | `:198-206`                                   |

---

### 1.3 Listing ③ WIP Aging & Run Charts

**App id: `ari:cloud:ecosystem::app/0e259744-1e08-4511-b59d-8fe07cc63621`** —
`apps/wip-aging/manifest.yml:117`. Lint-clean, not deployed to production.

| Field                           | Ready?                                                                                                            | Where                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| App name                        | ✅ `WIP Aging Reports & Charts for Jira` — deliberately **not** "Run Charts", because no run chart renders        | `docs/LISTING-COPY-wip-aging.md:63-72` |
| Tagline                         | ✅ `The age of every unfinished issue, oldest first — where Jira's own Average Age chart shows one number.`       | `:76-78`                               |
| Description                     | ❌ **Self-contradictory.** Claims a cumulative flow diagram at `:107-112` and denies one at `:136-137`. See § 4.2 | `:90-159`                              |
| Highlights                      | ❌                                                                                                                | —                                      |
| Categories                      | 🧑 Unverified candidates: _Reports_, _Charts & diagramming_, _Project management_                                 | —                                      |
| Screenshots                     | ❌ **0 of 6.** `docs/listing-assets-wip-aging/raw/` holds two `.jpg` working files                                | `:188-204`                             |
| Captions + capture instructions | ✅ All six                                                                                                        | `:197-204`                             |
| Privacy/security statement      | ✅                                                                                                                | `:163-184`                             |
| Pricing                         | ✅ $0 ≤10 · $5.50 · $2.75 · $1.40 → **$275 @50**                                                                  | `pricing.ts:128-144`; table `:153-155` |

---

### 1.4 Listing ④ SLA & Due Date Breach Reports

**App id: `ari:cloud:ecosystem::app/b149665a-b013-4688-b2e7-bf1304de2955`** —
`apps/sla-breach/manifest.yml:117`. Lint-clean, not deployed to production.

| Field                           | Ready?                                                                                                                                                                                                                  | Where                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| App name                        | ✅ `SLA & Due Date Breach Reports for Jira`                                                                                                                                                                             | `docs/LISTING-COPY-sla-breach.md:68-70` |
| Tagline                         | ✅ `SLA as working time in the statuses you count, measured against a target — plus plain due-date breaches.`                                                                                                           | `:78-80`                                |
| Model section                   | ✅ The best-written section in any of the five; keep it verbatim                                                                                                                                                        | `:102-111`                              |
| Description                     | ❌ **Self-contradictory.** Promises saved goals at `:118-122`, denies them at `:148-149`, and the document header at `:5-6` denies them too. See § 4.3                                                                  | `:94-172`                               |
| Highlights                      | ❌                                                                                                                                                                                                                      | —                                       |
| Categories                      | 🧑 Unverified candidates: _Reports_, _IT & helpdesk_, _Project management_                                                                                                                                              | —                                       |
| Screenshots                     | ❌ **0 of 6.** `docs/listing-assets-sla-breach/raw/` is empty                                                                                                                                                           | `:202-219`                              |
| Captions + capture instructions | ✅ All six, incl. a seeding prerequisite for due dates                                                                                                                                                                  | `:212-219`                              |
| Privacy/security statement      | ✅                                                                                                                                                                                                                      | `:176-198`                              |
| Pricing                         | ✅ $0 ≤10 · $7.00 · $3.50 · $1.75 → **$350 @50**                                                                                                                                                                        | `pricing.ts:147-163`; table `:166-168`  |
| Naming inconsistency            | ⚠️ The app calls itself `SLA & Due Dates` on the project page and `SLA and Due Dates — storage` on the admin page, while the listing is `SLA & Due Date Breach Reports`. Three names. Not a blocker; a reviewer may ask | `manifest.yml:18`, `manifest.yml:28`    |

---

### 1.5 Listing ⑤ Issue History & Audit Log

**App id: `ari:cloud:ecosystem::app/b7a70548-f901-43a4-be30-55e632b70468`** —
`apps/issue-history/manifest.yml:118`. Lint-clean, not deployed to production.

| Field                           | Ready?                                                                                                                                                                                                                        | Where                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| App name                        | ✅ `Issue History & Audit Log Reports for Jira`                                                                                                                                                                               | `docs/LISTING-COPY-issue-history.md:67-69` |
| Tagline                         | ✅ `Every field change across the whole project in one table — not one issue's History tab at a time.`                                                                                                                        | `:77-79`                                   |
| Description                     | ✅ Accurate — it correctly claims **no** filters                                                                                                                                                                              | `:92-145`                                  |
| Highlights                      | ❌                                                                                                                                                                                                                            | —                                          |
| Categories                      | 🧑 Unverified candidates: _Reports_, _Admin tools_, _Project management_                                                                                                                                                      | —                                          |
| Screenshots                     | ❌ **0 of 6.** `docs/listing-assets-issue-history/raw/` is empty                                                                                                                                                              | `:178-194`                                 |
| Captions + capture instructions | ✅ All six                                                                                                                                                                                                                    | `:187-194`                                 |
| Privacy/security statement      | ✅ Includes the strongest per-listing sentence in the set, about old values surviving in history                                                                                                                              | `:149-174`                                 |
| Pricing                         | ✅ $0 ≤10 · $7.50 · $3.75 · $1.90 → **$375 @50**                                                                                                                                                                              | `pricing.ts:166-182`; table `:138-140`     |
| Pricing caveat                  | ✅ Do not write "half the leader's price" without re-measuring SaaSJet                                                                                                                                                        | `:142-145`                                 |
| **Manifest over-claim**         | ❌ The gadget description reads `Filterable, exportable field-change history across every issue in a project.` — the shipped UI has **no filter controls** (`:211-216`) and the gadget renders two tiles, no table. See § 4.4 | `apps/issue-history/manifest.yml:50-51`    |

---

## 2. Gaps, ranked

### 2A — Blocks submission entirely

1. **No Marketplace vendor account.** `START-HERE.md:79` and `ROADMAP.md:196` both still have it
   unticked. Nothing else in this document can happen first. 🧑
2. **No privacy policy URL.** Confirmed mandatory for all partners. The page itself is now
   drafted (`docs/public-site/privacy-policy.md`); what remains is a host — § 6 gives the two
   cheapest routes — and the human filling the placeholders. 🧑
3. **No End User Terms / EULA.** Required to transact in cloud. Cheapest path is Atlassian's
   customisable standard end-user agreement — a decision, not a drafting job. 🧑
4. **`app.licensing.enabled: true` is missing from all five manifests.** These are paid listings
   above 10 seats; without it the app cannot be sold. This is a manifest change, so it is out of
   scope for this document, and it forces a fresh `forge deploy -e production`.
5. **No production deploy of any app.** Only `time-in-status` has been deployed at all, and only
   to `development` (`apps/time-in-status/manifest.yml:7-8`). The other four say "NOT DEPLOYED".
6. **Zero shippable screenshots for listings ②–⑤.** Listing ①'s are no longer the blocker:
   six cropped, captioned candidates from real Jira at HEAD landed 2026-09-23 in
   `docs/listing-assets/candidates-2026-09-23/` (with `CAPTIONS.md`), shot _by automation_ — the
   "Forge iframes cannot be screenshotted" premise this item rested on was a limit of the old
   toolchain, not of Forge (`docs/SHOT-LIST.md`, status update). Listings ②–⑤ remain unshot;
   same technique applies once a browser session is available. The human's remaining share is
   approval of the candidates, not capture. 🧑⚠️
7. **Tax and bank details** — required before payout, and the vendor account flow asks for them.
   🧑 (`ROADMAP.md:196`)

### 2B — Blocks a _good_ submission; fix before pasting, not after

8. **Three listings describe a product that no longer exists.** ③ and ④ contradict themselves
   inside a single description; ① claims filters it does not have. A reviewer who opens the app
   and reads the copy sees the mismatch. Full text in § 4.
9. **No support contact and no stated response time.** `PROMOTION.md:228` calls for a response
   time "you can actually keep". An unanswerable support address is worse than a slow one. The
   support page is now drafted (`docs/public-site/support.md`) with a two-business-day first-reply
   commitment; the human must confirm that number, create the address, and host the page (§ 6). 🧑
10. **No documentation URL.** `PROMOTION.md:229`: "live before submission; reviewers open it".
11. **No Highlights copy for any listing** — a visible, empty section on the listing page.
12. **The issue-history gadget description over-claims "Filterable"** in a shipped manifest string
    a customer reads in the gadget picker. § 4.4.

### 2C — Can ship and improve later

13. **No demo video.** Optional; ship without one.
14. **Alt text is a rule plus one example, not per-image strings.** Write them at paste time.
15. **The Privacy & Security tab questionnaire** (~25 questions) is explicitly not mandatory. The
    answers are all already known from `PRODUCT-SPEC.md` § 9 — it is an hour, and worth it.
16. **Version/release notes.** Needed, cheap, and cannot be written until § 1.0's version-number
    story is settled.
17. **Per-listing pre-submission market re-checks** were run 2026-09-21 and each carries a "re-run
    on the actual submission day" caveat (e.g. `LISTING-COPY-issue-history.md:44-46`,
    `LISTING-COPY-wip-aging.md:55-57`).
18. **`docs/listing-assets/` naming.** The four newer listings plan prefixes (`worklog-`, `wip-`,
    `ih-`) into the _same_ folder as listing ①'s, while empty per-listing folders already exist.
    Pick one convention before 20+ files land.

---

## 3. The pricing table — and whether the sources agree

Three sources state prices: `packages/engine/src/config/pricing.ts` (the code of record),
`docs/PRODUCT-SPEC.md`, and each `LISTING-COPY-*`. **All three agree on every figure.**

| Listing           | ≤10 | 50       | 100  | 500    | Per-user ladder    | `pricing.ts` | PRODUCT-SPEC    | LISTING-COPY                  |
| ----------------- | --- | -------- | ---- | ------ | ------------------ | ------------ | --------------- | ----------------------------- |
| ① Time in Status  | $0  | **$325** | $650 | $1,950 | 6.50 / 3.25 / 1.60 | `:87-103`    | § 4, `:127-129` | `LISTING-COPY.md:93-95`       |
| ② Worklog Reports | $0  | **$250** | $500 | $1,500 | 5.00 / 2.50 / 1.25 | `:106-125`   | § 5, `:163`     | `…worklog-reports.md:144-146` |
| ③ WIP Aging       | $0  | **$275** | $550 | $1,650 | 5.50 / 2.75 / 1.40 | `:128-144`   | § 6, `:203`     | `…wip-aging.md:153-155`       |
| ④ SLA Breach      | $0  | **$350** | $700 | $2,100 | 7.00 / 3.50 / 1.75 | `:147-163`   | § 7, `:251`     | `…sla-breach.md:166-168`      |
| ⑤ Issue History   | $0  | **$375** | $750 | $2,250 | 7.50 / 3.75 / 1.90 | `:166-182`   | § 8, `:277`     | `…issue-history.md:138-140`   |

Checked by hand against `monthlyPrice()` (`pricing.ts:59-73`), which charges the full ladder from
seat 1 once the free threshold is passed — so 50 seats × $6.50 = $325, and 500 seats =
100×6.50 + 400×3.25 = $1,950. The published tables match.

**Three flags, none of them a disagreement between our own sources:**

1. **The votazz figure disagrees with itself across three files, on both the number and the
   unit.** `PRODUCT-SPEC.md:131-132` and `pricing.ts:99-100` both say **$150** at 50 users (the
   time-in-status niche); `pricing.ts:121-122` says **$175** (the worklog niche); and
   `ROADMAP.md:128-130`, the 2026-09-22 re-sweep, says **"votazz at $175/yr at 50 seats, $350 at
   100, across its whole portfolio"** — _per year_, and across the whole portfolio rather than per
   niche, which contradicts both of the other two. Every other price in this repository is monthly.
   This is the number the "it is not the cheapest" warnings rest on, so re-measure it from the
   Marketplace pricing API before it goes anywhere near a form. **Our own five ladders are
   unaffected** — nothing in `pricing.ts`'s tier arithmetic reads a competitor figure.
2. **`LISTING-COPY-worklog-reports.md:151` repeats "votazz sells at $175"** and inherits the same
   ambiguity. The warning it actually supports — "HeroCoders Clockwork Lite (7,030 installs) and
   SolDevelo Worklogs (5,390) both sell at **$200**/50 users — below this price" — is independently
   sourced (`PRODUCT-SPEC.md:165-167`, `pricing.ts:118-120`) and stands regardless.
3. **SaaSJet's $750 could not be re-read on 2026-09-21** (`…issue-history.md:41-46`). Listing ⑤'s
   own prices are unaffected; only the "half the leader's price" line depends on it, and the copy
   already forbids using it unverified.

**Pricing model to select in the form:** Paid via Atlassian, cloud, per-user tiered, with the 1–10
tier set to **$0**. That $0 tier is a real, available price point (§ 0), and it is not optional in
this plan — `pricing.ts:6-10` calls the free tier "not a marketing choice; it is how evaluation
happens in this niche."

---

## 4. Listing copy that is now factually wrong about the product

**Closed 2026-09-24. All four are fixed; the diagnoses below are kept as the record of what was
wrong and how it was decided.** Two were fixed by editing the copy, one by shipping the feature the
copy already promised, and one by editing a manifest string. Each subsection now opens with what
actually happened.

The product gained six things on 2026-09-22 (`ROADMAP.md` stage 5): charts on every report page, a
cumulative flow diagram, stored SLA goals with an editor, the `jira:issueActivity` timeline tab,
"extend history", and an admin storage page. Four of the five copy files were partly updated for
this. **Three separate errors survived, and two of them are outright self-contradictions inside a
single description.** Each is quoted below with a replacement.

Verified against the shipped frontends under `apps/*/src/frontend/` and the shared components in
`packages/ui/src/components.tsx`.

---

### 4.1 ① Time in Status — claims three filters that do not exist ❗ → **resolved by building them**

> **Outcome (2026-09-24): the copy was left alone and the product caught up.** `ReportFilters`
> (`packages/ui/src/components.tsx`) ships an **Assignee** select, an **Issue type** select and a
> bounded **Created from** / **Created to** pair with a _Clear filters_ button, rendered at
> `apps/time-in-status/src/frontend/index.tsx:205`; `filtersToRequest` puts them on both the
> `getReport` payload (`:117`) and the `exportCsv` payload (`:115-117`), so the sentence "both the
> table and the export narrow to exactly that" is now literally true, not nearly true. **Do not
> apply the deletion prescribed below** — it would remove a claim the app can now back. The
> analysis is kept because the reasoning ("a filter naming a value the table is not filtered by is
> the same lie one listing over") is the reason the controls are controlled.

`docs/LISTING-COPY.md:64` currently reads:

> - **Filters** — assignee, issue type, creation window.

**This is false.** `apps/time-in-status/src/frontend/index.tsx:73` calls
`invoke('getReport', { basis: nextBasis })` — basis is the entire payload. The only controls on the
page are the `Elapsed` / `Working hours` toggle (`index.tsx:143-157`), `Export CSV` and
`Extend history` (`index.tsx:158-159`). There is no assignee picker, no issue-type picker and no
date window anywhere in the UI.

The claim comes from `PRODUCT-SPEC.md:106`, which lists filters as in-scope for v1. The engine and
resolver support them; no screen exposes them. This is exactly the failure mode
`LISTING-COPY-issue-history.md:211-216` already caught on listing ⑤ and handled correctly — listing
① never got the same pass.

**Replace line 64 with:**

> - **Elapsed or working-hours basis, switchable on the page** — one toggle, and every figure,
>   tile and chart recomputes against it.

(The "Elapsed or working-hours basis, switchable per view" bullet already at `:49` then duplicates
this. Delete `:49` and keep the replacement at `:64`, or delete `:64` entirely — either removes the
false claim. Deleting `:64` outright is the smaller edit.)

**Second, smaller fix in the same file.** `docs/LISTING-COPY.md:158` reads:

> - [ ] Screenshot captions — add 1-2 more keyword terms once final captions are set

The captions _are_ set (`:139-146`) and the checklist above it is ticked. Leave the box unticked
but note that the six screenshots are stale — the real blocker is § 2A item 6, not the captions.

---

### 4.2 ③ WIP Aging — promises a cumulative flow diagram and denies one, 25 lines apart ❗❗ → **fixed**

> **Outcome: applied.** The denial at "What it does not do" now reads "No run charts" and carries a
> parenthesis saying the CFD _is_ rendered and that the contradiction was the point. The title
> rationale no longer calls the CFD a v1.1 item in the present tense, and `cumulative flow` has
> been added to the keyword list, where its absence was the last trace of the stale denial.

`docs/LISTING-COPY-wip-aging.md:107-112` claims:

> - **A cumulative flow diagram** — one line per status, one point per day, thirty days back.
>   Built from every recorded _visit_, so it says where each issue actually was on a past Tuesday
>   rather than inferring it from today's state. […]

`docs/LISTING-COPY-wip-aging.md:136-137`, in the same description, denies it:

> No run charts or cumulative flow diagrams yet — the arithmetic exists in the engine and is
> tested, but no screen renders it, so it is not claimed here.

**The bullet is right and the denial is stale.** `apps/wip-aging/src/frontend/index.tsx:251-255`
renders a `ReportLineChart` (`@forge/react` `LineChart`, `colorAccessor="series"`) titled
**`Cumulative flow`**, subtitled `Issues in each status at the end of each day, last 30 days
(UTC).`, fed by a dedicated `getFlowReport` resolver call with `{ days: 30 }` (`index.tsx:99`) and
withheld rather than drawn flat when unavailable (`index.tsx:230`). The **run chart** half of the
denial is still true: `computeRunChart` exists in the engine and nothing renders it.

**Replace the sentence at `:136-137` with:**

> No run charts — the arithmetic exists in the engine and is tested, but no screen renders one, so
> it is not claimed here.

Two consequential edits follow from the same fact:

- `:69-72` justifies the app name by saying the CFD is unbuilt:

  > `computeRunChart` exists in the engine and is unit-tested, but **no page or resolver renders
  > it** — a run chart is a v1.1 item (`ROADMAP.md` stage 5 lists the CFD there too) […]

  **Replace with:**

  > `computeRunChart` exists in the engine and is unit-tested, but **no page or resolver renders
  > it** — the cumulative flow diagram shipped in v1.1 and the run chart did not […]

  The title decision itself ("WIP Aging Reports & Charts", not "& Run Charts") is still correct and
  should not change.

- `:219` reads `[ ] `run chart` deliberately **not** targeted until a run chart actually renders
(v1.1)`. Still true. Leave it, and consider adding `cumulative flow` to the keyword list at
  `:212-213`, where it is currently absent despite being a shipped, searched-for feature.

---

### 4.3 ④ SLA Breach — promises saved goals and denies them, and the document header denies them too ❗❗ → **fixed**

> **Outcome: applied.** The header note now says stored, named goals shipped in v1.1 and are
> claimed; the false first sentence of "What it does not do" is gone, and the paragraph begins at
> the notifications/escalation/calendars sentence, which was always true.

`docs/LISTING-COPY-sla-breach.md:118-122` claims:

> - **Save a goal and name it**, so everyone on the project opens the same report measured the same
>   way rather than each rebuilding it from chips. Up to twenty per project. […]

`docs/LISTING-COPY-sla-breach.md:148-149`, in the same description, denies it:

> No stored SLA goals and no goal editor — the goal is evaluated per view, not saved as
> configuration.

And the document's own header, `:5-6`, denies it a third time:

> In particular: **stored SLA goals and a goal editor are v1.1 and are not promised anywhere
> below**

**The bullet is right; the denial and the header note are both stale.** `SlaGoalForm`
(`packages/ui/src/components.tsx:229-402`) ships a saved-goal `Select` (label `Saved goal`), a
`Working-time target` select with the exact 4/8/16/24/40/80-working-hour presets the copy names,
status toggle chips, a `Goal name` text field and a `Save goal` button, plus a `Delete "{name}"`
action. It is rendered on `apps/sla-breach/src/frontend/index.tsx:260-269` in every state but
`error`. Goals persist: `listSlaGoals` on mount (`index.tsx:133`), `saveSlaGoal`
(`index.tsx:162-170`), `deleteSlaGoal` (`index.tsx:182`). The twenty-per-project cap is real —
`MAX_SLA_GOALS = 20` at `packages/forge-runtime/src/settings.ts:55`, enforced at
`packages/forge-runtime/src/runtime.ts:443`. The "resolved by name on the server" claim is real
too: `toGoalPayload` (`index.tsx:87`) sends the id alone.

**Delete the first sentence of that paragraph** — "No stored SLA goals and no goal editor — the
goal is evaluated per view, not saved as configuration." (`:148` through "configuration." on
`:149`) — and let the paragraph begin at the sentence that already follows it: "No notifications,
no escalation rules, no calendars per goal." That sentence is still true and needs no edit; the
deleted one is the only false clause in the paragraph.

**Then add one bullet to "What it does not do"**, so the section still says what the goal editor
deliberately omits rather than going silent on it:

> A saved goal names the counted statuses and the target and nothing else — no per-goal calendar,
> no per-goal notification, and no goal that varies by issue type or priority.

**Replace the header note at `:5-6` with:**

> In particular: **stored, named SLA goals shipped in v1.1 and are claimed below**, with the
> twenty-per-project cap and the id-only server resolution stated rather than implied; and the CSV
> export is described as the copyable modal it actually is, never as a download.

---

### 4.4 ⑤ Issue History — a shipped manifest string says "Filterable" and nothing is ⚠️ → **fixed**

> **Outcome: applied 2026-09-24, and the scope call below was overruled.** This document deferred
> it as "a manifest change and therefore out of scope", which would have left a false sentence in
> front of every customer who opens Jira's gadget picker for the sake of a filing boundary.
> `apps/issue-history/manifest.yml` now carries the suggested text verbatim — word for word the
> page subtitle — with a comment saying what was there before and why it went. The stale note in
> `docs/LISTING-COPY-worklog-reports.md` asking a future editor to reword the worklog gadget
> description is deleted too; both strings it named were already correct.

`apps/issue-history/manifest.yml:50-51`:

> description: Filterable, exportable field-change history across every issue in a
> project.

This is the text a customer reads in Jira's gadget picker. The listing copy explicitly and
correctly does **not** claim filters (`docs/LISTING-COPY-issue-history.md:211-216`: _"No filter
controls exist in the shipped UI — still true… The shipped footnote and page subtitle that
over-claimed 'filterable' were reworded on 2026-09-21"_) — the manifest was missed in that pass.
`apps/issue-history/src/frontend/index.tsx` renders no filter control of any kind.

**This is a manifest change and therefore out of scope for this document.** It is recorded here so
it is not lost. Suggested replacement text, matching the page subtitle already shipped at
`index.tsx:155`:

> Every field change across the whole project in one exportable table.

Two related, smaller observations on the same listing, neither worth blocking on:

- Every gadget in the family renders **summary tiles only** — no chart, no table. Listing ⑤'s copy
  at `:108-109` says "the change count and busiest field on a dashboard", which is exactly right.
  Listing ③'s gadget bullet at `…wip-aging.md:129-130` says "with the summary tiles", also right.
  No fix needed; noted because it is the one place the copy got the gadget scope correct and it
  would be easy to over-describe when writing Highlights.
- `docs/LISTING-COPY-worklog-reports.md:205-206` asks a future editor to reword the worklog gadget
  description and page subtitle. Both were already fixed (`apps/worklog-reports/manifest.yml:50`,
  `apps/worklog-reports/src/frontend/index.tsx:155`). Delete the note so nobody re-opens it.

---

### 4.5 What the copy gets right, checked line by line

So the human can paste the rest with confidence, these claims were verified against the code and
are **accurate**:

| Claim                                                | Where claimed                                            | Verified against                                                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| ① median-time-per-status chart above the table       | `LISTING-COPY.md:56`                                     | `time-in-status/index.tsx:223-229`, title `Median time in status`                                                                  |
| ① per-issue timeline as a tab beside Jira's History  | `:57-59`                                                 | `time-in-status/panel.tsx`, headings `Every visit, in order` / `Totals per status`; `manifest.yml:34-70` uses `jira:issueActivity` |
| ① "Extend history", first index 12 months, widenable | `:60-61`                                                 | `components.tsx:739-808`, modal `Extend indexed history`                                                                           |
| ① admin storage page, rows and megabytes             | `:62-63`                                                 | `time-in-status/admin.tsx:81-88`, tiles `Estimated storage` / `Issues indexed`                                                     |
| ① median + 85th-percentile tiles per status          | `:54-55`                                                 | `packages/ui/src/view-model.ts:248-279`                                                                                            |
| ② chart of hours logged per person                   | `…worklog-reports.md:123`                                | `worklog-reports/index.tsx:211-215`, title `Time logged per person`                                                                |
| ② no grouping/date/author controls claimed           | `:198-206`                                               | correct — page sends `{}`                                                                                                          |
| ③ six age buckets, all six always rendered           | `…wip-aging.md:105-106`                                  | `components.tsx:539-548`, `AgingHistogram` titled `Age distribution`                                                               |
| ③ CSV columns listed exactly                         | `:126-128`                                               | `['Issue','Status','Age in status','Working hours','Age total','Entered status']`                                                  |
| ④ 4–80 working-hour target presets                   | `…sla-breach.md:115-117`                                 | `SLA_TARGET_OPTIONS`, six presets                                                                                                  |
| ④ banded attainment chart                            | `:123-124`                                               | `sla-breach/index.tsx:302-306`, title `How close to the target`, bands `Under 50%` / `50-80%` / `80-100%` / `Breached`             |
| ⑤ chart of changes per field                         | `…issue-history.md:115`                                  | `issue-history/index.tsx:211-215`, title `Changes by field`                                                                        |
| all five                                             | "CSV export… ready to select and copy", never a download | `components.tsx:864-903` — modal, no download                                                                                      |

---

## 5. Runbook

Numbered, ordered, start to finish. 🧑 marks a step only a human can do. Every other step has its
answer pre-filled from the files.

### Phase A — identity and legal (all 🧑, all blocking, ~1 week of mostly waiting)

1. 🧑 **Create the Marketplace vendor account** at `marketplace.atlassian.com/manage/vendors`.
   Free. Legal identity of the seller. Use the same Atlassian account as the "AskMe Solutions"
   Developer Space (`START-HERE.md:77`). Tick `START-HERE.md:79`.
2. 🧑 **Submit tax and bank details.** Paperwork, not a decision (`START-HERE.md:51`). Do it now;
   payouts release 30 days after a month accruing $500+ (`RUNBOOK.md:137-138`).
3. 🧑 **Host the pages** — a bought domain (~$12/yr, `START-HERE.md:52`) or GitHub Pages on the
   existing public assets repo; § 6 weighs the two. The pages are the three missing URLs in
   § 1.0, and they are the cheapest blocker on this list to clear:
   - `/privacy` — **required**. Content is drafted: `docs/public-site/privacy-policy.md`. Fill
     the placeholders, verify the claims against the HTML comments in the file, and publish.
   - `/terms` — **required**. Decide: Atlassian's customisable standard end-user agreement
     (fastest) or your own. Record the decision.
   - `/docs` — one page per listing is enough at v1. Source material already exists: each
     listing's "What you get" and "What it does not do" sections.
4. 🧑 **Decide the support contact and the response time you can keep.** `PROMOTION.md:228`. A
   `support@` address on the same domain and "two business days" is a commitment a solo developer
   can actually honour; "same day" is not. The support page is drafted at
   `docs/public-site/support.md` with exactly that commitment — confirm it, fill `[SUPPORT
EMAIL]`, `[SUPPORT URL]`, `[TIMEZONE]` and `[DOCS URL]`, and publish it alongside `/privacy`.

### Phase B — make the app sellable (blocking, needs a manifest change)

5. **Add `app.licensing.enabled: true`** under `app:` in all five `manifest.yml` files, beside the
   existing `id:`. Confirmed required for a paid Forge listing (§ 0). _Out of scope for this
   document — it is a manifest edit._ Note that enabling it "creates a new version that requires
   approval of the Marketplace listing".
6. `pnpm run verify` → green, then `pnpm exec forge lint` per app.
7. 🧑 `pnpm exec forge deploy -e production` for `apps/time-in-status` first
   (`RUNBOOK.md:139-142`). **Expect that you cannot install from production until the listing is
   approved** — that is normal for a licensed app, not a failure.

### Phase C — capture the media (🧑 only, the real time sink)

8. ⚠️ **Listing ①'s screenshots: candidates exist — review, don't re-shoot.** See
   `docs/listing-assets/candidates-2026-09-23/`; the stale-six note below is retained for
   what each frame must contain. They were stale as of the v1.1 charts
   (`docs/LISTING-COPY.md:126-132`, `ROADMAP.md:197`). The capture table at
   `docs/LISTING-COPY.md:139-146` tells you what each frame must contain. Add a seventh candidate:
   the `jira:issueActivity` timeline tab, which `:129-131` argues is a stronger #2 than the
   current History-tab comparison.
9. 🧑 **Shoot listings ②–⑤ from zero** — 6 + 6 + 6 + 6. Every capture instruction is already
   written; follow the "Capture instructions" column in each file's Screenshots table. Three
   prerequisites are stated there and each will otherwise waste a session:
   - ②: worklogs must exist from **≥3 accounts** or the Share column reads 100% on one row
     (`…worklog-reports.md:219-223`).
   - ④: seeded issues must carry **due dates** in all three states — past-due open, past-due
     resolved, on time (`…sla-breach.md:208-210`).
   - ③/⑤: use the bulk-seeded `JFMB` project (181+ issues), not `JFM`.
   - All: Jira must be in **English** — listing ①'s existing #2 shipped with a Russian tab label
     (`…issue-history.md:191`).
     Shoot from the deployed Forge app inside real Jira, **never** the `ui:screens` harness
     (`PROMOTION.md:240-245`).
10. 🧑 **Write per-image alt text.** The rule is at the bottom of each Screenshots section:
    describe what the shot _proves_, not what it contains. One worked example per listing is
    already written.
11. 🧑 **Settle the asset folder convention** before 30 files land — `docs/listing-assets-*/`
    already exist but the copy files plan prefixes into the shared `docs/listing-assets/`.

### Phase D — fix the copy (do this before opening the form)

12. Apply **§ 4.1** — delete the false Filters bullet at `docs/LISTING-COPY.md:64`.
13. Apply **§ 4.2** — three edits to `docs/LISTING-COPY-wip-aging.md` (`:136-137`, `:69-72`,
    keyword list at `:212-213`).
14. Apply **§ 4.3** — two edits to `docs/LISTING-COPY-sla-breach.md` (`:148-150`, `:5-6`).
15. Apply **§ 4.4** — the manifest string at `apps/issue-history/manifest.yml:50-51`. Manifest
    change; bundle it with step 5.
16. Delete the stale internal note at `docs/LISTING-COPY-worklog-reports.md:205-206`.
17. **Write Highlights** for each listing — the one piece of copy that exists nowhere. The field is
    structured (title + caption + image), so draw each from that listing's own "What you get"
    bullets and reuse a screenshot. `PROMOTION.md:225`: "nouns, not adjectives."
18. **Write v1.0 release notes,** and first settle which version number the world sees — the repo
    is simultaneously `0.1.0` (`apps/*/package.json`), `v1.1` (`ROADMAP.md` stage 5) and `2.0.0`
    (`apps/time-in-status/manifest.yml:8`).

### Phase E — create listing ① and submit (🧑 drives the form)

19. 🧑 **Re-run the two stage-4 market checks** for listing ① on the actual submission day, per
    `ROADMAP.md:109-114`. Has Atlassian shipped cumulative time-in-status natively? Has a free app
    taken the top of the niche? Either "yes" means not submitting, not submitting anyway.
20. 🧑 **Create the listing** at `marketplace.atlassian.com/manage/apps/create` and link app id
    `ari:cloud:ecosystem::app/05b589b7-c96b-40eb-8ded-0cc100ef851b`.
21. **Paste, field by field:**
    | Form field                   | Paste from                                                                                                                        |
    | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
    | App name                     | `docs/LISTING-COPY.md:12-14`                                                                                                      |
    | Tagline / summary            | `docs/LISTING-COPY.md:21-23`                                                                                                      |
    | Description                  | `docs/LISTING-COPY.md:35-96` — **after** step 12. Check whether the form wants `##` headings or plain paragraph breaks (`:30-31`) |
    | Highlights                   | step 17                                                                                                                           |
    | Categories                   | 🧑 choose from the live list; candidates in § 1.1 are unverified                                                                  |
    | Screenshots + captions       | step 8; captions at `docs/LISTING-COPY.md:139-146`                                                                                |
    | Alt text                     | step 10                                                                                                                           |
    | Documentation URL            | step 3 `/docs`                                                                                                                    |
    | Support contact              | step 4                                                                                                                            |
    | Privacy policy URL           | step 3 `/privacy`                                                                                                                 |
    | EULA / End User Terms        | step 3 `/terms`                                                                                                                   |
    | Privacy & security statement | `docs/LISTING-COPY.md:105-120` — paste the residual bullet **first**, per `RUNBOOK.md:151-154`                                    |
    | Scopes + justification       | `apps/time-in-status/manifest.yml:165-173`                                                                                        |
    | Remote hostnames             | "None."                                                                                                                           |
    | Hosting                      | Cloud (automatic)                                                                                                                 |
22. 🧑 **Set pricing**: Paid via Atlassian, cloud, per-user tiered. **1–10 users: $0.** Then
    $6.50/user to 100, $3.25 to 500, $1.60 beyond → **$325 at 50 seats**
    (`packages/engine/src/config/pricing.ts:87-103`).
23. **Complete the Privacy & Security tab.** Not mandatory (§ 0) — do it anyway; every answer is in
    `PRODUCT-SPEC.md` § 9 and takes an hour. Key answers: no data leaves the tenant, no third-party
    sharing, no telemetry, Forge SQL only, read-only scopes, no remote API.
24. 🧑 **Submit for review.** Atlassian targets a decision within a week;
    `RUNBOOK.md:155` budgets 5–10 calendar days.
25. 🧑 **Respond to feedback**, redeploy, resubmit. Code fixes can be delegated;
    the conversation cannot (`RUNBOOK.md:156`).
26. 🧑 **Publish.**

### Phase F — the gate, and only then listings ②–⑤

27. 🧑 **Do not submit listings ②–⑤ now.** `ROADMAP.md:73-85` gates them on the day-90 install
    count for listing ①: ≥30-40 proceed, 15-30 re-price _or_ re-position once, <15 stop. The code
    and the copy for all four being finished is the reason honouring the gate is cheap
    (`ROADMAP.md:149-151`).
28. 🧑 If the gate passes, repeat Phases B, C, E per listing in the order at `ROADMAP.md:102-107`:
    **② Worklog → ③ WIP Aging → ⑤ Issue History → ④ SLA Breach**, re-running the two market checks
    before each. Each listing's own app id, pricing ladder and copy locations are in § 1.

---

## 6. Hosting the public pages — the two cheapest honest routes

The privacy policy and support page are drafted in `docs/public-site/`. **Publishing them is the
human's action** — the placeholders (`[VENDOR NAME]`, `[CONTACT EMAIL]`, `[SUPPORT EMAIL]`,
`[SUPPORT URL]`, `[EFFECTIVE DATE]`, `[TIMEZONE]`, `[DOCS URL]`, `[PRIVACY POLICY URL]`) name the
identity and the commitments only the human can own, and each file carries its claims' sources as
HTML comments for verification before anything goes live.

### Route (a) — GitHub Pages on the existing public repo, $0

`github.com/sekonam/jira-flow-metrics-assets` is already public (it holds the five listing
thumbnails), so it can serve these pages without buying anything:

1. Fill every placeholder in both files; delete the draft-warning comment blocks.
2. Copy `privacy-policy.md` and `support.md` into the assets repo (root, or a `docs/` folder).
   GitHub Pages renders Markdown via Jekyll by default; commit an `index.md` linking both pages
   so the site root is not a 404.
3. In that repo: **Settings → Pages → Build and deployment → Deploy from a branch**, pick `main`
   and the folder chosen in step 2, save.
4. Wait for the Pages build (a minute or two), then open
   `https://sekonam.github.io/jira-flow-metrics-assets/privacy-policy` and `…/support` and read
   both pages as a stranger would.
5. Paste those URLs into the listing form fields (§ 5 step 21).

Trade-off: the URL says `github.io` and carries the repo name. Atlassian requires a privacy
policy URL, and nothing read for § 0 requires it to be on an owned domain — but re-check the live
form's field validation before relying on that.

### Route (b) — a bought domain, ~$12/yr

The route `START-HERE.md:52` already budgets. Buy the domain, point it at any static host
(GitHub Pages accepts a custom domain on the same setup as route (a); registrars' own static
hosting also works), publish the same two files at `/privacy` and `/support`. Costs money and a
DNS wait, reads as a vendor site, and gives the `/docs` and `/terms` pages from Phase A step 3 a
home with a stable identity. Route (a) can ship first and route (b) can take over later — a
listing's URLs can be edited after approval.

**This is roughly two weeks of human work away from a submittable listing ①, and the single
biggest blocker is that no Marketplace vendor account exists** — every other blocking item either
depends on it or can be done in parallel with it. The written material is in better shape than the
operational material by a wide margin: all five listings have a finished title, tagline,
description, privacy and security statement and a pricing ladder that three independent sources
agree on to the dollar, and the per-screenshot capture instructions are unusually thorough. What is
missing is not writing, it is identity and pixels: a vendor account, a domain carrying a privacy
policy and terms, a support address, one manifest line (`app.licensing.enabled: true`) without
which a paid app cannot be sold, a production deploy, and **30 screenshots of which zero are
currently shippable** — six exist but are stale, and listings ②–⑤ have none at all, because the
Forge iframe defeats automated capture and this is genuinely human-only work. The highest-value
correction in this document is § 4: two of the five descriptions contradict themselves within a
single page — WIP Aging both claims and denies a cumulative flow diagram, SLA Breach both promises
and denies saved goals — and Time in Status advertises three filters the shipped UI does not have.
Those are fifteen minutes of editing that remove a review-rejection risk and a refund risk, and
they should be made before the form is opened, not after.
