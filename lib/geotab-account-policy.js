// The fleet application must not sign in to MyGeotab as the retired
// personal operator account. All active Geotab credentials must be entered
// in Diagnostics as a dedicated, non-personal service account.
export const GEOTAB_SERVICE_ACCOUNT_REQUIRED =
  'Geotab needs a dedicated service account saved under Diagnostics → Geotab Connection. Deployment credentials and the old encrypted account are not used.';

export function isRetiredPersonalGeotabUsername(value) {
  const local = String(value ?? '').trim().split('@')[0].toLowerCase();
  return ['jtomaski', 'j.tomaski', 'jerry.tomaski', 'jerry_tomaski'].includes(local);
}

export function assertDedicatedGeotabUsername(username) {
  if (!String(username ?? '').trim()) throw new Error('Enter a Geotab service account username.');
  if (isRetiredPersonalGeotabUsername(username)) {
    throw new Error('The personal jtomaski Geotab account is not permitted for fleet automation. Save a dedicated MyGeotab service account in Diagnostics.');
  }
}
