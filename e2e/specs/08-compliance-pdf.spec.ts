import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { expect, gotoFenced, test } from '../fixtures/fenced-org';

/**
 * The AI Act compliance report: generate it for this run's own organization and prove the
 * file that lands on disk is a structurally valid PDF (#71).
 *
 * **Fenced, even though it writes nothing.** `/api/generate-compliance-report` is a pure
 * read — it SELECTs members, course access and enrollments and returns bytes
 * (functions/generate-compliance-report/index.ts:48-157) — so the fence is not here to
 * contain a write. It is here because the report is *about* an organization, and the card
 * that generates it renders only when one is selected: `showComplianceReport` is
 * `!isGlobalView && !!currentOrg` (OrgAnalytics.tsx:344) and the endpoint refuses the `all`
 * aggregate outright (:144). Without the fence the org would be whichever
 * `OrgSelector` auto-selected — `orgs[0]`, the most recently created (OrgSelector.tsx:28,42
 * and functions/organizations/index.ts:33) — so the assertions would be about a real
 * customer's data, and a failure would be their problem to explain rather than this run's.
 *
 * **An empty fence can produce a report, verified twice over.** The endpoint has no
 * non-empty precondition: with no memberships and no `org_course_access` rows it takes
 * `staff = 0` (:94-96), `depts`/`courses` empty, `levelTotal = staff || 1` so nothing divides
 * by zero (:122), and `deficiency = staff > 0 && …` is false (:149) — the renderer then uses
 * its `emptyDepts`/`emptyCourses`/`emptyStatus` strings. Confirmed against the deployed app
 * on 2026-07-29: a fence created seconds earlier returned 200 `application/pdf`, 9632 bytes.
 * So there was no need to fall back to an organization with data.
 *
 * **This is the platform-admin route's surface too, reached from the view entitled to it.**
 * `routes.platformAdmin.analytics` renders the same `OrgAnalytics`, but as `isGlobalView`,
 * which is exactly the branch that hides this card — so org view is not a convenience here,
 * it is the only place the control exists. The endpoint needs no membership row in the fence
 * either: it hand-rolls its authorization (it returns binary, so it is not built on
 * `shared/endpoint.ts`) and accepts `is_platform_admin` OR an org-admin membership
 * (functions/generate-compliance-report/index.ts:48-58), which is the same rule
 * `requireOrgAdmin` encodes.
 *
 * **Danish characters are deliberately not asserted, and the reason is not laziness.** The
 * document is rendered in the caller's UI language — `i18n.resolvedLanguage` is posted with
 * the request (OrgAnalytics.tsx:152, #71) — and `seedSession` fixes that at `en`
 * (e2e/fixtures/session.ts:32), so what comes back is the English template, whose strings
 * contain no `æøå` at all (they live only in the `da` block of
 * functions/generate-compliance-report/strings.ts). A raw-byte search for those code points
 * would also be vacuous rather than merely irrelevant: pdfkit Flate-compresses its content
 * streams, and rendering both languages of an empty-org report locally found those byte
 * values present in the ENGLISH file too — such an assertion passes whatever the language.
 * The Danish-character defect itself was #273, in `generate-certificate`, which hand-rolls
 * its PDF bytes; this endpoint has been pdfkit-based since #230 and never had that bug.
 * Certificates are out of scope for this suite — they need a completed course, and
 * `generate-certificate` has a known latent corruption bug that would make the suite red for
 * an unrelated reason. What IS asserted below is #273's defect *class* rather than its
 * characters: that the cross-reference offset in the trailer points at real bytes.
 */

test.use({ viewMode: 'org_admin' });

/**
 * The org-admin analytics page (`routes.orgAdmin.root`), on its overview tab.
 *
 * No `?tab=` needed, unlike 06-org-members.spec.ts: `activeTab` falls back to `overview`
 * when the param is absent (OrgAnalytics.tsx:50), and `AnalyticsOverview` — which holds the
 * compliance card — is what that tab renders.
 */
const ANALYTICS_PATH = '/app/admin/org';

/** `analytics.aiActCompliance` — the card's heading, and the tab's loaded signal. */
const COMPLIANCE_HEADING = 'AI Act Compliance';

/** `analytics.downloadReport` — the generate trigger (AnalyticsOverview.tsx:333-345). */
const DOWNLOAD_REPORT = 'Download Report';

/** The success toast, which only the resolved success path shows (OrgAnalytics.tsx:163). */
const REPORT_DOWNLOADED = 'Compliance report downloaded successfully';

