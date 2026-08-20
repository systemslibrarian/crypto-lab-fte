import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast.ts';
import { auditNonText } from './nontext.ts';
import { NONTEXT_BASELINE } from './nontext-baseline.ts';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Five rules govern everything here, and each one corrects something a naive
 * axe spec does:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. Pushing
 *     `animation:none!important; transition:none!important` through
 *     `addStyleTag` BYPASSES this lab's own
 *     `@media (prefers-reduced-motion: reduce)` block instead of exercising it,
 *     so the rendering a reduced-motion reader actually gets is never the one
 *     scanned. This gate sets the preference through `emulateMedia`, asserts
 *     from inside the page that it took effect, and injects nothing.
 *
 *  2. NOTHING IS REVEALED FROM SCRIPT. This lab ships three `<details>` shut —
 *     the transition table, the step trace and the glossary — and the shut
 *     state is what every reader arrives at. Forcing them open by setting
 *     `.open` scans a rendering nobody reaches and skips the one everybody
 *     does. Each is opened by clicking its `<summary>`, and both states scan.
 *
 *  3. THE DRIVE NAMES EVERY CONTROL IT TOUCHES. No regex sweep over "every
 *     button", no `.catch(() => {})`, no fixed sleeps. Every step waits on a
 *     real DOM completion signal — a status line's wording, an `aria-invalid`
 *     attribute, an output losing its `is-empty` class — so a click that
 *     silently did nothing fails loudly instead of looking identical to one
 *     that worked.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`. The surfaces that carry
 *     this lab's meaning are `color-mix()` fills axe files under `incomplete`
 *     rather than judging: the highlighted count-table row, the chip borders,
 *     the primary button's hover fill and the shared top bar's ink. So is an
 *     `aria-label` on a role-less element.
 *
 *  5. AXE HAS NO REFLOW, NON-TEXT-CONTRAST OR GENERATED-CONTENT RULE.
 *     `nontext.ts` measures every control's boundary against what is painted
 *     outside it, at every driven state; `expectNoHorizontalOverflow` adds the
 *     1.4.10 check. Both matter here: this page is dense with bordered inputs,
 *     it draws an SVG graph, and its longest values are 384-bit integers.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Two rAFs are not enough. A transition sampled mid-flight has a colour that
 * exists in no state of the page, and axe will happily report it: elsewhere in
 * this fleet that produced a phantom 2.00:1 failure on a button whose settled
 * ratio is 9:1. Transitions also drain in waves rather than in one batch, so a
 * poll for "nothing running right now" can exit through a gap between waves —
 * hence six consecutive quiet frames rather than one.
 *
 * Bounded three ways, because a gate that can hang is a gate nobody runs:
 * animations that never finish (`iterations: Infinity`) are excluded from the
 * quiescence test rather than waited on, a wall-clock budget inside the page
 * gives up and proceeds, and Playwright's own timeout is the backstop.
 *
 * Under the reduced motion this gate asserts, `styles/main.css`'s
 * reduced-motion block collapses every animation and transition to 0.001ms, so
 * `getAnimations()` drains immediately and this returns on the sixth frame. It
 * stays because the shared top bar's `.cl-btn` transitions are declared
 * OUTSIDE that block, and because the capacity bar's width is a live style
 * mutation that a future stylesheet could decide to animate.
 */
export async function settle(page: Page, budgetMs = 4000): Promise<void> {
  await page.waitForFunction(
    (budget: number) => {
      const w = window as unknown as { __quietFrames?: number; __settleStart?: number };
      if (w.__settleStart === undefined) w.__settleStart = performance.now();
      const done = (): boolean => {
        w.__quietFrames = 0;
        w.__settleStart = undefined;
        return true;
      };
      const running = document.getAnimations().filter((a) => {
        if (a.playState !== 'running') return false;
        const timing = a.effect?.getComputedTiming?.();
        // An infinite decorative animation never drains; waiting on it hangs.
        return timing?.iterations !== Infinity;
      });
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      if (w.__quietFrames >= 6) return done();
      if (performance.now() - (w.__settleStart ?? 0) > budget) return done();
      return false;
    },
    budgetMs,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set.
 *
 * This lab declares no `@keyframes` at all today, so the check is currently
 * vacuous, and that is worth stating rather than assuming: the assertion is the
 * only thing standing between "we have no entrance animations" and "we had one
 * and it swallowed a panel". It also catches the other shape it can find — text
 * faded to nothing by an ancestor's `opacity` for any reason.
 *
 * `aria-hidden` subtrees are excluded; what this lab hides is the decorative
 * status glyph beside its own words — see `contrast.ts`.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Uncaught page errors and console errors, collected from the moment the page
 * is created. Every panel here renders synchronously at first activation, so a
 * renderer that throws leaves that tabpanel EMPTY — and an empty region is
 * exactly what a scan reports as perfectly accessible. Attach before `boot`,
 * assert after the drive.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // A blocked or unreachable CDN script surfaces here as a bare
    // `Failed to load resource: net::ERR_…`, and that is a statement about
    // jsDelivr's reachability from this runner, not about this lab's
    // accessibility. The two layout libraries are an ENHANCEMENT: the page
    // falls back to its built-in BFS layering and says so in the legend, and
    // `claims.spec.ts` pins that fallback with the CDN blocked outright. So a
    // resource-load failure is excluded here — and ONLY that shape, so a real
    // `console.error` from the lab's own code still fails the run.
    if (/Failed to load resource/.test(m.text())) return;
    errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * Exactly one banner landmark.
 *
 * The shared `.cl-topbar` carries an explicit `role="banner"`. This lab's hero
 * IS a `<header class="cl-hero">` — but it lives inside `<main>`, and a
 * `<header>` scoped inside sectioning content implies no banner, so there is
 * exactly one today. That is precisely the coupling worth measuring rather than
 * reading: move the hero one level up, out of `<main>`, and the page silently
 * grows a second banner. Asserting the OUTCOME catches that edit; asserting the
 * markup would not.
 */
export async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(['MAIN', 'ARTICLE', 'ASIDE', 'NAV', 'SECTION']);
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute('role') === 'banner') return true;
      if (el.tagName !== 'HEADER') return false;
      if (el.getAttribute('role')) return false; // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false;
      return true;
    };
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length;
  });
  expect(banners, 'exactly one banner landmark').toBe(1);
}

/**
 * List semantics survive their styling.
 *
 * This lab has two shapes here. The primitives chip row is a `<div>` carrying an
 * explicit `role="list"` with `role="listitem"` children, because it is a list
 * of things and not a `<ul>`. The step trace is an `<ol class="trace-list">`
 * styled `list-style: none` — the declaration that makes Safari and VoiceOver
 * DROP a list's implicit role — with no explicit role to compensate.
 *
 * What is asserted is the shape of the fix rather than its presence: any
 * explicit role on a `ul`/`ol` must be `list` (any other value orphans every
 * `<li>` under it), and a `role="list"` must never sit on an empty element,
 * because axe applies `aria-required-children` to the explicit role and fails it
 * the day that list renders with no children. Roles can be assigned as JS
 * properties, so ask the DOM rather than grepping the source.
 */
export async function assertListSemantics(page: Page): Promise<void> {
  const broken = await page.$$eval('ul[role], ol[role]', (els) =>
    els
      .filter((e) => e.getAttribute('role') !== 'list' || e.children.length === 0)
      .map(
        (e) =>
          `${e.tagName.toLowerCase()}[role=${e.getAttribute('role')}] with ${e.children.length} children`
      )
  );
  expect(
    broken,
    'an explicit non-list role on a list deletes its semantics; an empty role="list" fails aria-required-children'
  ).toEqual([]);
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content every scan relies on is really on the page — including
 * the lab's DEFAULTS, which are never assumed.
 *
 * `test.use({ reducedMotion })` has silently done nothing on some Playwright
 * builds, so the emulation is applied imperatively BEFORE the navigation and
 * then *asserted* from inside the page. Nothing in this lab's JS branches on
 * `matchMedia`, but the CSS reduced-motion block is the only thing standing
 * between a scan and a mid-flight transition colour, so the assertion is still
 * the difference between scanning the reduced-motion rendering and merely
 * believing we did.
 *
 * The theme is seeded through `localStorage` before navigation. The page's
 * anti-flash script OVERWRITES it with `'dark'` unconditionally — dark is the
 * only theme this lab has — so the assertion below is that the overwrite really
 * happened, not that the seed survived. Seeding `'light'` and still landing on
 * `data-theme="dark"` is the check that the pin works.
 *
 * The defaults are asserted at length because the entire page is rendered by
 * `initUI` at module load. A navigation that resolves proves nothing: a
 * renderer that threw would leave `#app` empty, and an empty region is exactly
 * what a scan reports as perfectly accessible.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the
  // whole test timeout and reports nothing useful. 20s turns that silent hang
  // into a named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Seed the OTHER value on purpose: the head script must overwrite it.
  await page.addInitScript(() => localStorage.setItem('theme', 'light'));
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  expect(
    await page.evaluate(() => localStorage.getItem('theme')),
    'the anti-flash script must overwrite a stored light preference'
  ).toBe('dark');
  await assertSingleBanner(page);
  await assertListSemantics(page);

  // ── The page really rendered ────────────────────────────────────────────
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('#app')).toHaveCount(1);
  await expect(page.locator('a.cl-skip-link')).toHaveAttribute('href', '#app');

  // Dark is the only theme, so the page must carry no theme control at all.
  // The shared CSS hides any lab toggle with `display:none !important`, which
  // would leave a dead-but-known element; asserting the count at zero catches
  // the day one is added without going through that list.
  await expect(
    page.locator('#theme-toggle, #themeToggle, .theme-toggle, .theme-toggle-btn, [data-theme-toggle]')
  ).toHaveCount(0);
  await expect(page.locator('#cl-theme-toggle')).toHaveCount(0);

  // ── The arrival state: the phone preset, compiled ───────────────────────
  // Everything below is computed at load from the real DFA. If the regex
  // pipeline threw, the status line would say so and the stats would read "—",
  // which is why the numbers are asserted and not merely the absence of an
  // error.
  await expect(page.locator('#preset')).toHaveValue('phone');
  await expect(page.locator('#pattern')).toHaveValue('\\(\\d{3}\\) \\d{3}-\\d{4}');
  await expect(page.locator('#length')).toHaveValue('14');
  await expect(page.locator('#format-status-text')).toContainText('Compiled.');
  await expect(page.locator('#stat-states')).toHaveText('15');
  await expect(page.locator('#stat-classes')).toHaveText('6');
  await expect(page.locator('#stat-total')).toHaveText('10000000000');
  await expect(page.locator('#stat-capacity')).toHaveText('33 bits');
  await expect(page.locator('#dfa-status-text')).toContainText('15 states');
  await expect(page.locator('#encode-message')).toHaveValue('hi');

  // The graph really drew: 15 states plus one extra circle for the accepting
  // state's inner ring.
  await expect(page.locator('#dfa-graph circle')).toHaveCount(16);
  // k = 0 … 14, the chosen n.
  await expect(page.locator('#counts-body tr')).toHaveCount(15);
  await expect(page.locator('#counts-body tr.is-chosen')).toHaveCount(1);

  // ── Nothing is encoded, and every disclosure ships shut ─────────────────
  await expect(page.locator('#encode-out')).toHaveClass(/is-empty/);
  await expect(page.locator('#decode-out')).toHaveClass(/is-empty/);
  await expect(page.locator('#encode-copy')).toBeDisabled();
  await expect(page.locator('#decode-fill')).toBeDisabled();
  await expect(page.locator('details[open]')).toHaveCount(0);

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all, and this page is
 * unusually good at growing values that do not fit: a 64-character base64 stego
 * string, a 384-bit integer printed in full in the count table, and derived key
 * hex in the trace. Every one of them lives in a `.mono-out` or a `.stat dd`
 * relying on `overflow-wrap: anywhere` rather than a scroll region, and
 * `.stat-grid` is an auto-fit grid whose tracks have a 9.5rem minimum — so the
 * shapes at risk are an unwrapped run somewhere new, or a grid item whose
 * automatic minimum size is the min-content of a 100-character line.
 *
 * The three deliberate scrollers — the DFA diagram and the two tables — are
 * excluded by the clipping walk below, because a wide box inside an
 * `overflow: auto` wrapper contributes nothing to the document's scroll width.
 * At 380px this is precisely what the check exists to catch.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow: auto` wrapper has a huge bounding rect but
    // is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 *
 * This lab has three real scrollers and they are the reason this check is not
 * decorative: `.graph-wrap` around the DFA diagram, `.table-wrap` around the
 * transition table, and `.table-wrap` around the count table. All three hold
 * nothing focusable — an SVG and two static tables — so all three carry
 * `tabindex="0"` with a `role="region"` and an `aria-label`. A scroller born
 * without a keyboard route is invisible to axe, and this page grows one every
 * time a pattern compiles to a wider automaton.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY);
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * Nothing may be focusable while it paints nothing (WCAG 2.4.3 / 2.4.7).
 *
 * `opacity: 0` with `pointer-events: none` is NOT hiding: the element keeps
 * `tabIndex: 0`, so a keyboard reader tabs to a control that is not on screen
 * and the focus ring lands nowhere. `display: none` and `visibility: hidden`
 * DO remove an element from the tab order, so those are skipped rather than
 * flagged — the failure is specifically the invisible-but-tabbable pair. The
 * shapes at risk here are the `<details>` bodies, which are `display: none`
 * while shut and therefore legitimately out of the tab order.
 *
 * Off-screen-but-focusable is the WCAG-sanctioned skip-link idiom and is
 * deliberately not flagged: the shared skip link parks at `top:-3rem` with
 * full opacity and slides in on focus. The drive scans it focused.
 */
export async function expectNoInvisibleFocusTargets(page: Page, label: string): Promise<void> {
  const bad = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])';
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE))) {
      if (el.tabIndex < 0) continue;
      // display:none / visibility:hidden already remove it from the tab order.
      if (!el.checkVisibility?.({ checkVisibilityCSS: true })) continue;
      let effective = 1;
      for (let n: Element | null = el; n; n = n.parentElement) {
        effective *= parseFloat(getComputedStyle(n).opacity);
      }
      const r = el.getBoundingClientRect();
      if (effective !== 0 && r.width > 0 && r.height > 0) continue;
      // Confirm it really is reachable rather than inferring it.
      const before = document.activeElement;
      el.focus();
      const took = document.activeElement === el;
      (before as HTMLElement | null)?.focus?.();
      if (took) {
        out.push(
          `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${(el.getAttribute('class') ?? '').trim()}` +
            ` (opacity ${effective}, ${Math.round(r.width)}x${Math.round(r.height)})`
        );
      }
    }
    return Array.from(new Set(out));
  });
  expect(bad, `focusable elements that paint nothing in state: ${label}`).toEqual([]);
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run.
 * It is a debugging aid only: `A11Y_COLLECT` is never set in CI, and a run
 * with it set prints every finding as it happens and then fails at the end, so
 * a green collection run cannot be mistaken for a green gate.
 */
const COLLECTING = !!process.env.A11Y_COLLECT;
const collected: string[] = [];

function record(entry: string): void {
  collected.push(entry);
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`);
}

