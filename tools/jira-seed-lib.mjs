/**
 * Shared Jira REST plumbing for the seeding scripts.
 *
 * Pulled out of `seed-dev-site.mjs` once `seed-bulk.mjs` needed the same
 * authenticated client, project/workflow discovery and transition-walking —
 * both scripts talk to the same kind of site the same way, and duplicating a
 * retrying HTTP client is the kind of thing that drifts the two copies apart
 * silently.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Minimal `.env` reader. A dependency for this would be absurd. */
export function loadDotEnv(rootDir) {
  const file = join(rootDir, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^(['"])(.*)\1$/, '$2');
  }
}

export class Jira {
  constructor({ baseUrl, email, token, dryRun }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
    this.dryRun = dryRun;
    this.calls = 0;
  }

  async request(method, path, body) {
    if (this.dryRun && method !== 'GET') {
      process.stdout.write(`      · [dry-run] ${method} ${path}\n`);
      return { dryRun: true };
    }
    const url = `${this.baseUrl}${path}`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      this.calls += 1;
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: this.auth,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

      // 429 is the one a real backfill will meet too, so honour Retry-After
      // rather than hammering. 5xx gets the same treatment on the assumption
      // it is transient; a 4xx never is, and is reported immediately.
      if (response.status === 429 || response.status >= 500) {
        const wait = Number(response.headers.get('retry-after') ?? 2 ** attempt) * 1000;
        process.stdout.write(
          `      · ${response.status}; retrying in ${Math.round(wait / 1000)}s\n`,
        );
        await sleep(wait);
        continue;
      }
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`${method} ${path} → ${response.status}\n${text.slice(0, 600)}`);
      }
      return text ? JSON.parse(text) : {};
    }
    throw new Error(`${method} ${path} — gave up after 5 attempts`);
  }

  get = (path) => this.request('GET', path);
  post = (path, body) => this.request('POST', path, body);
  del = (path) => this.request('DELETE', path);
}

/**
 * Did a failed DELETE mean the issue is already gone?
 *
 * The one decision both seeders' `--reset` makes about a caught error, and
 * it belongs here rather than in each of them: they had a copy each, round
 * three fixed both and tested one, and a copy that is only *currently*
 * identical is a copy that will drift.
 *
 * Only a genuine 404 forgets the key. Everything else — 401 on an expired
 * token, 403, a give-up after retrying a 429 — means the issue is still in
 * Jira, and the state file is the only record of it: clearing that record
 * orphans the issue beyond the reach of the tool that created it, forever.
 *
 * ★ Anchored on the status position. `Jira.request` formats the message as
 * `${method} ${path} → ${status}`, and the path contains the issue key — so
 * a bare `/\b404\b/` matched `DELETE /rest/api/3/issue/FLOW-404?… → 401`
 * and forgot the one issue per project whose key ends in -404, while
 * correctly keeping every other 401. The fix against orphaning, orphaning.
 */
export function deletionMeansGone(message) {
  return /→ 404\b/.test(String(message).split('\n')[0]);
}

export function isoDaysFromNow(days, from = new Date()) {
  const date = new Date(from.getTime());
  date.setDate(date.getDate() + days);
  // Local components rather than `toISOString().slice(0, 10)`, which converts
  // to UTC first: an evening run west of Greenwich, or an early-morning run
  // east of it, lands the due date a day off.
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Jira wants `+0000`, not the `Z` that `toISOString` produces. */
export function jiraTimestamp(daysAgo, hour) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, 0, 0, 0);
  return `${date.toISOString().replace('Z', '')}+0000`;
}

/** What a simplified Jira software template gives you, and nothing more. */
export const DEFAULT_TEMPLATE_STATUSES = new Map([
  ['TODO', 'To Do'],
  ['IN_PROGRESS', 'In Progress'],
  ['DONE', 'Done'],
]);

