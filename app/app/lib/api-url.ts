/**
 * The app calls its own origin. The app Worker forwards the API paths to the
 * API Worker over the Alchemy service binding, so the session cookie stays
 * first-party.
 */
export const apiUrl = window.location.origin;
