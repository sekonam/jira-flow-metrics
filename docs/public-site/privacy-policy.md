# Privacy Policy

<!--
DRAFT — not published, not lawyer-reviewed. Placeholders in [BRACKETS] must be
filled by the human before this page goes anywhere. Every claim below carries an
HTML comment naming the repository fact that backs it; verify each before
publishing. Drafted 2026-09-23 against the repo state at commit 4eb12b7.
-->

**Effective date: [EFFECTIVE DATE]**

This policy covers the Jira Cloud apps published by [VENDOR NAME] on the
Atlassian Marketplace:

- Time in Status & Cycle Time Reports for Jira
- Worklog Reports & Time Tracking for Jira
- WIP Aging Reports & Charts for Jira
- SLA & Due Date Breach Reports for Jira
- Issue History & Audit Log Reports for Jira

<!-- App names: docs/LISTING-COPY.md:12-14, docs/LISTING-COPY-worklog-reports.md:65-67,
     docs/LISTING-COPY-wip-aging.md:63-72, docs/LISTING-COPY-sla-breach.md:68-70,
     docs/LISTING-COPY-issue-history.md:67-69. -->

All five are built on Atlassian Forge and run entirely inside Atlassian's
infrastructure. This policy is short because the apps do little with data —
that is a design decision, not an omission.

## What the apps read

The apps read from Jira, through Jira's own REST API, using read-only scopes:

- issues and their changelogs (status transitions, field changes),
- worklogs (who logged time, when, and how much),
- the display names of the users who appear in that data.

The requested scopes are `read:jira-work`, `read:jira-user` and `storage:app`
and nothing else. No app requests any Jira write scope; nothing the apps do
changes your Jira data.

<!-- Scopes: apps/*/manifest.yml permissions.scopes — e.g.
     apps/time-in-status/manifest.yml:180-188, identical lists in the other four.
     "never writes to Jira": the scope comment in each manifest and
     docs/PRODUCT-SPEC.md § 9 ("Read-only. No Jira write scope is requested by
     any listing; a manifest test asserts it"). -->

## What the apps store

To render reports quickly, the apps store derived rows in Forge SQL — a
database Atlassian hosts inside your own installation. Depending on the app,
those rows are: issue identifiers and timestamps, per-status time aggregates
and status visits, worklog entries (author account id, author display name,
time spent), and — for Issue History & Audit Log only — field-change records,
including the old and new values of changed fields, and the display name of
who changed them. Issue summaries and descriptions are not stored as such;
a field's old and new values appear in the Issue History data only when that
field was changed.

Issues placed under a Jira issue security level are never indexed, and
worklogs restricted to a project role or group are dropped at ingest. Nothing
is stored for a project nobody asked to index.

<!-- Stored row shapes: packages/engine/src/store/schema.ts — issue_meta,
     issue_status_agg, issue_status_visit, status_meta, worklog
     (author_account_id, author_display_name, time_spent_ms), issue_history
     (from_value, to_value, author_display_name), index_state, app_settings.
     No table stores issue summaries or descriptions. Security-level and
     restricted-worklog exclusions: docs/PRODUCT-SPEC.md § 9; "nothing is
     stored for a project nobody asked to index": same section. -->

## Where the data lives, and what leaves

All stored data lives in Forge hosted storage (Forge SQL) inside Atlassian's
infrastructure, per installation. **No data leaves the Atlassian boundary.**
The apps make no external network calls of any kind: no third-party services,
no analytics, no telemetry, no tracking, no external logging. Atlassian
reports the built app eligible for "Runs on Atlassian", its designation for
apps with no external egress.

<!-- No egress: apps/time-in-status/manifest.yml:8-11 ("Atlassian reports the
     build eligible for Runs on Atlassian — the app makes no external egress");
     no `external` or `remotes` section exists in any of the five manifests;
     docs/SUBMISSION-CHECKLIST.md § 1.0 records the "Remote hostnames" answer
     as "None". docs/PRODUCT-SPEC.md § 9: "No customer data leaves the
     Atlassian tenant." -->

## Who can see what

Every report checks that the person viewing it holds the `BROWSE_PROJECTS`
permission for the project, as that person, before returning anything. One
stated limitation: within a project the apps do not re-check per-issue
visibility for each viewer on every render — a permission scheme that grants
project browse but restricts a subset of issues is not modelled. The
issue-security-level exclusion above and the project-level check happen on
every read; that narrower per-issue case does not.

<!-- Permission check and the stated residual: docs/PRODUCT-SPEC.md § 9 and the
     "Privacy and security" section of each listing copy file, e.g.
     docs/LISTING-COPY.md:106-121. The residual is deliberately restated here
     so this policy and the Marketplace privacy statements agree. -->

## Cookies

None. The apps run inside Jira as Forge apps and set no cookies of their own
and use no tracking technologies.

<!-- The apps ship no cookie-setting code; no `document.cookie` or tracking
     library exists anywhere in apps/ or packages/. Frontends are @forge/react
     UI Kit surfaces rendered by Atlassian. -->

## Retention and uninstall

Stored data persists for the life of the installation so that reports do not
have to be rebuilt on every view. On uninstall, the data in Forge hosted
storage is handled by Atlassian's platform lifecycle — the apps neither can
nor need to reach into your tenant after removal. Atlassian's own
documentation is the authority on that lifecycle:
https://developer.atlassian.com/platform/forge/storage/

An administrator can see exactly what is held at any time: each app ships an
admin storage page showing how many rows and how many megabytes it stores in
your tenant.

<!-- Uninstall behaviour is Atlassian's, not this app's, so it is linked rather
     than asserted — per the platform-lifecycle framing. NOTE TO PUBLISHER:
     this URL was written from repo knowledge without a network check — open it
     before publishing and, if Atlassian documents app-storage deletion on
     uninstall on a more specific page, link that page instead.
     Admin storage page: apps/time-in-status/manifest.yml jira:adminPage module
     ("Time in Status storage"), docs/LISTING-COPY.md:62-63. -->

## GDPR

These apps introduce no data processing outside Atlassian's infrastructure.
All processing and storage happen within the Atlassian platform that already
hosts your Jira data, under your existing agreement with Atlassian; the apps
add no sub-processors, no external transfers and no additional data
categories beyond the derived rows described above. For how Atlassian itself
handles personal data, see Atlassian's privacy program documentation.

Questions or requests concerning personal data in these apps can be sent to
[CONTACT EMAIL]. Since all app data lives inside your own Atlassian tenant,
deleting the source data in Jira and re-indexing, or uninstalling the app,
removes it from the app's storage as well.

> **Note:** this policy has not been reviewed by a lawyer. It states what the
> software does; it is not legal advice.

<!-- The no-additional-processing claim follows from the no-egress facts cited
     above. The "deleting the source data … re-indexing" claim: ingest replaces
     per-issue rows wholesale (packages/forge-runtime/src/sql/sql-store.ts:235
     and :323 DELETE-then-INSERT per issue), so re-ingesting an issue whose
     data was removed in Jira replaces the stored rows. Uninstall removal is
     Atlassian's lifecycle, linked above. -->

## Changes to this policy

If the apps ever change what they read, store or send, this page changes
first and the effective date above is updated.

## Contact

[VENDOR NAME]
[CONTACT EMAIL]
