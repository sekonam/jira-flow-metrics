import type React from 'react';
import { App as TimeInStatusPage } from '../../../apps/time-in-status/src/frontend/index';
import { Gadget as TimeInStatusGadget } from '../../../apps/time-in-status/src/frontend/gadget';
import { App as WorklogPage } from '../../../apps/worklog-reports/src/frontend/index';
import { Gadget as WorklogGadget } from '../../../apps/worklog-reports/src/frontend/gadget';
import { App as AgingPage } from '../../../apps/wip-aging/src/frontend/index';
import { Gadget as AgingGadget } from '../../../apps/wip-aging/src/frontend/gadget';
import { App as SlaPage } from '../../../apps/sla-breach/src/frontend/index';
import { Gadget as SlaGadget } from '../../../apps/sla-breach/src/frontend/gadget';
import { App as HistoryPage } from '../../../apps/issue-history/src/frontend/index';
import { Gadget as HistoryGadget } from '../../../apps/issue-history/src/frontend/gadget';
import { Panel as TimeInStatusPanel } from '../../../apps/time-in-status/src/frontend/panel';
import { Admin as TimeInStatusAdmin } from '../../../apps/time-in-status/src/frontend/admin';
import { Admin as WorklogAdmin } from '../../../apps/worklog-reports/src/frontend/admin';
import { Admin as AgingAdmin } from '../../../apps/wip-aging/src/frontend/admin';
import { Admin as SlaAdmin } from '../../../apps/sla-breach/src/frontend/admin';
import { Admin as HistoryAdmin } from '../../../apps/issue-history/src/frontend/admin';

/**
 * Every screen the five listings ship, imported from the app sources.
 *
 * These are the same modules the Forge bundler would take. Importing them
 * executes their module-scope `ForgeReconciler.render(...)`, which is a no-op
 * against the stand-in host renderer aliased in `vite.config.mts`.
 */

export type Surface = 'page' | 'gadget' | 'panel' | 'admin';

export interface HarnessScreen {
  readonly id: string;
  readonly listing: string;
  readonly surface: Surface;
  readonly Component: React.ComponentType;
  /** Viewport the Forge module actually gets: a full page, or a gadget tile. */
  readonly viewport: { width: number; height: number };
}

const PAGE = { width: 1280, height: 900 };
const GADGET = { width: 520, height: 420 };
/**
 * An `jira:issueActivity` tab renders inside the issue view's Activity
 * panel, which is narrower than a project page and taller than a gadget.
 */
const PANEL = { width: 880, height: 900 };
/** An admin page is a full settings page, same width as a project page. */
const ADMIN = { width: 1280, height: 700 };

export const SCREENS: readonly HarnessScreen[] = [
  {
    id: 'time-in-status-panel',
    listing: 'Time in Status',
    surface: 'panel',
    Component: TimeInStatusPanel,
    viewport: PANEL,
  },
  {
    id: 'time-in-status-admin',
    listing: 'Time in Status',
    surface: 'admin',
    Component: TimeInStatusAdmin,
    viewport: ADMIN,
  },
  {
    id: 'worklog-reports-admin',
    listing: 'Worklog Reports',
    surface: 'admin',
    Component: WorklogAdmin,
    viewport: ADMIN,
  },
  {
    id: 'wip-aging-admin',
    listing: 'WIP Aging',
    surface: 'admin',
    Component: AgingAdmin,
    viewport: ADMIN,
  },
  {
    id: 'sla-breach-admin',
    listing: 'SLA & Due Dates',
    surface: 'admin',
    Component: SlaAdmin,
    viewport: ADMIN,
  },
  {
    id: 'issue-history-admin',
    listing: 'Issue History',
    surface: 'admin',
    Component: HistoryAdmin,
    viewport: ADMIN,
  },
  {
    id: 'time-in-status-page',
    listing: 'Time in Status',
    surface: 'page',
    Component: TimeInStatusPage,
    viewport: PAGE,
  },
  {
    id: 'time-in-status-gadget',
    listing: 'Time in Status',
    surface: 'gadget',
    Component: TimeInStatusGadget,
    viewport: GADGET,
  },
  {
    id: 'worklog-reports-page',
    listing: 'Worklog Reports',
    surface: 'page',
    Component: WorklogPage,
    viewport: PAGE,
  },
  {
    id: 'worklog-reports-gadget',
    listing: 'Worklog Reports',
    surface: 'gadget',
    Component: WorklogGadget,
    viewport: GADGET,
  },
  {
    id: 'wip-aging-page',
    listing: 'WIP Aging',
    surface: 'page',
    Component: AgingPage,
    viewport: PAGE,
  },
  {
    id: 'wip-aging-gadget',
    listing: 'WIP Aging',
    surface: 'gadget',
    Component: AgingGadget,
    viewport: GADGET,
  },
  {
    id: 'sla-breach-page',
    listing: 'SLA & Due Dates',
    surface: 'page',
    Component: SlaPage,
    viewport: PAGE,
  },
  {
    id: 'sla-breach-gadget',
    listing: 'SLA & Due Dates',
    surface: 'gadget',
    Component: SlaGadget,
    viewport: GADGET,
  },
  {
    id: 'issue-history-page',
    listing: 'Issue History',
    surface: 'page',
    Component: HistoryPage,
    viewport: PAGE,
  },
  {
    id: 'issue-history-gadget',
    listing: 'Issue History',
    surface: 'gadget',
    Component: HistoryGadget,
    viewport: GADGET,
  },
];
