/**
 * One id per `npm run e2e` invocation. Every artefact the suite creates is
 * named with it, so anything a failed cleanup leaves behind is traceable to
 * the run that made it (see the spec's fencing section).
 */
export const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');

export function e2eName(kind: string): string {
  return `e2e-${RUN_ID}-${kind}`;
}
