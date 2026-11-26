# Web platform guidance

QWS uses [GoogleChrome Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance)
alongside the design rules in DESIGN.md. The installed skill source commit and
content hash are recorded in skills-lock.json. Local and global agent skill copies
are development tooling, excluded from Git sources and the production container.
The application has no new runtime or UI dependencies.

## Scope and browser policy

Required functionality uses Baseline Widely Available features. New browser
features progressively enhance a working fallback; origin trials and volatile
features are disabled in .mwgrc. No polyfill package is required. This guidance
covers HTML, CSS and browser JavaScript; it does not prescribe replacing Nuxt,
Vue, Python, the worker, authentication or server storage.

## Applied decisions

- Load Workspace and substantial sections asynchronously with Nuxt's Lazy
  components. Disable manifest prefetch hints so public archive pages do not
  speculatively download private sections. Keep normal imports and preloads for
  components actually needed by the current page.
- Use one visibility-aware, serial polling composable for queue, archives,
  expanded album tracks and news. Hide/close cancels pending timers; returning
  resumes without overlapping an already running request. In-flight requests
  may finish while hidden. Unmount removes listeners and timers.
- Render public archive metadata during SSR via the anonymous, allowlisted API.
  Never forward visitor cookies or Authorization. Nitro's server-only platform
  context carries just the original peer/forwarded addresses so SSR and direct
  public requests share rate limits; forwarded addresses are still trusted only
  with TRUST_PROXY=true. Keep no-store, CSP nonces, no-referrer and revocation.
- Declare the public cover directly in HTML with explicit square dimensions and
  fetchpriority=high. Do not lazy-load it or wait for a blob conversion. Search
  thumbnails remain lazy-loaded. A failed cover falls back to the music icon.
- Enhance disclosure height transitions with interpolate-size and block-size
  0/auto behind @supports. Retain the grid fallback, inert/aria-hidden states and
  reduced-motion rules. Do not opt the entire document into intrinsic animation.
- Keep native showModal()/close() focus behavior. Contain modal/backdrop scroll
  chaining without changing root overflow. Safari and older browsers may still
  scroll the background over a non-overflowing dialog/backdrop; focus remains
  trapped natively. Keep the existing opening animation and immediate close;
  exit animation requires additional cross-browser top-layer/focus handling.
- Use native search landmarks (explicitly recognized by the Vue compiler),
  interaction-aware :user-invalid styles, keyboard hints and associated password
  help/errors. Sensitive forms declare POST. Client validation is supplementary;
  server validation remains authoritative.
- Declare color-scheme metadata before rendering; keep existing root light/dark
  tokens and system preference handling. Update the browser title with the view.
- Replace the queue's copied/reversed array search with findLast(), preserving
  oldest-first processing without mutating the history array (Node >=22.13).

## Verification

The initial project scan found one verified reverse-array search; the app-only
scan found none. After modernization the project scan reports zero findings.
This scanner covers 38 guides / 52 deterministic rules, approximately 20% of the
catalog; zero findings is not a complete accessibility or security certification.

Run:

```sh
DISABLE_TELEMETRY=1 NPM_CONFIG_CACHE=/tmp/npm-cache npx -y modern-web-guidance@latest install
DISABLE_TELEMETRY=1 NPM_CONFIG_CACHE=/tmp/npm-cache npx -y modern-web-guidance@latest legacy-scan . --json
npm run typecheck
npm test
npm run build
npm run test:integration
```

The retained polling regression tests exercise in-flight visibility changes,
closed panels, serial scheduling and cleanup. Public HTTP tests exercise SSR
metadata escaping, artwork discovery, private-data isolation, no speculative
prefetch, per-client SSR rate limits and spoofed forwarding headers, alongside
existing archive ownership, revocation, expiry and transfer checks.

Browser checks use Chromium with fixture accounts/archives: 320, 390, 768, 1024
and 1440 px, dark mode, reduced motion, native disclosure sizing, search landmarks,
modal Escape/focus restoration and hidden-tab polling. Firefox, Safari and screen
readers require separate device checks; CSS support tables are not test results.
