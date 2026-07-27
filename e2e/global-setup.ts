/**
 * Publishes the run id that names every artefact the suite creates.
 *
 * This runs once per `npm run e2e` invocation, in Playwright's main process,
 * before any worker is forked. Workers inherit this process's environment, so
 * every worker — including the fresh one Playwright spawns to retry a failed
 * test — reads the same id. That is the whole reason the id is minted here
 * rather than in e2e/run-id.ts; see the note there.
 */
export default function globalSetup(): void {
  process.env.E2E_RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
}
