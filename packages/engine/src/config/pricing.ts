/**
 * Marketplace pricing configuration.
 *
 * ## Why this is code and not just a spreadsheet
 *
 * The free-at-≤10-users tier is not a marketing choice; it is how evaluation
 * happens in this niche. Almost every competitor measured on 2026-09-05 is free
 * at 10 users, and the **install leader for time-in-status is a permanently
 * free app with 10,579 installs**. Encoding the ladder here means the in-app
 * "your plan" panel and the Marketplace listing cannot drift apart.
 *
 * ## Positioning
 *
 * Entry price is set *below* the dedicated leaders, because there is no product
 * wedge: SaaSJet Time in Status is 4.54★ over 208 reviews and OBSS Timepiece is
 * 4.79★ over 269, both actively maintained. Price and narrow scope are the only
 * honest entry, and that is exactly the position Broken Build occupies
 * profitably at 863 + 675 installs.
 *
 * Competitor prices below are **measured** from the Marketplace pricing API on
 * 2026-09-05. Our own figures are **decisions**, not measurements.
 */

export interface PricingTier {
  /** Upper bound of this tier, inclusive. `null` means "and above". */
  readonly upToUsers: number | null;
  readonly usdPerUserMonth: number;
}

/**
 * Where a listing sits in its niche's measured price field.
 *
 * Both ends are recorded, because "we undercut the leader" and "we are the
 * cheapest" are different claims and only the first one is true everywhere.
 * In the worklog niche in particular the two largest apps are *cheaper* than
 * this portfolio's price, and the docs say so rather than implying otherwise.
 */
export interface Positioning {
  /** The incumbent this listing is priced against. */
  readonly againstName: string;
  readonly againstAt50Usd: number;
  /** The cheapest paid competitor measured in the niche. */
  readonly cheapestPaidName: string;
  readonly cheapestPaidAt50Usd: number;
  /** A free competitor big enough that every buyer will see it first. */
  readonly notableFreeCompetitor: string | null;
}

export interface ListingPricing {
  readonly listingId: string;
  readonly listingName: string;
  /** At or below this user count the app is free. Mandatory in this niche. */
  readonly freeUpToUsers: number;
  readonly tiers: readonly PricingTier[];
  readonly positioning: Positioning;
}

/** Monthly USD for an instance of `users` seats. */
export function monthlyPrice(pricing: ListingPricing, users: number): number {
  if (users <= pricing.freeUpToUsers) return 0;
  let remaining = users;
  let previousBound = 0;
  let total = 0;
  for (const tier of pricing.tiers) {
    const bound = tier.upToUsers ?? Number.POSITIVE_INFINITY;
    const seatsInTier = Math.max(0, Math.min(users, bound) - previousBound);
    total += seatsInTier * tier.usdPerUserMonth;
    previousBound = bound;
    remaining -= seatsInTier;
    if (remaining <= 0) break;
  }
  return Math.round(total * 100) / 100;
}

/** The ladder as the Marketplace displays it. */
export function priceLadder(
  pricing: ListingPricing,
  seatCounts: readonly number[] = [10, 50, 100, 500],
): { users: number; usd: number }[] {
  return seatCounts.map((users) => ({ users, usd: monthlyPrice(pricing, users) }));
}

/**
 * Listing 1 — Time in Status / cycle time. $6.50/user to 100 seats gives
 * **$325 at 50 users**, against SaaSJet $575 and OBSS $600.
 */
export const TIME_IN_STATUS_PRICING: ListingPricing = {
  listingId: 'time-in-status',
  listingName: 'Time in Status & Cycle Time',
  freeUpToUsers: 10,
  tiers: [
    { upToUsers: 100, usdPerUserMonth: 6.5 },
    { upToUsers: 500, usdPerUserMonth: 3.25 },
    { upToUsers: null, usdPerUserMonth: 1.6 },
  ],
  positioning: {
    againstName: 'SaaSJet Time in Status',
    againstAt50Usd: 575,
    cheapestPaidName: 'votazz Time in Status Reports',
    cheapestPaidAt50Usd: 150,
    notableFreeCompetitor: 'Bloompeak Status Time Reports FREE (10,579 installs)',
  },
};

