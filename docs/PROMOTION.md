# PROMOTION — jira-flow-metrics

> Marketplace search is the channel. It is an SEO war entered at zero reviews against apps with
> 200-270 reviews and five years of ranking. This document is about winning the few things that
> _are_ winnable.

**What is not available, so it is not planned for:**

| Not available          | Why                                                                                                                                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cold email**         | Unlawful into the EU without prior express consent — § 7 Abs. 2 UWG has no B2B exemption — and worthless here anyway: Jira admins do not buy $325 reporting apps from strangers. **No outreach plan in this document involves an unsolicited email.** |
| **Paid placement**     | Atlassian sells no sponsored Marketplace results. Its own "attract new customers" page recommends SEO, your own site, social, blogs, press, Solution Partners, and opening a support ticket to _request_ marketing consideration.                     |
| **An audience**        | There isn't one. Nothing here assumes a newsletter, a following or an existing customer base.                                                                                                                                                         |
| **Superiority claims** | The incumbents are rated 4.54-4.79 across 200+ reviews and ship monthly. Any copy implying they are bad is both false and checkable in one click.                                                                                                     |

---

## 1. The listing page is the entire conversion surface

It is also the one input a solo developer can win on craft, and money cannot replace it. **Budget a
full week.** It is consistently the most underrated line in this whole plan.

### 1.1 Title — the single highest-leverage string

The Marketplace search index weights the title heavily, and competitor titles are built from the
same few keywords.

**Recommended:** `Time in Status & Cycle Time Reports for Jira`

Reasoning: `Time in Status` and `Cycle Time` both appear in competitor titles and both are searched;
`Reports` matches how buyers describe what they want; the title stays under the length at which the
Marketplace truncates in list view. Do not add adjectives — every character spent on "Powerful" or
"Advanced" is a character not spent on a keyword.

### 1.2 Tagline (one line, appears in search results)

> Cumulative time in every status — including re-entries Jira's control chart doesn't count.

This is the **one factual, checkable claim** the product has. It names a limitation of the native
feature rather than a flaw in a competitor, which is both true and unarguable.

### 1.3 Description structure

1. **The gap, stated as fact with the mechanism.** Jira's Control Chart reports only the most recent
   period an issue spent in a status. If an issue is blocked and comes back, the earlier period is
   not summed. This app sums every visit and shows the visit count next to the figure.
2. **What you get** — bullet list, plain nouns: cumulative time per status, visit counts, working
   hours or elapsed, cycle and lead time, flow efficiency, median and 85th percentile, filters,
   CSV export, dashboard gadget.
3. **What it does not do** — an honest short list. It filters out the wrong buyer before they
   install, and a bad-fit install that churns costs more than no install.
4. **How it works** — reads issue changelogs, stores aggregates inside your Atlassian tenant,
   nothing leaves it, read-only access.
5. **Pricing** — free up to 10 users, $325/month at 50.

### 1.4 Screenshots — 5 or 6, in this order

| #   | Shows                                                                       | Why it is in this position                           |
| --- | --------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | The report table with a visible `x2` re-entry badge and a cumulative figure | The product's whole argument, in the first thumbnail |
| 2   | The same issue side by side with Jira's own control chart figure            | Makes the claim checkable before install             |
| 3   | Elapsed vs working-hours toggle, with the working calendar visible          | The recurring hard part, and the reason to pay       |
| 4   | Summary tiles: median and 85th percentile per status                        | What goes into the review deck                       |
| 5   | The dashboard gadget on a real dashboard                                    | Where the buyer's colleagues will see it             |
| 6   | CSV export open in a spreadsheet                                            | Finance and QBR users want this more than the chart  |

Every screenshot needs realistic data. Empty-state or lorem-ipsum screenshots read as an abandoned
app, which is the specific thing a buyer is scanning for.

### 1.5 Keyword targets, in priority order

`time in status` · `cycle time` · `lead time` · `status duration` · `time between statuses` ·
`workflow report` · `flow efficiency` · `time tracking report`

Place them in the title, the tagline, the first paragraph and the screenshot captions. Do not stuff:
the Marketplace ranks on installs and reviews far more than on term frequency, and unreadable copy
loses more conversions than it gains impressions.

### 1.6 Accessibility of the listing itself

Alt text on every screenshot, no text carried only inside an image, and a description that reads
correctly in a screen reader. It costs an hour and it is consistent with a product that claims
WCAG 2.1 AA on its own UI.

---

## 2. The free tier is the funnel, not a giveaway

Free at ≤ 10 users is **mandatory**: almost every competitor measured on 2026-09-05 is free at that
tier, and the **install leader in this niche is a permanently free app with 10,579 installs**.

Consequences for how the free tier is built:

- It must be the **whole product**, not a crippled one. A ten-person team that cannot evaluate the
  real thing never becomes a fifty-person customer.
- The one thing worth showing free users is the number they would get on a bigger instance — the
  indexing banner and the visit counts do that for free.
- **Never answer "why not the free one?" with a feature comparison.** The honest answer is scope
  and price: this app does one report properly at half the price of the dedicated leaders.

---

## 3. The first ten reviews ★ the highest-leverage post-launch action

