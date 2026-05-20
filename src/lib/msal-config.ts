import { PublicClientApplication, type Configuration } from '@azure/msal-browser';

const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_ENTRA_CLIENT_ID as string,
    // 'common' authority allows any Entra tenant (multi-tenant)
    authority: 'https://login.microsoftonline.com/common',
    redirectUri: (import.meta.env.VITE_REDIRECT_URI as string) ?? window.location.origin,
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
};

// Exported singleton — import this wherever MSAL is needed
export const msalInstance = new PublicClientApplication(msalConfig);

// Scope exposed via App Registration → Expose an API → access_as_user
export const apiScopes = [`api://${import.meta.env.VITE_ENTRA_CLIENT_ID}/access_as_user`];
