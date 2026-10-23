/* ─────────────────────────────────────────────────────────────────────────
 * String Music — the ONE edition flag.
 *
 *   ELITE_BUILD = true   →  String Music Elite
 *                           full app: YouTube streaming, lyrics, crossfade.
 *                           distributed only as an APK on GitHub Releases.
 *
 *   ELITE_BUILD = false  →  String Music Simple
 *                           local files only, no network at all.
 *                           .── the version published on Google Play ──.
 *
 * tools/build-apps.mjs rewrites this line for every build. Package names are
 * permanent: com.stringmusic.simple and com.stringmusic.elite.
 * ──────────────────────────────────────────────────────────────────────── */
const ELITE_BUILD = true;

/* Where "I Understand, Take Me to Elite" sends people: the releases page of
 * the String Music repository. This is the only place the URL lives — change
 * it here if the repository moves. */
const ELITE_RELEASES_URL =
  'https://github.com/Guhan-N/String-Music/releases/latest';

window.ELITE_BUILD = ELITE_BUILD;
window.ELITE_RELEASES_URL = ELITE_RELEASES_URL;
