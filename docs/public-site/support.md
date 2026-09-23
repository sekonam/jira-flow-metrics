# Support

<!--
DRAFT — not published. Placeholders in [BRACKETS] must be filled by the human
before this page goes anywhere. Drafted 2026-09-23. The response-time
commitment below follows docs/SUBMISSION-CHECKLIST.md Phase A step 4 ("a
response time you can actually keep" — PROMOTION.md:228); the human must
confirm it before publishing, because it becomes a promise the moment this
page is live.
-->

Support for the [VENDOR NAME] apps for Jira Cloud:

- Time in Status & Cycle Time Reports for Jira
- Worklog Reports & Time Tracking for Jira
- WIP Aging Reports & Charts for Jira
- SLA & Due Date Breach Reports for Jira
- Issue History & Audit Log Reports for Jira

## How to get help

- **Email:** [SUPPORT EMAIL]
- **Issue tracker:** [SUPPORT URL]

Either works; email is read first.

## What to include

The more of this a report carries, the faster it resolves:

1. **Which app**, and where you were looking — the project page, the issue
   timeline tab, the dashboard gadget, or the admin storage page.
2. **What you expected and what you saw.** A screenshot helps; crop out
   anything you would not want a stranger to read.
3. **Whether the indexing banner was showing.** While it is visible the
   numbers deliberately cover only the history indexed so far — that is the
   documented behaviour, not a defect.
4. Rough **instance size** (issues in the project, give or take) and whether
   the issue's row is badged "partial history".

<!-- Surfaces: apps/*/manifest.yml modules (jira:projectPage, jira:adminPage,
     jira:issueActivity, jira:dashboardGadget). Indexing banner and "partial
     history" badge: docs/PRODUCT-SPEC.md § 9 "Honesty requirements" items 1-2. -->

Please do not send Jira exports, API tokens or credentials. Nothing about
your data is visible from outside your Atlassian tenant — support works from
your description, not from access to your site.

<!-- Backed by the no-egress facts in privacy-policy.md: the developer has no
     server and no access path to customer data; see apps/time-in-status/
     manifest.yml:8-11 and docs/PRODUCT-SPEC.md § 9. -->

## Response times, honestly

These apps are built and supported by one person. That means:

- **First reply within two business days** ([TIMEZONE] business days). Usually
  sooner; two days is the promise, not the average.
- No 24/7 coverage, no phone support, no guaranteed same-day fix.
- Bugs that corrupt or wrongly expose data come first, ahead of everything
  else. Feature requests are read and answered, but honestly — most are
  declined, because each app is deliberately narrow.

<!-- "Two business days" is the commitment SUBMISSION-CHECKLIST.md Phase A
     step 4 names as one a solo developer can actually honour; PROMOTION.md:228
     requires a stated response time "you can actually keep". HUMAN: confirm
     the number and fill [TIMEZONE] before publishing. "Deliberately narrow":
     docs/PRODUCT-SPEC.md § 3 scope principle and each listing's "What it does
     not do" section. -->

## Documentation

- Product documentation: [DOCS URL]
- Each app's Marketplace listing describes exactly what it does and — just as
  deliberately — what it does not do.
- Inside Jira, each app's admin storage page (Jira administration → Apps)
  shows how many rows and how many megabytes the app holds in your tenant.
- Privacy policy: [PRIVACY POLICY URL]

<!-- No public documentation site exists yet (docs/SUBMISSION-CHECKLIST.md
     § 1.0 "Documentation URL — does not exist"); [DOCS URL] must point at the
     docs pages once hosted (source material: each listing's "What you get" /
     "What it does not do" sections, per SUBMISSION-CHECKLIST.md Phase A
     step 3). Admin page: apps/*/manifest.yml jira:adminPage. -->