export function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected);
    return;
  }
  try {
    expect(actual, message).toEqual(expected);
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`);
  }
}

/**
 * Fail the test if the collection pass recorded anything. Without this a
 * collection run would end green, and a green collection run is
 * indistinguishable from a green gate — which is the exact confusion the whole
 * exercise exists to remove.
 */
export function reportCollected(): void {
  if (!COLLECTING) return;
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([]);
}

async function soft(fn: () => Promise<void>): Promise<void> {
  if (!COLLECTING) return fn();
  try {
    await fn();
  } catch (e) {
    // Generous, not 900: a truncated oracle dump is how a second and third
    // finding in the same state get missed on a collection pass.
    record(String(e).slice(0, 6000));
  }
}

/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast,
 * and the arithmetic text walk cannot reach a control's boundary or a
 * `::before` glyph, because a pseudo-element is not an element and owns no
 * text node.
 *
 * IT IS CALLED FROM `scan()`, deliberately and not by accident. Fleet-wide
 * this oracle had been called from inside a soft wrapper AFTER its
 * `if (!COLLECTING) return` guard — so in a strict run, which is every run in
 * CI and every run anyone reads as a pass, the guard returned first and
 * `nontext.ts` never executed at all. Thirteen repos certified themselves
 * clean on an oracle that had never looked. Calling it here means it runs at
 * every driven state, including `:hover`, and this repo's baseline was
 * captured by that live path.
 *
 * A check that merely logs is not a gate, so it ratchets: anything NOT in the
 * baseline fails, anything in the baseline that got WORSE fails, and anything
 * in the baseline that has been FIXED fails until its entry is deleted. That
 * last rule is what stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>();

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page);
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`);
    }
    return;
  }
  const problems: string[] = [];
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`;
    nonTextSeen.add(key);
    const base = NONTEXT_BASELINE[key];
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`);
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(`WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`);
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([]);
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the
 * point — or the drive stopped reaching the state that shows it, which is a
 * coverage regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k));
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)'
  ).toEqual([]);
}

