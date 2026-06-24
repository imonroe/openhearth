/**
 * Reserved Home/Back keys (FR-A3 / NFR-5).
 *
 * `home` is the single most important binding: it must always return to
 * OpenHearth. There are two interception layers:
 *
 *  1. **In-app** (this module + FocusProvider): while OpenHearth is the active
 *     page, the reserved keys are handled in the SPA at the capture phase, so no
 *     in-app handler can shadow them.
 *  2. **Browser-level** (scripts/kiosk/home-guard extension): once a commercial
 *     service is loaded as the top-level page, the SPA is gone, so a content
 *     script intercepts the same keys on the service page and navigates back to
 *     OpenHearth. That is the cross-service guarantee.
 *
 * The default key sets here are the canonical list the kiosk extension mirrors
 * and the default `home`/`back` keys `keybindings.ts` uses. Per-action bindings
 * are configurable (keybindings.ts); the Home reservation stays special.
 */
export const DEFAULT_HOME_KEYS: readonly string[] = ['Home', 'BrowserHome'];
export const DEFAULT_BACK_KEYS: readonly string[] = ['Backspace', 'Escape', 'BrowserBack'];
