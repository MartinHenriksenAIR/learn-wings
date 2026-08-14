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
