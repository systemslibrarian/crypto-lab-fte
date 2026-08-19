import { expect, test } from '@playwright/test';
import {
  boot,
  driveAllStates,
  expectBaselineNotStale,
  NARROW,
  reportCollected,
  watchPageErrors,
} from './gate.ts';

/**
 * WCAG A/AA regression gate.
 *
 * The lab is driven along everything it teaches: the arrival state, where the
 * phone preset has already compiled to a 15-state automaton and drawn it; the
 * shared skip link focused; the transition table opened through its own
 * summary; all four presets, each a different automaton with different capacity
 * arithmetic on screen; an unparseable pattern behind an `aria-invalid`
 * boundary; an 81-state automaton over the display cap, counted but not drawn;
 * a message too long for the format, with the capacity bar red and the encode
 * refused before any key derivation; a real encode, with its stego string,
 * out-of-band bundle and six-step trace; the decode that recovers it; the wrong
 * passphrase and a malformed salt, each failing in a different place; the
 * glossary; three hover states; and three focus rings, one of them on the
 * scrolling graph region. Every one of those states is scanned, at desktop and
 * phone width.
 *
 * See `gate.ts` for why nothing is injected into the page, why no disclosure is
 * opened from script, why the lab's defaults are asserted rather than assumed,
 * and why `violations` is not the whole oracle.
 */
for (const theme of ['dark'] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    test.setTimeout(1_800_000);
    const errors = watchPageErrors(page);
    await boot(page, theme);
    await driveAllStates(page, theme);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
    test.setTimeout(1_800_000);
    const errors = watchPageErrors(page);
    await page.setViewportSize(NARROW);
    await boot(page, theme);
    await driveAllStates(page, `${theme} @380px`);
    expect(errors, errors.join('\n')).toEqual([]);
    expectBaselineNotStale();
    reportCollected();
  });
}
