import {
  HttpError,
  parseRetryAfter,
  toStatusCategory,
  type JiraApi,
  type JiraChangelogPage,
  type JiraIssue,
  type JiraProjectRef,
  type JiraProjectSearchPage,
  type JiraSearchPage,
  type JiraStatusRef,
  type JiraWorklogPage,
  type PageParams,
  type SearchParams,
  type StatusMeta,
} from '@jfm/engine';

/**
 * Jira Cloud REST client for Forge.
 *
 * The HTTP layer is injected as {@link JiraFetch} rather than imported from
 * `@forge/api` directly, for the same reason as the SQL executor: it keeps
 * every URL, every query parameter and every error-mapping decision under test
 * without a live tenant, and reduces the unverified surface to the four-line
 * adapter in `forgeJiraFetch`.
 *
 * ## Scopes
 *
 * The apps request the least privilege that works: `read:jira-work` (issues,
 * changelogs, worklogs) and `read:jira-user` only where a listing displays user
 * names. **Nothing here writes to Jira**, and no customer data leaves the
 * Atlassian tenant.
 */

export interface JiraResponseLike {
  readonly status: number;
  readonly ok?: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/** Perform one Jira REST call. `path` already includes the query string. */
export type JiraFetch = (
  path: string,
  init?: { method?: string; body?: string; headers?: Record<string, string> },
) => Promise<JiraResponseLike>;

/**
 * Shape of a `@forge/api` requester (`api.asApp()` / `api.asUser()`).
 * Declared structurally so this package builds without `@forge/api` present.
 */
export interface ForgeRequester {
  requestJira(route: unknown, init?: unknown): Promise<JiraResponseLike>;
}

/**
 * Adapt `@forge/api` to {@link JiraFetch}.
 *
 * ⚠️ **UNVERIFIED against the live platform** — like the SQL executor, this is
 * the thin piece the first `forge tunnel` session must confirm. The `route`
 * tagged template is required by Forge's egress rules; passing a plain string
 * is rejected by the SDK.
 */
export function forgeJiraFetch(
  // A factory, not a requester: `api.asUser()` is only valid inside a
  // user-invoked context, and the runtime is memoised across invocations that
  // include product events and queue consumers. Resolving it lazily means an
  // as-user client can exist on an object that is also used from an event.
  getRequester: () => ForgeRequester,
  // Declared with no rest parameter so that Forge's own `route`, whose values
  // are narrowly typed, remains assignable. Nothing is ever interpolated.
  route: (strings: TemplateStringsArray) => unknown,
): JiraFetch {
  return (path, init) =>
    // `route` is a tagged template in the Forge SDK and rejects plain strings,
    // so the path is handed to it as a zero-interpolation template. There is
    // nothing to interpolate: every dynamic segment was already encoded by
    // `JiraRestClient` with `encodeURIComponent`/`URLSearchParams`.
    getRequester().requestJira(route(asTemplateStrings(path)), init);
}

/** Build a real `TemplateStringsArray` (it must carry a `raw` array). */
export function asTemplateStrings(literal: string): TemplateStringsArray {
  const strings: string[] & { raw?: readonly string[] } = [literal];
  strings.raw = [literal];
  return strings as unknown as TemplateStringsArray;
}

export interface JiraClientOptions {
  /** Milliseconds added to a 429's Retry-After, so we always back off further. */
  readonly retryAfterPaddingMs?: number;
  readonly now?: () => number;
}

interface JiraMyPermissions {
  readonly permissions?: Readonly<Record<string, { readonly havePermission?: boolean }>>;
}

export class JiraRestClient implements JiraApi {
  /**
   * @param fetch        reads Jira **as the app** — used for all ingestion.
   * @param fetchAsUser  reads Jira **as the calling user** — used only by
   *                     {@link canBrowseProject}. Required rather than
   *                     optional, because a client constructed without it
   *                     would silently have no authorization check.
   */
  constructor(
    private readonly fetch: JiraFetch,
    private readonly fetchAsUser: JiraFetch,
    private readonly options: JiraClientOptions = {},
  ) {}

