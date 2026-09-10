/**
 * Render the five gadget thumbnails `jira:dashboardGadget` requires.
 *
 * `forge lint` and `forge deploy` both accept any string for `thumbnail` —
 * neither fetches it — but Atlassian's own manifest reference is explicit:
 * "The **absolute URL** of the icon". A bundled resource path was tried
 * against that reading and would not satisfy it; this has to be a real image
 * at a real HTTPS URL, which is why the manifests still carry a placeholder
 * `.example` domain. Generating the images is the part that needs no
 * hosting decision; hosting them is the part that does, and is left to
 * whoever owns that decision.
 *
 * No image-generation tool is available in this environment, but a headless
 * browser is — the same one `ui:screens` already uses — so each icon is
 * drawn as inline SVG and screenshotted at 512×512, a size that downscales
 * cleanly to whatever Jira actually renders it at (undocumented).
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', '..', 'assets', 'thumbnails');
const say = (line = '') => process.stdout.write(`${line}\n`);

// Atlassian Design System blues, matching the palette every rendered screen
// already uses (packages/ui-harness/src/forge-host.tsx) — a thumbnail in a
// different palette would be the first thing to look wrong in the gadget list.
const BLUE = '#0C66E4';
const BLUE_DARK = '#09326C';
const SURFACE = '#FFFFFF';

const ICONS = {
  'time-in-status': {
    label: 'Time in Status',
    // A clock face with one hand doubled back — the re-entry the product sells.
    glyph: `
      <circle cx="256" cy="256" r="180" fill="none" stroke="${BLUE}" stroke-width="28"/>
      <line x1="256" y1="256" x2="256" y2="130" stroke="${BLUE_DARK}" stroke-width="20" stroke-linecap="round"/>
      <line x1="256" y1="256" x2="360" y2="330" stroke="${BLUE_DARK}" stroke-width="20" stroke-linecap="round"/>
      <path d="M 256 256 L 190 190" stroke="${BLUE}" stroke-width="14" stroke-linecap="round" stroke-dasharray="4 14"/>
    `,
  },
  'worklog-reports': {
    label: 'Worklog Reports',
    // A simple bar chart.
    glyph: `
      <rect x="130" y="260" width="70" height="140" rx="8" fill="${BLUE}"/>
      <rect x="221" y="190" width="70" height="210" rx="8" fill="${BLUE_DARK}"/>
      <rect x="312" y="230" width="70" height="170" rx="8" fill="${BLUE}"/>
    `,
  },
  'wip-aging': {
    label: 'WIP Aging',
    // An hourglass.
    glyph: `
      <path d="M170 130 H342 L256 256 Z" fill="${BLUE}"/>
      <path d="M170 382 H342 L256 256 Z" fill="${BLUE_DARK}"/>
      <rect x="160" y="118" width="192" height="20" rx="6" fill="${BLUE_DARK}"/>
      <rect x="160" y="374" width="192" height="20" rx="6" fill="${BLUE_DARK}"/>
    `,
  },
  'sla-breach': {
    label: 'SLA & Due Dates',
    // A calendar page with a warning triangle.
    glyph: `
      <rect x="120" y="150" width="272" height="230" rx="16" fill="${SURFACE}" stroke="${BLUE_DARK}" stroke-width="16"/>
      <rect x="120" y="150" width="272" height="60" rx="16" fill="${BLUE}"/>
      <path d="M256 240 L332 372 H180 Z" fill="none" stroke="${BLUE_DARK}" stroke-width="18" stroke-linejoin="round"/>
      <line x1="256" y1="278" x2="256" y2="322" stroke="${BLUE_DARK}" stroke-width="14" stroke-linecap="round"/>
      <circle cx="256" cy="348" r="7" fill="${BLUE_DARK}"/>
    `,
  },
  'issue-history': {
    label: 'Issue History',
    // A backwards-curving arrow — a timeline looked back over.
    glyph: `
      <path d="M150 210 A 130 130 0 1 1 150 320" fill="none" stroke="${BLUE}" stroke-width="28" stroke-linecap="round"/>
      <path d="M150 210 L100 210 L130 160 Z" fill="${BLUE_DARK}"/>
      <circle cx="256" cy="265" r="14" fill="${BLUE_DARK}"/>
      <circle cx="256" cy="205" r="10" fill="${BLUE}"/>
      <circle cx="310" cy="330" r="10" fill="${BLUE}"/>
    `,
  },
};

function pageFor(glyph) {
  return `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:${SURFACE};}
    svg{display:block;}
  </style></head><body>
    <svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <rect width="512" height="512" fill="${SURFACE}"/>
      ${glyph}
    </svg>
  </body></html>`;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });

  for (const [app, { label, glyph }] of Object.entries(ICONS)) {
    await page.setContent(pageFor(glyph));
    const file = join(OUT, `${app}.png`);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 512, height: 512 } });
    say(`  ✓ ${label.padEnd(20)} → ${file}`);
  }

  await browser.close();
  say(`\n${ICONS['time-in-status'] ? Object.keys(ICONS).length : 0} thumbnails written to ${OUT}`);
  say('These are placeholders in the sense that nobody has designed them — the shapes are');
  say('functional icons, not a reviewed brand asset. Real hosting is still a decision for');
  say('whoever owns the domain: see the manifest comment beside each `thumbnail:` line.');
}

main().catch((error) => {
  process.stderr.write(`\n✖ ${error.stack ?? String(error)}\n`);
  process.exit(1);
});