/** Listing 2 — Worklog reporting. $5.00/user gives **$250 at 50 users**. */
export const WORKLOG_PRICING: ListingPricing = {
  listingId: 'worklog-reports',
  listingName: 'Worklog Reports & Time Tracking',
  freeUpToUsers: 10,
  tiers: [
    { upToUsers: 100, usdPerUserMonth: 5.0 },
    { upToUsers: 500, usdPerUserMonth: 2.5 },
    { upToUsers: null, usdPerUserMonth: 1.25 },
  ],
  positioning: {
    againstName: 'Decadis sumUp for Jira',
    againstAt50Usd: 375,
    // Honest note: this listing is NOT the cheapest in its niche. The two
    // largest worklog apps (HeroCoders Clockwork Lite 7,030 installs and
    // SolDevelo Worklogs 5,390) both sell at $200/50 users, below this price.
    cheapestPaidName: 'votazz Worklog Time Tracking',
    cheapestPaidAt50Usd: 175,
    notableFreeCompetitor: null,
  },
};

/** Listing 3 — WIP aging / run charts. $5.50/user gives **$275 at 50 users**. */
export const WIP_AGING_PRICING: ListingPricing = {
  listingId: 'wip-aging',
  listingName: 'WIP Aging & Run Charts',
  freeUpToUsers: 10,
  tiers: [
    { upToUsers: 100, usdPerUserMonth: 5.5 },
    { upToUsers: 500, usdPerUserMonth: 2.75 },
    { upToUsers: null, usdPerUserMonth: 1.4 },
  ],
  positioning: {
    againstName: 'Broken Build WIP Aging & Run Charts',
    againstAt50Usd: 275,
    cheapestPaidName: 'Broken Build WIP Aging & Run Charts',
    cheapestPaidAt50Usd: 275,
    notableFreeCompetitor: null,
  },
};

/** Listing 4 — SLA / due-date breach. $7.00/user gives **$350 at 50 users**. */
export const SLA_BREACH_PRICING: ListingPricing = {
  listingId: 'sla-breach',
  listingName: 'SLA & Due Date Breach Reports',
  freeUpToUsers: 10,
  tiers: [
    { upToUsers: 100, usdPerUserMonth: 7.0 },
    { upToUsers: 500, usdPerUserMonth: 3.5 },
    { upToUsers: null, usdPerUserMonth: 1.75 },
  ],
  positioning: {
    againstName: 'Almarise SLA PowerBox',
    againstAt50Usd: 450,
    cheapestPaidName: 'Almarise SLA PowerBox',
    cheapestPaidAt50Usd: 450,
    notableFreeCompetitor: null,
  },
};

/** Listing 5 — Issue history / audit log. $7.50/user gives **$375 at 50 users**. */
export const ISSUE_HISTORY_PRICING: ListingPricing = {
  listingId: 'issue-history',
  listingName: 'Issue History & Audit Log',
  freeUpToUsers: 10,
  tiers: [
    { upToUsers: 100, usdPerUserMonth: 7.5 },
    { upToUsers: 500, usdPerUserMonth: 3.75 },
    { upToUsers: null, usdPerUserMonth: 1.9 },
  ],
  positioning: {
    againstName: 'SaaSJet Issue History',
    againstAt50Usd: 750,
    cheapestPaidName: 'SaaSJet Issue History',
    cheapestPaidAt50Usd: 750,
    notableFreeCompetitor: null,
  },
};

export const ALL_PRICING: readonly ListingPricing[] = [
  TIME_IN_STATUS_PRICING,
  WORKLOG_PRICING,
  WIP_AGING_PRICING,
  SLA_BREACH_PRICING,
  ISSUE_HISTORY_PRICING,
];

/**
 * Modelled monthly revenue for a listing.
 *
 * **`payingShare` is an assumption, not a measurement.** Atlassian does not
 * expose how many of an app's installs are paying, and every revenue figure in
 * this project's research inherits that uncertainty. The default of 0.25 is the
 * figure the market analysis used; it is a guess, and callers must present the
 * result as modelled.
 */
export function modelledMonthlyRevenueUsd(
  pricing: ListingPricing,
  installs: number,
  options: { payingShare?: number; averageSeats?: number } = {},
): { usd: number; payingShare: number; assumption: string } {
  const payingShare = options.payingShare ?? 0.25;
  const averageSeats = options.averageSeats ?? 50;
  const usd = installs * payingShare * monthlyPrice(pricing, averageSeats);
  return {
    usd: Math.round(usd * 100) / 100,
    payingShare,
    assumption: `ASSUMED ${Math.round(payingShare * 100)}% of installs pay at ${averageSeats} seats; Atlassian does not publish this figure.`,
  };
}
