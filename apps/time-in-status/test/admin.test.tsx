// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { loadScenarios, setBridgeResolvers } from '@jfm/ui-harness';

/**
 * The admin usage page, rendered.
 *
 * ⚠️ Rendered against the harness's stand-in for the Forge host renderer, not
 * on Forge. See `docs/RUNBOOK.md`.
 */

vi.mock('@forge/react', () => import('@jfm/ui-harness/forge-host'));

const { Admin } = await import('../src/frontend/admin.js');

const ESTIMATE = {
  bytes: 1_234_567,
  note: 'Estimated from row counts and per-row size constants, not measured on disk.',
  tables: [
    { table: 'issue_status_agg', rows: 12_000, bytes: 1_200_000 },
    { table: 'issue_meta', rows: 200, bytes: 32_000 },
    { table: 'issue_status_visit', rows: 30, bytes: 2_100 },
  ],
};

describe('time-in-status admin page', () => {
  it('reports what the installation is holding, per table', async () => {
    setBridgeResolvers({ getStorageEstimate: () => ({ ok: true, data: ESTIMATE }) });
    render(<Admin />);
    expect(await screen.findByText('issue_status_agg')).toBeDefined();
    expect(screen.getByText('12,000')).toBeDefined();
    expect(screen.getByText('Estimated storage')).toBeDefined();
    cleanup();
  });

  it('says the figure is an estimate rather than a measurement', async () => {
    setBridgeResolvers({ getStorageEstimate: () => ({ ok: true, data: ESTIMATE }) });
    render(<Admin />);
    // The whole value of this page is that a customer can check it against
    // their own Forge usage dashboard, which needs it to be honest about
    // being derived from row counts.
    expect(await screen.findByText(/not measured on disk/)).toBeDefined();
    cleanup();
  });

  it('★ renders a fresh installation as zero rather than as an empty state', async () => {
    // An admin checking before a rollout wants "nothing stored yet", not a
    // blank screen that could equally mean the page is broken.
    setBridgeResolvers({
      getStorageEstimate: () => ({
        ok: true,
        data: { bytes: 0, note: ESTIMATE.note, tables: [] },
      }),
    });
    render(<Admin />);
    expect(await screen.findByText('0 B')).toBeDefined();
    cleanup();
  });

  it('renders the refusal rather than a blank page', async () => {
    setBridgeResolvers({
      getStorageEstimate: () => ({ ok: false, error: 'Something went wrong loading this report.' }),
    });
    render(<Admin />);
    expect(await screen.findByText('Something went wrong loading this report.')).toBeDefined();
    cleanup();
  });

  it('★ renders the real non-admin refusal, produced by the real check', async () => {
    // Every payload above is hand-written, which proves only that the
    // invention renders. This one comes from the pipeline: a caller who is
    // not an administrator, through `handleStorageEstimate`'s own gate.
    //
    // It had no coverage at all — `PipelineOptions.adminAllowed` existed and
    // no scenario set it, so the fail-closed path this page exists to render
    // honestly had neither a test nor a screenshot, and the five
    // `*-admin--error.png` images showed a populated page under the caption
    // "Refused".
    const scenarios = await loadScenarios();
    const refusal = scenarios.error.responses.getStorageEstimate as {
      ok: boolean;
      error?: string;
    };
    expect(refusal.ok).toBe(false);
    setBridgeResolvers({ getStorageEstimate: () => refusal });
    render(<Admin />);
    expect(await screen.findByText(refusal.error!)).toBeDefined();
    cleanup();
  });
});
