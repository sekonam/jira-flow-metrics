# PRIVACY & SECURITY — prepared answers for the Marketplace tab

Checklist § 2C item 15: the questionnaire is **not mandatory**, and it is worth an hour anyway —
every answer is already known from `PRODUCT-SPEC.md` § 9 and the manifests, so the hour is
transcription, not research. Filling it is also the cheapest trust signal a new vendor with no
install base can buy.

> **Read this before pasting.** The headings below are **ours, not Atlassian's.** The console's
> questionnaire wording changes, and this document was written without the form in front of it.
> Treat each entry as a prepared answer looking for its question: open the tab, match by topic,
> and where the console asks something not covered here, **do not improvise** — every answer below
> names the file that backs it, and an unbacked answer on a security form is worse than a blank.
>
> Verified against the repository at commit `ae6a001`, 2026-09-24.

---

## Hosting and data residency

**Where does the app run?** Entirely inside Atlassian. All five apps are Forge apps; there is no
vendor-operated server, no container, and no third-party host. Atlassian reports every build
eligible for **Runs on Atlassian**.

<!-- apps/*/manifest.yml header comment, e.g. apps/time-in-status/manifest.yml:8-11. -->

**Where is customer data stored?** Forge SQL, provisioned per installation, inside the customer's
own Atlassian tenant. Data residency therefore follows Atlassian's, and the vendor neither chooses
nor can change it.

**Does any data leave the tenant?** **No.** The apps declare **no remote hostnames** — answer
"none" wherever the form asks for external endpoints. There is no analytics SDK, no telemetry, no
error-reporting service and no CDN fetch.

---

## Access and permissions

**Scopes requested, and why.** Three, and nothing else:

| Scope            | Why                                              |
| ---------------- | ------------------------------------------------ |
| `read:jira-work` | Issues, changelogs and worklogs — the input data |
| `read:jira-user` | Display names shown on reports                   |
| `storage:app`    | Forge SQL tables and app settings                |

<!-- apps/*/manifest.yml permissions.scopes, e.g. time-in-status:180-188. -->

**Does the app write to Jira?** **No.** No write scope is requested by any of the five, and a test
asserts the manifests contain none. The apps read Jira and write only to their own storage.

**Whose permissions are enforced?** The **caller's**. A Forge app's own Jira reads are made as the
app, which would otherwise ignore who is looking — so every report checks `BROWSE_PROJECTS` for the
person asking, as that person, before returning anything.

<!-- packages/forge-runtime/src/handlers.ts:608. -->

**Issue-level security.** Issues carrying a Jira **issue security level** are **not indexed**.
Where an instance has no security scheme the clause is not searchable and indexing proceeds without
it — correctly, because an instance with no scheme has no restricted issues.

<!-- packages/engine/src/ingest/backfill.ts:59, :580-584. -->

**Restricted worklogs.** Worklogs restricted to a role or group are **dropped at ingest**, not
stored and filtered later.

Both of the above **under-report rather than over-disclose**. That is the deliberate direction: a
figure that is too low is a support question, a figure that leaks is an incident.

**Projects nobody asked to index.** The platform sends issue events for the whole instance. The
apps **ignore projects with no index**, so nothing is stored for a project no one opened.

<!-- packages/engine/src/ingest/incremental.ts:109. -->

---

## What is stored, and for how long

**Stored:** issue keys and ids, status transition timestamps, worklog durations and their author
account ids, field-change rows for the issue-history listing, and per-project settings (working
calendar, saved SLA goals).

**Not stored:** issue summaries, descriptions, comments, attachments, or any free text a person
typed into Jira — with the exception of field-change `From`/`To` values in the issue-history
listing, which are what that report exists to show.

**Retention.** Rows live for as long as the app is installed. Uninstalling removes the Forge SQL
storage with the installation; the vendor holds no copy, because the vendor has no server to hold
one on.

**How much?** Each app ships an **admin storage page** (Jira administration → Apps) showing rows
and estimated megabytes for that app in that tenant. The word "estimated" is on the page, next to
the number.

---

## Logging and error handling

**Do logs contain customer data?** They are written to keep it out:

- **JQL is redacted before any log line** — an issue summary can contain anything, and JQL can
  carry one.
- **Error messages shown to users never carry Jira response bodies.**

<!-- redact(), packages/forge-runtime/src/jira/client.ts:288-289, applied at :266. -->

**Who can read the logs?** Forge logs are visible to the app developer through the Forge CLI for
the environment. They contain project ids, issue keys and error text — never issue content.

---

## Output safety

**CSV formula injection.** Every CSV cell beginning `=`, `+`, `-`, `@`, tab or carriage return is
prefixed with a quote, so an issue summary cannot execute as a formula when the export is opened in
Excel or LibreOffice. Finite numbers are exempt — defusing a number would corrupt the value, and a
number cannot carry a formula.

<!-- packages/engine/src/export/csv.ts:16-26. -->

**Downloads.** The apps never download a file. Export renders the CSV as selectable text in a modal,
because a Forge frame cannot hand a file to the browser — stated on the modal itself rather than
worked around.

---

## Accessibility

WCAG 2.1 AA on the apps' own UI, achieved by using Atlassian Design System components through
`@forge/react` rather than a bespoke design language, plus three specifics: every duration carries a
text label and never colour alone, the re-entry badge carries its count as text, and a cell meaning
"no data" renders an em dash rather than an empty cell.

---

## Development practice

**Source.** Private repository, one developer. Dependencies are the Forge platform packages plus
Atlassian Design System; no third-party runtime service.

**Testing.** `pnpm run verify` gates every commit: format, typecheck, lint, a preflight manifest
check, the full test suite under coverage, and a build of all nine workspace packages. The suite is
maintained against deliberate mutation — a test that still passes when the thing it tests is
deleted is treated as a defect in the test.

**Vulnerability reports.** [SUPPORT EMAIL], same address as support, with the subject line marked
`SECURITY`. Stated response: first reply within two business days, same commitment as support, and
a data-exposure bug is worked ahead of everything else.

<!-- HUMAN: confirm before publishing — it becomes a promise. Matches
     docs/public-site/support.md § "Response times, honestly". -->

---

## The residual this document does not paper over

`TECHNICAL-SPEC.md` § 11 item 6 is the source of record for the app's stated residual risk, and the
five listings' Privacy and security sections already state it in customer-facing words. **Use that
wording here too rather than writing a softer version for the form** — the two being different is
exactly what a reviewer comparing them would flag.
