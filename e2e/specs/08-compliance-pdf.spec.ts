import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { expect, gotoFenced, test } from '../fixtures/fenced-org';


test.use({ viewMode: 'org_admin' });

const ANALYTICS_PATH = '/app/admin/org';

const COMPLIANCE_HEADING = 'AI Act Compliance';

const DOWNLOAD_REPORT = 'Download Report';

const REPORT_DOWNLOADED = 'Compliance report downloaded successfully';

const REPORT_FILENAME = /^ai-act-compliance-report-\d+\.pdf$/;

const REPORT_TIMEOUT = 30_000;

const SPEC_TIMEOUT = 8 * REPORT_TIMEOUT;

test.describe.configure({ timeout: SPEC_TIMEOUT });

function complianceHeading(page: Page): Locator {
  return page.getByRole('heading', { name: COMPLIANCE_HEADING, exact: true });
}

function assertStructurallyValidPdf(bytes: Buffer): void {
  expect(bytes.subarray(0, 5).toString('latin1'), 'the downloaded report is not a PDF at all').toBe('%PDF-');

  const trailer = bytes.subarray(-64).toString('latin1');
  const startxref = /startxref\s+(\d+)\s*%%EOF\s*$/.exec(trailer);
  expect(
    startxref,
    `the downloaded report has no "startxref <offset> %%EOF" trailer, so it is truncated or no ` +
      `longer a classic-xref PDF. Its last 64 bytes were ${JSON.stringify(trailer)}.`,
  ).not.toBeNull();

  const offset = Number(startxref?.[1]);
  expect(
    bytes.subarray(offset, offset + 4).toString('latin1'),
    `the report's trailer points at byte ${offset}, which is not the start of an xref table — the ` +
      'cross-reference offsets are wrong, so the file is structurally invalid however well it ' +
      'renders in a forgiving viewer (this is #273\'s defect class). If the generator moved to a ' +
      'PDF-1.5 cross-reference stream, this check is what needs rewriting.',
  ).toBe('xref');
}

test('the AI Act compliance report downloads as a real PDF', async ({ page, fencedOrg }) => {
  await gotoFenced(page, fencedOrg, ANALYTICS_PATH);

  await expect(
    complianceHeading(page),
    'the org-admin overview never offered the compliance report. The card is hidden in the global ' +
      'platform view and until an organization is selected (OrgAnalytics.tsx:344), so either the ' +
      'analytics query never answered or the fence stopped being current.',
  ).toBeVisible({ timeout: REPORT_TIMEOUT });

  const downloaded = page.waitForEvent('download', { timeout: REPORT_TIMEOUT });
  await page.getByRole('button', { name: DOWNLOAD_REPORT, exact: true }).click();

  await expect(
    page.getByText(REPORT_DOWNLOADED, { exact: true }),
    `generating the compliance report for ${fencedOrg.name} did not succeed — look for an ` +
      '"API error <status>" toast in the run report.',
  ).toBeVisible({ timeout: REPORT_TIMEOUT });

  const download = await downloaded;
  await expect(
    download.suggestedFilename(),
    'the report downloaded under an unexpected name, so it did not come from the app\'s own ' +
      'download path',
  ).toMatch(REPORT_FILENAME);

  const file = await download.path();
  if (!file) {
    throw new Error(
      'the browser reported a download but did not persist it to disk, so the report\'s bytes ' +
        'cannot be checked — which is the only thing this test is about.',
    );
  }
  assertStructurallyValidPdf(await readFile(file));
});