Competitors carry 36-269 reviews. Ratings are the single most visible ranking and trust signal, and
a new listing has none.

**The plan, in order:**

1. **Ask every early installer directly**, by name, once. Not a popup, not an email campaign — a
   short personal message from the vendor account after they have had the app for two weeks.
2. **Ask after a support interaction that went well.** That is the moment with the highest yield and
   the lowest awkwardness.
3. **Never incentivise a review.** It violates Marketplace policy and a reviewer who was paid writes
   a review that reads like one.
4. **Reply to every review, including the good ones**, within a day. Public replies are read by
   people deciding whether to install.
5. **Target: 5 reviews by day 60, 10 by day 120.** Below 5 by day 90, the review problem — not the
   product — is what the day-90 number is measuring.

**A one-star review in the first month is a genuine emergency**, because it is 100% of the visible
signal. Fix whatever caused it that day and reply publicly with what was fixed.

---

## 4. Atlassian Community — slow, legitimate, and the only free reach available

`community.atlassian.com` carries a steady flow of "how do I see how long issues sit in a status"
questions. They rank in Google and they persist.

**Rules, non-negotiable:**

- Answer the question **completely and usefully without the app first** — usually "the Control Chart
  shows only the most recent period, here is what it does show".
- **Disclose the affiliation in every post that mentions the app.** Undisclosed vendor participation
  is the exact pattern this project's own research caught a competitor doing, and it is
  indistinguishable from astroturfing once someone notices.
- One post per thread. Never revive a dead thread to advertise.
- Expect this to produce a handful of installs over months, not a launch spike. It is worth doing
  because it costs nothing and compounds; it is not a plan on its own.

---

## 5. The second listing is a distribution move, not a product move

This is the strongest single observation in the market research and it belongs here rather than in
the roadmap:

> A second listing is **a second search surface for the same engine**. Broken Build runs _Time in
> Status_ (863 installs) and _WIP Aging & Run Charts_ (675) off one codebase; 70% of Atlassian
> vendors ship one listing and 96% of those earn under $1k/month, while vendors with 4+ listings
> clear it 56-65% of the time.

Which is why listings 2-5 are already built and are gated on the day-90 number rather than on
engineering time. The marketing implication: **each listing gets its own honest, narrow copy**,
targeting different search terms. Cross-linking them ("also from this vendor") is worth doing; making
them read as one suite is not — a suite competes with Tempo and Appfire on breadth, which is the
losing position.

---

## 6. Owned surfaces, in the order they are worth building

| Surface                                                            | Worth it when                                                                                                     | Cost    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------- |
| **Documentation site** (`/docs` on a $12/yr domain)                | Immediately — the Marketplace links to it and reviewers check it                                                  | 2 days  |
| **A public "how time in status actually works in Jira" explainer** | Immediately after launch; it is the highest-intent search term in the niche and no competitor has written it well | 1 day   |
| Changelog page                                                     | Once there are customers to reassure                                                                              | hours   |
| Blog                                                               | Only if the explainer earns traffic                                                                               | ongoing |

The explainer is the one piece of content marketing worth doing early: it is genuinely useful,
it ranks for the exact term the product is named after, and it is honest — it explains the native
limitation, which is what a person searching that term actually wants to know.

---

## 7. What success looks like, and when to admit it does not

| Day    | Healthy                      | Warning                    | Stop     |
| ------ | ---------------------------- | -------------------------- | -------- |
| 30     | 8-15 installs                | < 5                        | —        |
| 60     | 20-30 installs, 3-5 reviews  | < 12 installs or 0 reviews | —        |
| **90** | **≥ 30-40 installs**         | **15-30**                  | **< 15** |
| 180    | 80-120 installs, 10+ reviews | < 50                       | —        |

At day 90 the decision is made on the counter, not on how the work felt. If it is under 15, the
answer is stop — the total cost of finding that out is about five weeks and $50, which is precisely
why the plan was staged this way.

---

## 8. Things deliberately not attempted

| Not doing                                              | Reason                                                                                                                                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cold email to Jira admins                              | Unlawful into the EU without consent; ineffective everywhere                                                                                                                                                                                                 |
| Paid ads                                               | Atlassian sells no placement; external ad networks convert badly for a $325 B2B app with no brand                                                                                                                                                            |
| Solution Partner outreach as a _sales_ channel         | Atlassian's partner model expects the vendor to supply partners with leads, a partner manager and co-marketing — a funded-vendor playbook. The best-positioned partners have also vertically integrated into app vending and compete rather than distribute. |
| Solution Partner outreach as a _validation_ instrument | Genuinely cheap and legitimate — "do your clients hit this problem?" is a small ask a stranger will answer. Worth doing, but it is research, not promotion, so it is not a line item here.                                                                   |
| Product Hunt / Hacker News launch                      | Wrong audience entirely. Jira admins are not there, and the buyer-builder overlap on HN is the worst possible crowd for a paid dev-adjacent tool.                                                                                                            |
| Comparison pages ("X vs SaaSJet")                      | The incumbents are good and well-reviewed. A comparison page invites the reader to check, and the check does not favour a listing with zero reviews.                                                                                                         |
