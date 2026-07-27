import { createRoot } from "react-dom/client";
import { MsalProvider } from "@azure/msal-react";
import { msalInstance } from "@/lib/msal-config";
import App from "./App.tsx";
import "./index.css";
import "./i18n";

// Initialize AND consume any Entra redirect response BEFORE rendering.
// React Router's "/" -> "/login" replace would otherwise destroy the #code=
// hash on first render, before MsalProvider's post-render handleRedirectPromise
// could read it — silently losing the login every time.
msalInstance
  .initialize()
  .then(() =>
    msalInstance.handleRedirectPromise().catch((e) => {
      console.error("MSAL redirect error", e);
      return null;
    })
  )
  .then((result) => {
    const account = result?.account ?? msalInstance.getAllAccounts()[0] ?? null;
    if (account) msalInstance.setActiveAccount(account);
    createRoot(document.getElementById("root")!).render(
      <MsalProvider instance={msalInstance}>
        <App />
      </MsalProvider>
    );
  })
  .catch((e) => {
    // A rejection from initialize() (storage/crypto init failures, restricted
    // browser contexts) skips both .then blocks above, so createRoot().render
    // never runs — a permanent blank page whose only trace is an unhandled
    // rejection. Render a minimal static message with plain DOM instead: React
    // itself may be what failed, and we run before any user language is known,
    // so the copy is hardcoded bilingual (da + en), not i18n.
    console.error("App bootstrap failed", e);
    const root = document.getElementById("root");
    if (root) {
      root.innerHTML =
        '<div style="min-height:100vh;display:grid;place-items:center;padding:1rem;font-family:system-ui,sans-serif;color:#141413;text-align:center">' +
        '<div style="max-width:420px">' +
        '<h1 style="font-size:1.125rem;font-weight:700;margin:0 0 .5rem">Noget gik galt · Something went wrong</h1>' +
        '<p style="font-size:.875rem;color:#5a5a57;margin:0 0 1rem">Genindlæs siden for at prøve igen. · Please reload the page to try again.</p>' +
        '<button onclick="location.reload()" style="cursor:pointer;border:0;border-radius:.375rem;padding:.5rem 1rem;font-size:.875rem;font-weight:500;background:#D97757;color:#fff">Genindlæs · Reload</button>' +
        "</div></div>";
    }
  });
