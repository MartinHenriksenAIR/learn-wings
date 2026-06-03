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
  });
