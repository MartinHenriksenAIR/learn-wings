import { createRoot } from "react-dom/client";
import { MsalProvider } from "@azure/msal-react";
import { msalInstance } from "@/lib/msal-config";
import App from "./App.tsx";
import "./index.css";
import "./i18n";

// Initialize before render — handles redirect response from Entra login
msalInstance.initialize().then(() => {
  createRoot(document.getElementById("root")!).render(
    <MsalProvider instance={msalInstance}>
      <App />
    </MsalProvider>
  );
});
