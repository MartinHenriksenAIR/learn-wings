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
 */
function resolveRunId(): string {
  const id = process.env.E2E_RUN_ID;
  if (!id) {
    throw new Error(
      'E2E_RUN_ID is not set. It is published by e2e/global-setup.ts, which runs only ' +
        'under the Playwright runner — run the suite with `npm run e2e`.',
    );
  }
  return id;
}

export const RUN_ID: string = resolveRunId();

export function e2eName(kind: string): string {
  return `e2e-${RUN_ID}-${kind}`;
}
