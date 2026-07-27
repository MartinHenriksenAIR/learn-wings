/**
 * One id per `npm run e2e` invocation, identical in every worker and on every
 * retry. Every artefact the suite creates is named with it, so anything a
 * failed cleanup leaves behind is traceable to the run that made it (see the
 * spec's fencing section).
 *
 * The id is minted by e2e/global-setup.ts and read here from the environment,
 * deliberately: this module is re-evaluated in each worker process, and
 * Playwright discards a worker after a test fails, so an id computed here would
 * differ between a test and its retry. That would break the guarantee on the
 * one path that actually leaves debris behind — the failure path.
 *
 * Discovery has no global setup to read, so it falls back to DISCOVERY_RUN_ID.
 * `runAllTestsWithConfig` in node_modules/playwright/lib/runner/index.js builds
 * two task lists: the `options.listMode` one is load + report only, while the run
 * one puts `createGlobalSetupTasks()` ahead of the load task. So `playwright test
 * --list` — and VS Code's Test Explorer, which lists through the test server's
 * equally setup-free `listTests` — would fail to even load a spec importing this
 * module if the missing id threw here.
 *
 * That fallback cannot leak into a name a test creates. Test bodies and fixtures
 * run only in worker processes, and a worker sets TEST_WORKER_INDEX in its own
 * process.env before it loads any spec file (WorkerMain's constructor, in
 * node_modules/playwright/lib/worker/workerProcessEntry.js), so a worker missing
 * the real id still throws on import — while discovery, which imports specs but
 * never executes one, lists fine.
 */
const DISCOVERY_RUN_ID = 'discovery';

function resolveRunId(): string {
  const id = process.env.E2E_RUN_ID;
  if (id) {
    return id;
  }
  if (process.env.TEST_WORKER_INDEX !== undefined) {
    throw new Error(
      'E2E_RUN_ID is not set in a Playwright worker. It is published by ' +
        'e2e/global-setup.ts, which runs only for a real test run — run the suite ' +
        'with `npm run e2e`.',
    );
  }
  return DISCOVERY_RUN_ID;
}

export const RUN_ID: string = resolveRunId();

export function e2eName(kind: string): string {
  return `e2e-${RUN_ID}-${kind}`;
}
