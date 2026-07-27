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
    cacheLocation: 'sessionStorage',
  },
};

export const msalInstance = new PublicClientApplication(msalConfig);

export const apiScopes = [`api://${import.meta.env.VITE_ENTRA_CLIENT_ID}/access_as_user`];