  /**
   * Ask Jira, as the calling user, whether they may browse this project.
   *
   * Fails closed: any response that does not explicitly grant the permission
   * is treated as a refusal, and a transport failure propagates rather than
   * being swallowed into a `false`-that-looks-like-an-answer.
   */
  async canBrowseProject(projectId: string): Promise<boolean> {
    const query = new URLSearchParams({ projectId, permissions: 'BROWSE_PROJECTS' });
    const result = await this.request<JiraMyPermissions>(
      `/rest/api/3/mypermissions?${query.toString()}`,
      this.fetchAsUser,
    );
    return result.permissions?.['BROWSE_PROJECTS']?.havePermission === true;
  }

  async searchIssues(params: SearchParams): Promise<JiraSearchPage> {
    const query = new URLSearchParams();
    query.set('jql', params.jql);
    query.set('maxResults', String(params.maxResults));
    query.set('fields', params.fields.join(','));
    if (params.nextPageToken !== undefined) query.set('nextPageToken', params.nextPageToken);
    if (params.expandChangelog === true) query.set('expand', 'changelog');
    return this.get<JiraSearchPage>(`/rest/api/3/search/jql?${query.toString()}`);
  }

  async getIssue(issueIdOrKey: string, fields: readonly string[]): Promise<JiraIssue> {
    const query = new URLSearchParams({ fields: fields.join(',') });
    return this.get<JiraIssue>(
      `/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}?${query.toString()}`,
    );
  }

  async getChangelog(issueIdOrKey: string, page: PageParams): Promise<JiraChangelogPage> {
    const query = new URLSearchParams({
      startAt: String(page.startAt),
      maxResults: String(page.maxResults),
    });
    return this.get<JiraChangelogPage>(
      `/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}/changelog?${query.toString()}`,
    );
  }

  async getWorklogs(issueIdOrKey: string, page: PageParams): Promise<JiraWorklogPage> {
    const query = new URLSearchParams({
      startAt: String(page.startAt),
      maxResults: String(page.maxResults),
    });
    return this.get<JiraWorklogPage>(
      `/rest/api/3/issue/${encodeURIComponent(issueIdOrKey)}/worklog?${query.toString()}`,
    );
  }

  async getStatuses(): Promise<readonly StatusMeta[]> {
    const statuses = await this.get<JiraStatusRef[]>('/rest/api/3/status');
    return statuses
      .filter((s): s is JiraStatusRef & { id: string } => typeof s.id === 'string')
      .map((s) => ({
        id: s.id,
        name: s.name ?? s.id,
        category: toStatusCategory(s.statusCategory?.key),
      }));
  }

  /**
   * Scoped by Jira itself to what the calling user may browse — same
   * `fetchAsUser` transport as {@link canBrowseProject}, for the same reason:
   * this is the project picker in the dashboard gadget's config screen, and
   * offering a project its own viewer cannot see would leak at configuration
   * time rather than at read time.
   */
  async listProjects(): Promise<readonly JiraProjectRef[]> {
    const query = new URLSearchParams({ maxResults: '50' });
    const page = await this.request<JiraProjectSearchPage>(
      `/rest/api/3/project/search?${query.toString()}`,
      this.fetchAsUser,
    );
    return page.values ?? [];
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>(path, this.fetch);
  }

  private async request<T>(path: string, fetch: JiraFetch): Promise<T> {
    const response = await fetch(path, { headers: { Accept: 'application/json' } });
    if (response.status >= 400) {
      const body = await safeText(response);
      const now = this.options.now?.() ?? Date.now();
      const retryAfter = parseRetryAfter(response.headers.get('Retry-After'), now);
      const padded =
        retryAfter === null ? null : retryAfter + (this.options.retryAfterPaddingMs ?? 250);
      throw new HttpError(
        response.status,
        `Jira responded ${response.status} for ${redact(path)}`,
        padded,
        body.slice(0, 500),
      );
    }
    return (await response.json()) as T;
  }
}

async function safeText(response: JiraResponseLike): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * Strip the JQL from a path before it reaches a log line. JQL can contain
 * issue summaries and user names; error messages end up in Forge logs, which
 * are outside the customer's tenant boundary.
 */
export function redact(path: string): string {
  return path.replace(/([?&]jql=)[^&]*/i, '$1<redacted>');
}
