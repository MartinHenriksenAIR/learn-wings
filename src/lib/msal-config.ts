import { PublicClientApplication, type Configuration } from '@azure/msal-browser';

const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_ENTRA_CLIENT_ID as string,
    // 'common' authority allows any Entra tenant (multi-tenant)
    authority: 'https://login.microsoftonline.com/common',
    // `||`, not `??`: Vite inlines a blank env var (VITE_REDIRECT_URI=) as "" — which must
    // still fall back to the app's own origin (same rationale as config.ts).
    redirectUri: (import.meta.env.VITE_REDIRECT_URI as string) || window.location.origin,
  },
  cache: {
    // localStorage (not sessionStorage) so the token cache is shared across all
    // tabs of the origin: opening the app in a new tab picks up the existing
    // session silently instead of forcing a re-login (#431). Microsoft's
    // recommended setting for cross-tab SSO. logoutRedirect() still clears this
    // shared cache and ends the Entra session, so no usable session survives.
    cacheLocation: 'localStorage',
  },
};

export const msalInstance = new PublicClientApplication(msalConfig);

export const apiScopes = [`api://${import.meta.env.VITE_ENTRA_CLIENT_ID}/access_as_user`];
