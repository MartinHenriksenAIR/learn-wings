import { PublicClientApplication, type Configuration } from '@azure/msal-browser';

const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_ENTRA_CLIENT_ID as string,
    authority: 'https://login.microsoftonline.com/common',
    redirectUri: (import.meta.env.VITE_REDIRECT_URI as string) || window.location.origin,
  },
  cache: {
    cacheLocation: 'localStorage',
  },
};

export const msalInstance = new PublicClientApplication(msalConfig);

export const apiScopes = [`api://${import.meta.env.VITE_ENTRA_CLIENT_ID}/access_as_user`];