export async function resolveProject(jira, requestedKey, { defaultKey, name, die }) {
  const key = requestedKey ?? defaultKey;
  try {
    const project = await jira.get(`/rest/api/3/project/${key}`);
    process.stdout.write(`  ✓ using existing project ${key} — ${project.name}\n`);
    return project;
  } catch {
    process.stdout.write(`  · project ${key} not found; creating it\n`);
  }

  const me = await jira.get('/rest/api/3/myself');
  try {
    await jira.post('/rest/api/3/project', {
      key,
      name,
      projectTypeKey: 'software',
      projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-agility-kanban',
      leadAccountId: me.accountId,
    });
  } catch (error) {
    // Project creation is the step most likely to be refused — permissions,
    // a template the site does not have, a key already taken on another
    // project. None of it is worth guessing at; creating a project by hand
    // takes a minute and the rest of the script does not care how it appeared.
    die(
      `Could not create project ${key}:\n${error.message}\n\n` +
        `Create a Kanban software project in the Jira UI, then re-run with --project=<KEY>.`,
    );
  }
  if (jira.dryRun) {
    return { key, name, issueTypes: [{ name: 'Task', subtask: false, hierarchyLevel: 0 }] };
  }
  process.stdout.write(`  ✓ created project ${key}\n`);
  return jira.get(`/rest/api/3/project/${key}`);
}

/**
 * Pick a standard issue type.
 *
 * `hierarchyLevel === 0` is the selector, not the name: level 1 is Epic and
 * level -1 is Subtask, and both have workflows and semantics a seeded issue
 * should not inherit. Matching on the name "Task" was tried first and picked
 * **Epic** on a Russian site, where the standard type is called "Задача" and
 * the English list matched nothing, leaving the first entry to win by default.
 */
export function pickIssueType(project, die) {
  const standard = (project.issueTypes ?? []).filter((t) => !t.subtask && t.hierarchyLevel === 0);
  if (standard.length === 0) {
    die('The project exposes no standard (hierarchy level 0) issue types.');
  }
  const preferred = ['task', 'задача', 'story', 'история'];
  const found = standard.find((t) => preferred.includes(String(t.name).toLowerCase()));
  return (found ?? standard[0]).name;
}

/**
 * Which roles this project's workflow can actually reach, as `role -> status name`.
 */
export async function discoverRoles(jira, projectKey, rolesFromStatuses) {
  try {
    const perType = await jira.get(`/rest/api/3/project/${projectKey}/statuses`);
    const seen = new Map();
    for (const type of perType) {
      for (const status of type.statuses ?? []) seen.set(status.name, status);
    }
    return rolesFromStatuses([...seen.values()]);
  } catch {
    // The project does not exist yet, so its workflow cannot be inspected.
    return null;
  }
}

/**
 * Move an issue to a role, returning the status name reached or null.
 *
 * `simulated` is set only under `--dry-run`, where no issue exists to ask
 * about: the answer comes from the project-wide status list instead.
 */
export async function transitionTo(jira, issueKey, role, simulated, matchRole) {
  if (simulated) {
    const names = simulated.names ?? DEFAULT_TEMPLATE_STATUSES;
    return names.get(role) ?? null;
  }
  const { transitions = [] } = await jira.get(`/rest/api/3/issue/${issueKey}/transitions`);
  const match = transitions.find((t) => matchRole(t.to?.name) === role);
  if (!match) return null;
  await jira.post(`/rest/api/3/issue/${issueKey}/transitions`, { transition: { id: match.id } });
  return match.to.name;
}

export async function logWork(jira, issueKey, hoursList, label) {
  // Worklogs accept an explicit `started`, so unlike status history these can
  // be spread across real past days from a single run.
  for (const [index, hours] of hoursList.entries()) {
    await jira.post(`/rest/api/3/issue/${issueKey}/worklog?notifyUsers=false`, {
      started: jiraTimestamp(hoursList.length - index, 9 + index),
      timeSpentSeconds: hours * 3600,
      comment: {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `Seeded by ${label}` }] }],
      },
    });
  }
}