/**
 * Scan the page as it currently stands.
 *
 * Nine assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - reduced-motion end state — see `expectNotBlank`.
 *  - `violations` — the usual WCAG A/AA rule failures, plus four landmark
 *    best-practice rules `withTags` does not run on its own.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically — which matters here because several surfaces are
 *    `color-mix()` fills axe cannot resolve: the highlighted count-table row,
 *    the primary chip's border, the primary button's hover fill and the shared
 *    bar's ink. Everything else in that bucket is a real result axe simply
 *    could not finish — including `aria-prohibited-attr`, which is where an
 *    `aria-label` on a role-less element hides. This page leans on getting that
 *    right: the two scrolling table wrappers and the graph wrapper all pair
 *    their `aria-label` with `role="region"`. Drop any of those roles and the
 *    label is silently discarded.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - the same walk over `aria-hidden` content with the exemption lifted —
 *    SC 1.4.3 is about what a reader SEES; see `contrast.ts` for what this
 *    lab hides and why it is measured anyway.
 *  - non-text contrast and generated content — SC 1.4.11, ratcheted; see
 *    `expectNoNewNonTextFailures`. This is the only oracle that judges a
 *    control's boundary against the surface OUTSIDE it.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - no focusable element that paints nothing — WCAG 2.4.3/2.4.7.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  // TWO axe runs, deliberately, and this is not a style choice.
  //
  // `AxeBuilder.withTags()` and `AxeBuilder.withRules()` both write the same
  // `options.runOnly` field, so the second call SILENTLY REPLACES the first —
  // the axe-core/playwright source says so in as many words on `withRules`
  // ("Cannot be used with AxeBuilder#withTags"). Chained as
  // `.withTags(TAGS).withRules([...4 landmark rules])`, axe runs those FOUR
  // best-practice rules and NOT ONE WCAG RULE, while a green result reads
  // exactly like a full A/AA pass. For scale, `withTags(TAGS)` selects 69 of
  // axe-core 4.12's 105 rule definitions; the chained form executes 4.
  //
  // The landmark four are still wanted because they are best-practice rather
  // than WCAG-tagged, so `withTags` alone does not reach them — and this page
  // has the shape they catch: a sticky `<header role="banner">` above a
  // `<div id="app">` holding a `<header class="cl-hero">` with an
  // `<aside class="cl-hero-why">` inside it, one `<nav>` in the shared bar, one
  // `<main>`, and a `<footer role="contentinfo">` that is a SIBLING of main so
  // contentinfo stays a top-level landmark.
  const wcag = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const landmarks = await new AxeBuilder({ page })
    .withRules([
      'landmark-no-duplicate-banner',
      'landmark-unique',
      'landmark-one-main',
      'landmark-complementary-is-top-level',
    ])
    .analyze();
  const results = {
    violations: [...wcag.violations, ...landmarks.violations],
    incomplete: [...wcag.incomplete, ...landmarks.incomplete],
  };

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  softExpect(violations, `axe violations in state: ${label}`, []);

  // The `incomplete` bucket is asserted, not skimmed. `aria-prohibited-attr`
  // and `aria-required-children` appear ONLY here — never in `violations` — so
  // a gate that ignores this bucket cannot see either. Only `color-contrast`
  // is allowed to remain, and only because the arithmetic walk below judges
  // those ratios for real; no other rule is filtered out.
  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, []);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  softExpect(contrast, `measured contrast failures in state: ${label}`, []);

  // The aria-hidden walk, exemption lifted — axe skips this text entirely and
  // the default walk honours the same boundary, so this second call is the
  // ONLY thing that ever measures it. See `contrast.ts` for the inventory.
  const hiddenContrast = Array.from(
    new Set(
      formatContrastFailures(
        await auditContrast(page, '[aria-hidden="true"], [aria-hidden="true"] *', true)
      )
    )
  );
  softExpect(hiddenContrast, `measured aria-hidden contrast failures in state: ${label}`, []);

  await soft(() => expectNoNewNonTextFailures(page, label));
  await soft(() => expectScrollersReachable(page, label));
  await soft(() => expectNoInvisibleFocusTargets(page, label));
  await soft(() => expectNoHorizontalOverflow(page, label));
}

// ── The drive ───────────────────────────────────────────────────────────────

/** Open a `<details>` the way a reader does, and prove it opened. */
async function openDisclosure(page: Page, selector: string): Promise<void> {
  await page.locator(`${selector} > summary`).click();
  await expect(page.locator(`${selector}[open]`)).toHaveCount(1);
}

