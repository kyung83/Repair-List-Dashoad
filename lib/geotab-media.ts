import { createGeotabClient, type GeotabClientEnv } from './geotab-client';

// DownloadMediaFile returns raw image bytes. The shared Geotab client handles
// its own session and refresh, while this wrapper preserves the R2 image
// caching flow and existing response contract for the photo endpoint.
export async function fetchGeotabImage(env: GeotabClientEnv, mediaId: string) {
  if (!/^[a-z0-9._:-]+$/i.test(mediaId)) throw new Error('A valid Geotab media ID is required.');
  const client = await createGeotabClient(env);
  return client.downloadMedia(mediaId);
}
