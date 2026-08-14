export default function globalSetup(): void {
  process.env.E2E_RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
}