async function closeDisclosure(page: Page, selector: string): Promise<void> {
  await page.locator(`${selector} > summary`).click();
  await expect(page.locator(`${selector}[open]`)).toHaveCount(0);
}

/**
 * Wait for an async panel to finish. Both long operations here run 600,000
 * PBKDF2 iterations, and the status row wears `is-working` for exactly that
 * span — so this waits on the lab's own completion signal rather than on a
 * timer, and a step that silently never started fails here instead of being
 * scanned mid-flight.
 */
async function settleStatus(page: Page, id: string): Promise<void> {
  await expect(page.locator(`#${id}`)).not.toHaveClass(/is-working/, { timeout: 120_000 });
}

/** Switch preset by choosing it, and prove the recompile landed. */
async function choosePreset(page: Page, value: string, pattern: string): Promise<void> {
  await page.locator('#preset').selectOption(value);
  await expect(page.locator('#pattern')).toHaveValue(pattern);
  await expect(page.locator('#format-status-text')).toContainText('Compiled.');
}

/**
 * Drive the lab through the states that render content, scanning each.
 *
 * Five things shape this drive:
 *
 *  - THE ARRIVAL STATE IS SCANNED FIRST, exactly as a reader gets it: the phone
 *    preset compiled, the automaton drawn, nothing encoded, every disclosure
 *    shut. A gate that force-reveals the page before its only scan never
 *    measures the rendering everybody actually meets.
 *
 *  - EVERY PRESET IS A DIFFERENT AUTOMATON, so each one repaints the graph, the
 *    stat grid and the count table with different content — including the
 *    81-state case, which is over the display cap and takes the "DFA too large
 *    to display" branch that no other state reaches.
 *
 *  - EVERY ERROR STATE. An unparseable pattern paints `aria-invalid` on the
 *    input and an error status; a message that overflows the format's capacity
 *    paints the capacity bar red BEFORE any key derivation; a wrong passphrase
 *    and a malformed salt each fail the decode in a different place. None of
 *    these is reachable without doing something wrong on purpose, and each is a
 *    distinct set of colours.
 *
 *  - HOVER IS A STATE, AND IT PERSISTS AFTER A CLICK. `:hover` stays on the
 *    element under the pointer after `page.click()` resolves, so it is the
 *    state a reader occupies the instant after pressing Encode — and both
 *    `#app button:hover` and `.cl-btn:hover` repaint their fill.
 *
 *  - NO FIXED TIMEOUTS. Every wait is on a real DOM signal: a status line's
 *    wording, an `aria-invalid` attribute, an output losing `is-empty`.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const scanAt = (s: string): Promise<void> => scan(page, `${theme} / ${s}`);

  await scanAt('arrival: phone preset compiled, nothing encoded, disclosures shut');

  // ── The shared skip link, focused ───────────────────────────────────────
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Tab');
  await expect(page.locator('a.cl-skip-link')).toBeFocused();
  await scanAt('the shared skip link focused, slid in from top:-3rem');

  // ── The transition table, opened the way a reader opens it ──────────────
  await openDisclosure(page, '#dfa-table-details');
  await expect(page.locator('#dfa-table-body tr')).toHaveCount(14);
  await scanAt('transition table open — the automaton as text');
  await closeDisclosure(page, '#dfa-table-details');

  // ── Each preset is a different automaton ────────────────────────────────
  await choosePreset(page, 'base64', '[A-Za-z0-9+/]{64}');
  await expect(page.locator('#stat-capacity')).toHaveText('384 bits');
  await expect(page.locator('#length')).toHaveValue('64');
  await scanAt('base64 preset — 65 states, a 2^384 slice, scientific-notation N');

  await choosePreset(page, 'ipv4', '\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}');
  await expect(page.locator('#length')).toHaveValue('15');
  await expect(page.locator('#stat-capacity')).toHaveText('39 bits');
  await scanAt('IPv4 preset — a variable-length language sliced at n = 15');

  await choosePreset(page, 'hex', '[0-9a-f]{32}');
  await expect(page.locator('#stat-capacity')).toHaveText('128 bits');
  await scanAt('hex preset — exactly 128 bits of capacity');

  // ── An unparseable pattern ──────────────────────────────────────────────
  await page.fill('#pattern', '(ab');
  await expect(page.locator('#preset')).toHaveValue('custom');
  await expect(page.locator('#pattern')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#format-status-text')).toContainText("Unclosed '('");
  await expect(page.locator('#stat-states')).toHaveText('—');
  await expect(page.locator('#encode-run')).toBeDisabled();
  await scanAt('unparseable pattern — aria-invalid boundary, error status, stats blanked');

  // ── A pattern whose DFA is over the display cap ─────────────────────────
  await page.fill('#pattern', '[0-9a-f]{1,80}');
  await expect(page.locator('#preset')).toHaveValue('custom');
  await expect(page.locator('#format-status-text')).toContainText('Compiled.');
  await expect(page.locator('#dfa-status-text')).toContainText('DFA too large to display');
  await expect(page.locator('#dfa-graph circle')).toHaveCount(0);
  await expect(page.locator('#dfa-engine')).toHaveText('Layout: not drawn');
  await scanAt('81-state automaton — over the display cap, counted but not drawn');

  // ── Back to the phone preset for the encode path ────────────────────────
  await choosePreset(page, 'phone', '\\(\\d{3}\\) \\d{3}-\\d{4}');

  // A message that cannot fit: the capacity bar goes red and the encode is
  // refused BEFORE any key derivation, so this state costs nothing to reach.
  await page.fill('#encode-message', 'far too long to fit in ten decimal digits');
  await expect(page.locator('#capacity-fill')).toHaveClass(/is-over/);
  await page.fill('#encode-passphrase', 'correct horse battery staple');
  await page.click('#encode-run');
  await settleStatus(page, 'encode-status');
  await expect(page.locator('#encode-status-text')).toContainText('tops out at 33 bits');
  await scanAt('message over capacity — red capacity bar and a refused encode');

  // ── A real encode ───────────────────────────────────────────────────────
  await page.fill('#encode-message', 'hi');
  await expect(page.locator('#capacity-fill')).not.toHaveClass(/is-over/);
  await page.click('#encode-run');
  await settleStatus(page, 'encode-status');
  await expect(page.locator('#encode-status-text')).toContainText('Encoded.');
  await expect(page.locator('#encode-out')).not.toHaveClass(/is-empty/);
  await expect(page.locator('#encode-out')).toHaveText(/^\(\d{3}\) \d{3}-\d{4}$/);
  await scanAt('encoded — a stego string, the bundle, and the Encode button still hovered');

  await openDisclosure(page, '#encode-trace');
  await expect(page.locator('#trace-list li')).toHaveCount(6);
  await scanAt('step trace open — six real intermediate values');

  // ── The decode path ─────────────────────────────────────────────────────
  await page.click('#decode-fill');
  await expect(page.locator('#decode-salt')).toHaveValue(/^[0-9a-f]{32}$/);
  await page.click('#decode-run');
  await settleStatus(page, 'decode-status');
  await expect(page.locator('#decode-status-text')).toContainText('Recovered');
  await expect(page.locator('#decode-out')).toHaveText('hi');
  await scanAt('decoded — the message recovered through the same automaton');

  // A WRONG PASSPHRASE IS NOT GUARANTEED TO FAIL, and asserting that it does is
  // how this step used to be flaky. There is no MAC: a wrong key lands uniformly
  // in [0, N), and the decoder accepts if the minimal big-endian encoding starts
  // with 0x01. On the phone slice (N = 10^10) that admits ~43% of wrong keys,
  // and the strict UTF-8 decode behind it catches most but not all of those, so
  // about one wrong passphrase in thirty "succeeds" with four bytes of garbage.
  // The salt is drawn fresh on every encode, so which branch fires is genuinely
  // random per run — CI's `retries: 1` masked it as merely flaky.
  //
  // The FAILURE rendering is the one worth scanning (it is the only state that
  // paints the error tone in this panel), so reach it deterministically: switch
  // to base64 first, where the frame byte passes 1/255 and the UTF-8 check then
  // has to accept ~47 uniform random bytes, making a false accept a ~2^-40
  // event. Re-encoding under the new format is required anyway, because
  // changing the format retires the previous stego string.
  await choosePreset(page, 'base64', '[A-Za-z0-9+/]{64}');
  await expect(page.locator('#encode-status-text')).toContainText('Retired');
  await scanAt('format changed under a fresh encode — the retired-result state');

  await page.click('#encode-run');
  await settleStatus(page, 'encode-status');
  await expect(page.locator('#encode-out')).toHaveText(/^[A-Za-z0-9+/]{64}$/);
  await page.click('#decode-fill');
  await page.fill('#decode-passphrase', 'the wrong passphrase');
  await page.click('#decode-run');
  await settleStatus(page, 'decode-status');
  await expect(page.locator('#decode-status-text')).toContainText('Decode failed');
  await expect(page.locator('#decode-out')).toHaveClass(/is-empty/);
  await scanAt('wrong passphrase — the decode fails closed');

  await page.fill('#decode-salt', 'not-hex');
  await page.click('#decode-run');
  await expect(page.locator('#decode-salt')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#decode-status-text')).toContainText('Hex must contain');
  await scanAt('malformed salt — aria-invalid boundary on the salt field');

  // ── The adversary panel ─────────────────────────────────────────────────
  // Back to the phone preset and a fresh encode, so the classifier has a
  // payload and the textbook PASS/FLAGGED contrast is on screen. That is the
  // state most readers will photograph, so it is the one that must scan clean.
  await choosePreset(page, 'phone', '\\(\\d{3}\\) \\d{3}-\\d{4}');
  await page.fill('#encode-message', 'hi');
  await page.fill('#encode-passphrase', 'correct horse battery staple');
  await page.click('#encode-run');
  await settleStatus(page, 'encode-status');
  await expect(page.locator('#encode-status-text')).toContainText('Encoded.');
  await expect(page.locator('#classifier-body tr')).toHaveCount(3);
  await expect(page.locator('#classifier-status-text')).toContainText('both raw encodings dropped');
  await scanAt('classifier run — one PASS row and two FLAGGED rows');

  // The pipeline and the cycle walk are populated by the same encode; the walk
  // paints a red tone for every rejected landing, which nothing else does.
  await expect(page.locator('#walk-svg .walk-dot.is-in')).toHaveCount(1);
  await expect(page.locator('#pipe-stego-value')).not.toHaveText('—');
  await scanAt('pipeline and cycle walk populated');

  // The honest half of the panel: a rule the format is not contained in, so the
  // stego string is FLAGGED and the error tone appears in this table.
  const stego = (await page.locator('#encode-out').textContent()) ?? '';
  await page.fill('#classifier-pattern', `\\((?!${stego.slice(1, 4)})\\d{3}\\) \\d{3}-\\d{4}`);
  await page.click('#classifier-run');
  await expect(page.locator('#classifier-summary')).toContainText('honest limit');
  await scanAt('classifier sharpened past the format — the stego string flagged');

  await page.click('#classifier-reset');
  await expect(page.locator('#classifier-status-text')).toContainText('both raw encodings dropped');

  // An invalid rule, for the aria-invalid boundary on that field.
  await page.fill('#classifier-pattern', '(unclosed');
  await page.click('#classifier-run');
  await expect(page.locator('#classifier-pattern')).toHaveAttribute('aria-invalid', 'true');
  await scanAt('classifier rule invalid — aria-invalid boundary on that field');
  await page.click('#classifier-reset');

  // ── The path through the automaton ──────────────────────────────────────
  await expect(page.locator('#pathwalk-string .pathchar')).toHaveCount(14);
  await expect(page.locator('#dfa-graph .dfa-node.is-current')).toHaveCount(1);
  await scanAt('path highlighted — the stego string walking the automaton');

  await page.locator('#pathwalk-scrub').focus();
  await expect(page.locator('#pathwalk-scrub')).toBeFocused();
  await scanAt('the path scrubber focused — a range input taking its focus ring');

  // ── Spot the fake ───────────────────────────────────────────────────────
  await page.click('#game-deal');
  await expect(page.locator('#game-list .game-item')).toHaveCount(8);
  await scanAt('spot the fake dealt — eight unticked candidates');

  await page.locator('#game-list input[type="checkbox"]').first().check();
  await page.click('#game-reveal');
  await expect(page.locator('#game-status-text')).toContainText('correct.');
  await expect(page.locator('#game-list .game-item.is-generated').first()).toBeVisible();
  await scanAt('spot the fake revealed — scored, with a tell under every candidate');

  // The preset with no defensible corpus declines to play, in words.
  await choosePreset(page, 'hex', '[0-9a-f]{32}');
  await page.click('#game-deal');
  await expect(page.locator('#game-status-text')).toContainText('no such thing as a realistic');
  await scanAt('spot the fake declined — hex has no realistic distribution');
  await choosePreset(page, 'phone', '\\(\\d{3}\\) \\d{3}-\\d{4}');

  // ── The NIST vectors ────────────────────────────────────────────────────
  await openDisclosure(page, '#vectors-details');
  await scanAt('vector panel open, not yet run');
  await page.click('#vectors-run');
  await settleStatus(page, 'vectors-status');
  await expect(page.locator('#vectors-body tr')).toHaveCount(9);
  // Three tones in one table: pass, unsupported, and no failures.
  await expect(page.locator('#vectors-body tr.is-skipped')).toHaveCount(3);
  await expect(page.locator('#vectors-body tr.is-flagged')).toHaveCount(0);
  await scanAt('vectors run — six passing rows and three UNSUPPORTED rows');
  await closeDisclosure(page, '#vectors-details');

  // ── The two limitations that are now demonstrations ─────────────────────
  // The ladder renders on compile, so it is already on screen; the variable
  // pattern is the state where it actually has something to say.
  await page.fill('#pattern', '[0-9a-f]{1,64}');
  await expect(page.locator('#format-status-text')).toContainText('Compiled.');
  await expect(page.locator('#leak-readout')).toContainText('distinct wire lengths');
  await scanAt('length ladder leaking — every message size its own wire length');
  await choosePreset(page, 'phone', '\\(\\d{3}\\) \\d{3}-\\d{4}');
  await expect(page.locator('#leak-readout')).toContainText('leaks nothing');
  await scanAt('length ladder on a fixed-length format — one bucket');

  // The substitution attack needs a live encode; the format change above
  // retired the last one.
  await page.fill('#encode-message', 'hi');
  await page.fill('#encode-passphrase', 'correct horse battery staple');
  await page.click('#encode-run');
  await settleStatus(page, 'encode-status');
  await expect(page.locator('#encode-status-text')).toContainText('Encoded.');
  await scanAt('substitution panel armed, not yet run');

  await page.click('#swap-run');
  await settleStatus(page, 'swap-status');
  await expect(page.locator('#swap-status-text')).toContainText('None returned your message');
  // Refused rows and, usually, at least one ACCEPTED row — the inverted tone.
  await expect(page.locator('#swap-body tr')).not.toHaveCount(0);
  await scanAt('substitution run — refused and accepted rows in one table');

  // ── The authenticated mode ──────────────────────────────────────────────
  // The refusal first: a phone number cannot carry a tag, and the error tone in
  // that panel appears nowhere else.
  await page.fill('#auth-passphrase', 'correct horse battery staple');
  await page.fill('#auth-message', 'hi');
  await page.click('#auth-seal');
  await settleStatus(page, 'auth-status');
  await expect(page.locator('#auth-status-text')).toContainText('does not fit');
  await scanAt('authenticated mode refusing a format too narrow for a tag');

  await choosePreset(page, 'base64', '[A-Za-z0-9+/]{64}');
  await page.fill('#auth-message', 'meet at six');
  await page.click('#auth-seal');
  await settleStatus(page, 'auth-status');
  await expect(page.locator('#auth-out')).not.toHaveClass(/is-empty/);
  await scanAt('sealed — an authenticated string with nothing travelling beside it');

  await openDisclosure(page, '#auth-trace');
  await expect(page.locator('#auth-trace-list li')).toHaveCount(7);
  await scanAt('authenticated step trace open — seven values, no salt among them');
  await closeDisclosure(page, '#auth-trace');

  await page.click('#auth-open');
  await settleStatus(page, 'auth-status');
  await expect(page.locator('#auth-status-text')).toContainText('Opened');
  await scanAt('opened — the receiver resynchronised without being told the counter');

  await page.click('#auth-attack');
  await settleStatus(page, 'auth-status');
  await expect(page.locator('#auth-status-text')).toContainText('0 accepted');
  await scanAt('the substitution attack refused outright by the tag');

  await choosePreset(page, 'phone', '\\(\\d{3}\\) \\d{3}-\\d{4}');

  // ── Key agreement, fragments, freshness ─────────────────────────────────
  await page.click('#hs-run');
  await settleStatus(page, 'hs-status');
  await expect(page.locator('#hs-body tr')).toHaveCount(2);
  await scanAt('key exchange run — two public keys and one shared root');

  await page.fill('#frag-message', 'meet me at six');
  await page.click('#frag-seal');
  await settleStatus(page, 'frag-status');
  await expect(page.locator('#frag-out')).not.toHaveClass(/is-empty/);
  await scanAt('fragments sealed — an authenticated message across several phone numbers');

  await page.click('#frag-tamper');
  await settleStatus(page, 'frag-status');
  await expect(page.locator('#frag-status-text')).toContainText('refused');
  await scanAt('one fragment tampered with — the whole message refused');

  await page.click('#replay-open');
  await settleStatus(page, 'replay-status');
  await scanAt('fragments opened once — the freshness window now holds a counter');

  await page.click('#replay-again');
  await settleStatus(page, 'replay-status');
  await expect(page.locator('#replay-status-text')).toContainText('Authentication failed');
  await scanAt('the same strings replayed — refused, in the error tone');
  await page.click('#replay-reset');

  // ── The guided path ─────────────────────────────────────────────────────
  await page.click('#tour-start');
  await expect(page.locator('#tour-panel')).toBeVisible();
  await scanAt('guided path open at step one');
  await page.click('#tour-end');
  await expect(page.locator('#tour-panel')).toBeHidden();

  // ── The capacity curve ──────────────────────────────────────────────────
  await page.locator('#curve-wrap').focus();
  await scanAt('the scrolling capacity-curve region focused — its keyboard route');
  await page.locator('#walk-wrap').focus();
  await scanAt('the scrolling cycle-walk region focused — its keyboard route');

  // ── The glossary ────────────────────────────────────────────────────────
  await openDisclosure(page, '#glossary-details');
  await scanAt('glossary open — the definition list expanded');
  await closeDisclosure(page, '#glossary-details');

  // ── Hover, which persists after a click ─────────────────────────────────
  await page.locator('#encode-run').hover();
  await scanAt('the primary Encode button hovered — its accent fill lightened');

  await page.locator('#encode-copy').hover();
  await scanAt('a secondary button hovered');

  await page.locator('.cl-topbar .cl-btn').first().hover();
  await scanAt('a shared top bar control hovered');

  // ── Focus rings on the controls that take them ──────────────────────────
  await page.locator('#encode-message').focus();
  await expect(page.locator('#encode-message')).toBeFocused();
  await scanAt('a textarea focused, showing its focus-visible outline');

  await page.locator('#preset').focus();
  await scanAt('the preset select focused');

  await page.locator('#dfa-graph-wrap').focus();
  await scanAt('the scrolling graph region focused — its keyboard route');
}