/**
 * The filename the app asks the browser to save under (OrgAnalytics.tsx:157).
 *
 * The client's own `a.download`, not the endpoint's `content-disposition` — both carry a
 * `Date.now()` stamp and they differ, so this pattern is a claim about the app's download
 * path rather than about the response header. Measured: `ai-act-compliance-report-
 * 1785311033683.pdf` against a header naming `…-1785311033434.pdf`.
 */
const REPORT_FILENAME = /^ai-act-compliance-report-\d+\.pdf$/;

/**
 * Budget for the analytics page to load and for the report to be generated.
 *
 * Wider than the config's 15s `expect` default, which was sized for assertions on
 * already-rendered state — a cold Azure Functions start alone can eat it. Two of these plus
 * `gotoFenced`'s own waits still sit inside the per-test budget, which the fence fixtures do
 * not draw on (they carry their own timeouts). Generation itself measured 779ms warm.
 */
const REPORT_TIMEOUT = 30_000;

/**
 * The compliance card's heading, which doubles as the overview tab's loaded signal.
 *
 * The card is rendered last in `AnalyticsOverview` and only once the page knows which
 * organization it is showing (AnalyticsOverview.tsx:326, gated on `showComplianceReport`),
 * so it appearing is what separates "the overview is up and offers the report" from "the
 * analytics query has not answered yet". Measured: 0 immediately after `gotoFenced` returned,
 * 1 a moment later — which is why the wait below is explicit rather than left to the click's
 * own auto-wait.
 */
function complianceHeading(page: Page): Locator {
  return page.getByRole('heading', { name: COMPLIANCE_HEADING, exact: true });
}

/**
 * Fail unless `bytes` is a PDF whose trailer points at its own cross-reference table.
 *
 * Three claims, each one something a mere "a download event fired" cannot say:
 *   - the file starts with the `%PDF-` signature, so it is a PDF and not a JSON error body
 *     the client blobbed anyway (`handleGenerateReport` calls `response.blob()` on whatever
 *     came back — OrgAnalytics.tsx:153);
 *   - it ends with `startxref <offset> %%EOF`, so it was not truncated in transit;
 *   - the bytes AT that offset are the `xref` table the offset promises. This is the
 *     interesting one: a generator that counts characters where it should count bytes ships a
 *     trailer pointing into the middle of the file, which is structurally invalid while still
 *     looking like a PDF at both ends. That is exactly #273's defect, and it is what a header
 *     check alone would miss.
 *
 * Grounded rather than guessed: rendering this report locally produced `%PDF-1.3`, a
 * `startxref 9110 %%EOF` trailer, and `xref\n0 17\n` at offset 9110 — and the file the
 * deployed app downloaded had the same shape at 9137. pdfkit emits a classic table, not a
 * PDF-1.5 cross-reference stream; if it is ever upgraded to one this assertion is the thing
 * to revisit, and the message says so.
 */
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

  // `gotoFenced` already asserted the OrgSelector names the fence, so the card that appears
  // here is the fence's card and the report will be about it.
  await expect(
    complianceHeading(page),
    'the org-admin overview never offered the compliance report. The card is hidden in the global ' +
      'platform view and until an organization is selected (OrgAnalytics.tsx:344), so either the ' +
      'analytics query never answered or the fence stopped being current.',
  ).toBeVisible({ timeout: REPORT_TIMEOUT });

  // Armed before the click: the anchor is clicked and its blob URL revoked synchronously
  // inside the same handler (OrgAnalytics.tsx:159-160), so there is no point after the click
  // at which it is safe to start listening.
  const downloaded = page.waitForEvent('download', { timeout: REPORT_TIMEOUT });
  await page.getByRole('button', { name: DOWNLOAD_REPORT, exact: true }).click();

  // The app's own report that generation resolved, asserted before the file is read so a
  // failed generation is diagnosed by its message rather than by a download that never came.
  // Only the success path shows this (OrgAnalytics.tsx:163); a rejection lands in the catch
  // and toasts `callApiRaw`'s `API error <status>` instead (src/lib/api-client.ts:53), which
  // is what to look for in the run report when this times out.
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

  // The bytes, not the event. `path()` resolves to null for a download the browser did not
  // persist, and reading that would throw an unhelpful ENOENT deeper in.
  const file = await download.path();
  if (!file) {
    throw new Error(
      'the browser reported a download but did not persist it to disk, so the report\'s bytes ' +
        'cannot be checked — which is the only thing this test is about.',
    );
  }
  assertStructurallyValidPdf(await readFile(file));
});
