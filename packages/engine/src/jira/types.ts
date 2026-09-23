/**
 * Minimal structural types for the Jira Cloud REST payloads this engine reads.
 *
 * These are deliberately *not* exhaustive mirrors of Atlassian's schemas. They
 * describe only the fields we consume, every one of them optional where Jira
 * genuinely omits it, so that an unexpected payload degrades to "no data"
 * rather than to a thrown exception inside a report render.
 */

export interface JiraChangelogItem {
  /** Human-facing field name, e.g. `status`. */
  readonly field?: string;
  /** Stable field id where Jira supplies one, e.g. `status`, `customfield_10010`. */
  readonly fieldId?: string;
  readonly fieldtype?: string;
  readonly from?: string | null;
  readonly fromString?: string | null;
  readonly to?: string | null;
  /**
   * Jira names this field `toString`, which collides with
   * `Object.prototype.toString`. Declaring it as `string | null` alone would
   * make every object literal that omits it unassignable to this interface —
   * including perfectly valid partial fixtures — because the inherited
   * `() => string` is not a `string`. Widening the union to admit the inherited
   * method keeps literals assignable; read the value through
   * `changelogItemToValue` in `jira/parse.ts`, never directly.
   */
  readonly toString?: string | null | (() => string);
}

export interface JiraChangelogEntry {
  readonly id?: string;
  /** ISO-8601 with offset, e.g. `2026-03-01T09:15:00.000+0100`. */
  readonly created?: string;
  readonly author?: JiraUser | null;
  readonly items?: readonly JiraChangelogItem[];
}

export interface JiraUser {
  readonly accountId?: string;
  readonly displayName?: string;
  readonly emailAddress?: string;
  readonly active?: boolean;
}

export interface JiraChangelogPage {
  readonly startAt?: number;
  readonly maxResults?: number;
  readonly total?: number;
  readonly isLast?: boolean;
  readonly values?: readonly JiraChangelogEntry[];
  /** Present on the enhanced-search style responses. */
  readonly nextPageToken?: string | null;
}

export interface JiraStatusCategoryRef {
  readonly id?: number;
  /** `new`, `indeterminate`, `done`, `undefined`. */
  readonly key?: string;
  readonly name?: string;
}

export interface JiraStatusRef {
  readonly id?: string;
  readonly name?: string;
  readonly statusCategory?: JiraStatusCategoryRef;
}

export interface JiraWorklogEntry {
  readonly id?: string;
  readonly issueId?: string;
  readonly author?: JiraUser | null;
  readonly started?: string;
  readonly created?: string;
  readonly updated?: string;
  readonly timeSpentSeconds?: number;
  readonly comment?: unknown;
  /**
   * Present when the worklog is restricted to a project role or group.
   *
   * The app reads Jira as the app, so a restricted worklog comes back in full
   * even though the person looking at the report may not be allowed to see it.
   * Restricted worklogs are therefore **dropped at ingest** — see
   * `toWorklogRecord`.
   */
  readonly visibility?: {
    readonly type?: string;
    readonly value?: string;
    readonly identifier?: string;
  } | null;
}

export interface JiraWorklogPage {
  readonly startAt?: number;
  readonly maxResults?: number;
  readonly total?: number;
  readonly worklogs?: readonly JiraWorklogEntry[];
}

export interface JiraIssueFields {
  readonly summary?: string;
  readonly created?: string;
  readonly updated?: string;
  readonly resolutiondate?: string | null;
  readonly duedate?: string | null;
  readonly status?: JiraStatusRef;
  readonly issuetype?: { readonly id?: string; readonly name?: string };
  readonly priority?: { readonly id?: string; readonly name?: string };
  readonly assignee?: JiraUser | null;
  readonly project?: { readonly id?: string; readonly key?: string; readonly name?: string };
  readonly labels?: readonly string[];
}

export interface JiraIssue {
  readonly id?: string;
  readonly key?: string;
  readonly fields?: JiraIssueFields;
  /** Present when the issue was fetched with `expand=changelog`. */
  readonly changelog?: JiraChangelogPage;
}

export interface JiraSearchPage {
  readonly issues?: readonly JiraIssue[];
  readonly nextPageToken?: string | null;
  readonly isLast?: boolean;
  readonly total?: number;
}

/** One issue type, as the report filter offers it. */
export interface IssueTypeRef {
  readonly id: string;
  readonly name: string;
}

/** One user, as the report filter offers them. */
export interface JiraUserRef {
  readonly accountId: string;
  readonly displayName: string;
}

export interface JiraProjectRef {
  readonly id?: string;
  readonly key?: string;
  readonly name?: string;
}

/** `/rest/api/3/project/search` — scoped by Jira to what the caller may browse. */
export interface JiraProjectSearchPage {
  readonly values?: readonly JiraProjectRef[];
  readonly isLast?: boolean;
}

/** Payload shape of the `avi:jira:updated:issue` Forge product event. */
export interface JiraIssueUpdatedEvent {
  readonly eventType?: string;
  readonly issue?: { readonly id?: string; readonly key?: string };
  readonly associatedUsers?: readonly JiraUser[];
  readonly changelog?: JiraChangelogEntry;
  readonly timestamp?: number | string;
}
