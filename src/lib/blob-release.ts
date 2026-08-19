import { callApi } from './api-client';

export interface MintedUpload {
  blobPath: string;
  releaseToken: string;
}

export function mintedUpload(minted: { blobPath?: string | null; releaseToken?: string | null }): MintedUpload | null {
  return minted.blobPath && minted.releaseToken
    ? { blobPath: minted.blobPath, releaseToken: minted.releaseToken }
    : null;
}

export function releaseUpload(minted: MintedUpload | null): void {
  if (!minted) return;
  void callApi('/api/blob-release', minted).catch(() => undefined);
}
