import { expect, test, type Page } from '@playwright/test';

/**
 * The claims suite: does the page tell the truth?
 *
 * The rule that makes these tests worth anything is that they compare two
 * values the PAGE printed, or re-derive a claim from the page's own inputs by a
 * DIFFERENT route than the source takes. A test that re-runs the source's own
 * expression will happily agree with a bug.
 *
 * So, concretely, the independent oracles used below are:
 *
 *  - the PLATFORM regex engine, for "is this stego string really a member of
 *    the language?" — `RegExp` knows nothing about this lab's DFA, its
 *    equivalence classes or its ranking, so agreement between them is real
 *    evidence rather than a tautology;
 *  - closed-form combinatorics, for the count table — a hex format's length-k
 *    slice has exactly 16^k members and therefore exactly 4k bits of capacity,
 *    which the DP never computes that way;
 *  - BigInt arithmetic over the numbers the page PRINTED, for every
 *    "capacity = floor(log2 N)" claim;
 *  - the round trip itself, for the cipher: type a message, read it back.
 *
 * Plus the cross-checks a single surface cannot fake: the preset menu's
 * hand-written "(33 bits at n = 14)" against the live stat grid, the count
 * table's highlighted row against the stat grid, the capacity bar's figures
 * against both, and the SVG's circle count against the transition table.
 */

const PHONE = '\\(\\d{3}\\) \\d{3}-\\d{4}';

async function boot(page: Page): Promise<void> {
  page.setDefaultTimeout(20_000);
  await page.goto('.');
  await expect(page.locator('#format-status-text')).toContainText('Compiled.');
}

async function text(page: Page, id: string): Promise<string> {
  return ((await page.locator(`#${id}`).textContent()) ?? '').trim();
}

/** Wait out the 600,000-iteration PBKDF2 by watching the lab's own signal. */
async function settleStatus(page: Page, id: string): Promise<void> {
  await expect(page.locator(`#${id}`)).not.toHaveClass(/is-working/, { timeout: 120_000 });
}

function floorLog2(value: bigint): number {
  return value <= 0n ? 0 : value.toString(2).length - 1;
}

test.describe('the format panel agrees with itself', () => {
  test('every preset label matches the capacity the DFA actually computes', async ({ page }) => {
    await boot(page);
    // The option labels are hand-written prose in template.ts; the stat grid is
    // computed from the count table. Nothing keeps them in step but this test.
    const options = await page.locator('#preset option').evaluateAll((els) =>
      els
        .map((el) => ({ value: (el as HTMLOptionElement).value, label: el.textContent ?? '' }))
        .filter((o) => o.value !== 'custom')
    );
    expect(options.length).toBe(4);

    for (const option of options) {
      const claimed = /\((\d+) bits at n = (\d+)\)/.exec(option.label);
      expect(claimed, `preset "${option.value}" must state its bits and n`).not.toBeNull();
      const [, bits, n] = claimed as RegExpExecArray;

      await page.locator('#preset').selectOption(option.value);
      await expect(page.locator('#format-status-text')).toContainText('Compiled.');
      await expect(page.locator('#length')).toHaveValue(n);
      await expect(page.locator('#stat-capacity')).toHaveText(`${bits} bits`);
    }
  });

  test('capacity is floor(log2 N), re-derived from the N the page printed', async ({ page }) => {
    await boot(page);
    // The phone slice is 10^10 — eleven digits, so the page prints it exactly
    // rather than in scientific notation, and it can be parsed back.
    const printedN = await text(page, 'stat-total');
    expect(printedN).toMatch(/^\d+$/);
    const printedCapacity = await text(page, 'stat-capacity');
    expect(printedCapacity).toBe(`${floorLog2(BigInt(printedN))} bits`);
    // And the value itself is the closed form: ten free digits.
    expect(BigInt(printedN)).toBe(10n ** 10n);
  });

  test('the highlighted count-table row is the row the stat grid describes', async ({ page }) => {
    await boot(page);
    const chosen = page.locator('#counts-body tr.is-chosen');
    await expect(chosen).toHaveCount(1);
    const cells = await chosen.locator('td').allTextContents();
    // The marker glyph is generated content, so it is not in textContent.
    expect(cells[0].trim()).toBe(await page.inputValue('#length'));
    expect(cells[1].trim()).toBe(await text(page, 'stat-total'));
    expect(cells[2].trim()).toBe(await text(page, 'stat-capacity'));
  });

  test('the count table is C[q0][k] = 16^k for hex, checked in closed form', async ({ page }) => {
    await boot(page);
    await page.locator('#preset').selectOption('hex');
    await expect(page.locator('#format-status-text')).toContainText('Compiled.');

    const rows = await page.locator('#counts-body tr').evaluateAll((trs) =>
      trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim()))
    );
    // k = 0 … 20, since n = 32 is past the 20-row window and is appended.
    expect(rows.length).toBe(22);
    for (const row of rows) {
      const k = Number(row[0]);
      // [0-9a-f]{32} accepts nothing but length 32, so every other row is zero.
      const expected = k === 32 ? 16n ** 32n : 0n;
      expect(row[2], `capacity at k=${k}`).toBe(`${floorLog2(expected)} bits`);
    }
    // The last row is the chosen n = 32, and it is the only non-zero one.
    expect(rows[rows.length - 1][0]).toBe('32');
    expect(await text(page, 'stat-capacity')).toBe('128 bits');
  });

  test('the SVG draws one circle per state plus one per accepting state', async ({ page }) => {
    await boot(page);
    const rows = await page.locator('#dfa-table-body tr').evaluateAll((trs) =>
      trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim()))
    );
    const states = new Set<string>();
    const accepting = new Set<string>();
    for (const [from, , , to, isAccepting] of rows) {
      states.add(from);
      states.add(to);
      if (isAccepting === 'yes') accepting.add(to);
    }
    // The transition table and the stat grid are two different renderers over
    // the same DFA; the SVG is a third.
    expect(String(states.size)).toBe(await text(page, 'stat-states'));
    await expect(page.locator('#dfa-graph circle')).toHaveCount(states.size + accepting.size);
  });

  test('the display cap is applied to the state count the page itself reports', async ({
    page
  }) => {
    await boot(page);
    // The cap is 64 states. The base64 preset compiles to 65 — one over — so it
    // is counted, tabulated and encodable but deliberately not drawn, and the
    // page says which of those it did. That off-by-one is a real property of the
    // shipped presets, not an accident of this test, so it is pinned here.
    await page.locator('#preset').selectOption('base64');
    await expect(page.locator('#format-status-text')).toContainText('Compiled.');
    expect(await text(page, 'stat-states')).toBe('65');
    expect(await text(page, 'dfa-status-text')).toContain('DFA too large to display: 65 states');
    await expect(page.locator('#dfa-graph circle')).toHaveCount(0);
    await expect(page.locator('#dfa-engine')).toHaveText('Layout: not drawn');
    // Counted and tabulated all the same.
    expect(await text(page, 'stat-capacity')).toBe('384 bits');
    expect(await page.locator('#dfa-table-body tr').count()).toBeGreaterThan(0);

    // One state fewer and it draws, which is what makes the cap a cap rather
    // than a general failure to render.
    await page.fill('#pattern', '[A-Za-z0-9+/]{63}');
    await expect(page.locator('#preset')).toHaveValue('custom');
    expect(await text(page, 'stat-states')).toBe('64');
    await expect(page.locator('#dfa-graph circle')).toHaveCount(65); // 64 + one accepting ring
  });

  test('a pattern that stops compiling clears the drawing, not just the numbers', async ({
    page
  }) => {
    await boot(page);
    // Draw a real automaton first, so there is something to leave behind.
    await expect(page.locator('#dfa-graph circle')).toHaveCount(16);

    await page.fill('#pattern', '(ab');
    await expect(page.locator('#preset')).toHaveValue('custom');
    await expect(page.locator('#pattern')).toHaveAttribute('aria-invalid', 'true');

    // Every surface that described the old automaton must stop describing it.
    // Leaving the SVG drawn under a status line reading "No automaton" is the
    // same class of lie as a stale stego string, and it is what this catches.
    expect(await text(page, 'stat-states')).toBe('—');
    expect(await text(page, 'dfa-status-text')).toContain('No automaton');
    await expect(page.locator('#dfa-graph circle')).toHaveCount(0);
    await expect(page.locator('#dfa-graph path')).toHaveCount(0);
    await expect(page.locator('#dfa-engine')).toHaveText('Layout: —');
    // And the tables say why they are empty rather than being empty, which is
    // what keeps axe's th-has-data-cells satisfied.
    await expect(page.locator('#counts-body tr')).toHaveCount(1);
    await expect(page.locator('#dfa-table-body tr')).toHaveCount(1);
    expect(await text(page, 'counts-body')).toContain('No automaton yet');

    // Recompiling brings it back, so the clear is not a one-way door.
    await page.fill('#pattern', '[0-9a-f]{32}');
    await expect(page.locator('#format-status-text')).toContainText('Compiled.');
    await expect(page.locator('#dfa-graph circle')).toHaveCount(34); // 33 states + 1 accepting ring
  });

  test('nothing carries a hidden attribute while still being visible', async ({ page }) => {
    await boot(page);
    // The `[hidden]` probe: a CSS `display` declaration on an element the markup
    // hid resurrects it silently, and axe reports the resurrected rendering as
    // fine. This lab uses no `hidden` attribute today; the probe asserts that
    // stays true rather than assuming it.
    const resurrected = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[hidden]'))
        .filter((el) => (el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true }))
        .map((el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : ''))
    );
    expect(resurrected).toEqual([]);
  });
});

test.describe('the CDN scripts are an enhancement, not a dependency', () => {
  test('with jsDelivr blocked outright, the automaton still draws and the page says so', async ({
    page
  }) => {
    // The page head loads dagre and four d3-force modules under SHA-384
    // integrity. The README claims they are optional. This is that claim, run:
    // every request to the CDN host is aborted before navigation, so the page
    // gets exactly what an offline reader gets.
    await page.route('**://cdn.jsdelivr.net/**', (route) => route.abort());
    await boot(page);

    await expect(page.locator('#dfa-engine')).toHaveText('Layout: built-in');
    // 15 states plus the accepting state's inner ring — the same drawing the
    // dagre path produces, from the fallback layering.
    await expect(page.locator('#dfa-graph circle')).toHaveCount(16);
    expect(await text(page, 'dfa-status-text')).toContain('15 states');

    // And the cryptography, which never needed the network at all.
    await page.fill('#encode-passphrase', 'pw');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');
    expect(await text(page, 'encode-out')).toMatch(/^\(\d{3}\) \d{3}-\d{4}$/);
  });
});

test.describe('the encode path tells the truth', () => {
  test('the stego string is a member of the language, per the platform regex engine', async ({
    page
  }) => {
    await boot(page);
    await page.fill('#encode-passphrase', 'correct horse battery staple');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');
    await expect(page.locator('#encode-status-text')).toContainText('Encoded.');

    const pattern = await page.inputValue('#pattern');
    expect(pattern).toBe(PHONE);
    const stego = await text(page, 'encode-out');
    // RegExp knows nothing about this lab's DFA. Agreement is evidence.
    expect(new RegExp(`^(?:${pattern})$`).test(stego), `"${stego}" vs /${pattern}/`).toBe(true);
    expect(String(stego.length)).toBe(await page.inputValue('#length'));
  });

  test('the capacity bar figures are the message bytes and the printed capacity', async ({
    page
  }) => {
    await boot(page);
    const message = 'hey';
    await page.fill('#encode-message', message);
    const figures = await text(page, 'capacity-figures');
    const parsed = /^(\d+) used \/ (\d+) available$/.exec(figures);
    expect(parsed, figures).not.toBeNull();
    const [, used, available] = parsed as RegExpExecArray;
    // Re-derived: UTF-8 bytes plus the one frame byte, times eight.
    expect(Number(used)).toBe(8 * (new TextEncoder().encode(message).length + 1));
    expect(`${available} bits`).toBe(await text(page, 'stat-capacity'));
    await expect(page.locator('#capacity-track')).toHaveAttribute(
      'aria-valuetext',
      `${used} of ${available} bits used`
    );
  });

  test('the step trace quotes the same N the stat grid does, and lands inside it', async ({
    page
  }) => {
    await boot(page);
    await page.fill('#encode-passphrase', 'pw');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');

    await page.locator('#encode-trace > summary').click();
    const values = await page.locator('#trace-list .trace-value').allTextContents();
    expect(values.length).toBe(6);

    const slice = /^(\d+) \((\d+) bits of capacity\)$/.exec(values[3].trim());
    expect(slice, values[3]).not.toBeNull();
    const [, n, bits] = slice as RegExpExecArray;
    expect(n).toBe(await text(page, 'stat-total'));
    expect(`${bits} bits`).toBe(await text(page, 'stat-capacity'));

    // The FF1 output must be inside [0, N) — that is the entire point of the
    // cycle walk, and it is checked against the N printed on the line above.
    const ciphered = /^(\d+) after \d+ application/.exec(values[4].trim());
    expect(ciphered, values[4]).not.toBeNull();
    expect(BigInt((ciphered as RegExpExecArray)[1])).toBeLessThan(BigInt(n));
  });

  test('n grows to exactly the length the payload needs, and says so', async ({ page }) => {
    await boot(page);
    // The pattern input is debounced. Waiting on "Compiled." would pass
    // instantly against the PREVIOUS pattern's status; the preset select
    // flipping to "custom" is a signal only this recompile can produce.
    await page.fill('#pattern', '[0-9a-f]{1,512}');
    await expect(page.locator('#preset')).toHaveValue('custom');
    await expect(page.locator('#stat-states')).toHaveText('513');
    await page.fill('#length', '4');
    const message = 'a longer message';
    await page.fill('#encode-message', message);
    await page.fill('#encode-passphrase', 'pw');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');

    // Re-derived independently: each hex character carries exactly 4 bits, so a
    // payload of 8·(bytes+1) bits needs ceil(bits/4) characters.
    const payloadBits = 8 * (new TextEncoder().encode(message).length + 1);
    const expectedN = Math.ceil(payloadBits / 4);

    await expect(page.locator('#encode-status-text')).toContainText(
      `The message needed ${payloadBits} bits, so n grew from 4 to ${expectedN}.`
    );
    expect(await page.inputValue('#length')).toBe(String(expectedN));
    expect((await text(page, 'encode-out')).length).toBe(expectedN);
  });

  test('an over-capacity message is refused, and the refusal names the real ceiling', async ({
    page
  }) => {
    await boot(page);
    await page.fill('#encode-message', 'far too long to fit in ten decimal digits');
    await page.fill('#encode-passphrase', 'pw');
    await expect(page.locator('#capacity-fill')).toHaveClass(/is-over/);
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');

    const status = await text(page, 'encode-status-text');
    // The ceiling it names must be the one the stat grid shows at that n.
    expect(status).toContain('tops out at 33 bits');
    expect(await text(page, 'stat-capacity')).toBe('33 bits');
    // And nothing was produced.
    await expect(page.locator('#encode-out')).toHaveClass(/is-empty/);
  });
});

test.describe('the decode path tells the truth', () => {
  test('the round trip returns the exact message', async ({ page }) => {
    await boot(page);
    await page.locator('#preset').selectOption('base64');
    await expect(page.locator('#format-status-text')).toContainText('Compiled.');
    const message = 'Meet me where the DFA accepts. 集合';
    await page.fill('#encode-message', message);
    await page.fill('#encode-passphrase', 'pw');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');
    await expect(page.locator('#encode-status-text')).toContainText('Encoded.');

    await page.click('#decode-fill');
    await page.click('#decode-run');
    await settleStatus(page, 'decode-status');
    expect(await text(page, 'decode-out')).toBe(message);
  });

  test('the decode status quotes an index genuinely inside the printed N', async ({ page }) => {
    await boot(page);
    await page.fill('#encode-passphrase', 'pw');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');
    await page.click('#decode-fill');
    await page.click('#decode-run');
    await settleStatus(page, 'decode-status');

    const status = await text(page, 'decode-status-text');
    const parsed = /Ranked to index (\d+) of N = (\d+);/.exec(status);
    expect(parsed, status).not.toBeNull();
    const [, index, total] = parsed as RegExpExecArray;
    expect(total).toBe(await text(page, 'stat-total'));
    expect(BigInt(index)).toBeLessThan(BigInt(total));

    // Independent re-derivation of the rank: for this format the string
    // (abc) def-ghij ranks to the integer its ten digits spell.
    const stego = await text(page, 'encode-out');
    expect(BigInt(stego.replace(/\D/g, ''))).toBe(BigInt(index));
  });

  test('each failure path fails, and the page names the actual cause', async ({ page }) => {
    await boot(page);
    // Run the wording assertions on BASE64, not on the phone preset, and the
    // reason is the No authentication limitation itself. A wrong key lands
    // uniformly in [0, N); the decoder accepts if the minimal big-endian
    // encoding starts with 0x01. For the phone slice (N = 10^10) that is ~43%,
    // and the strict UTF-8 decode behind it catches most but not all of those,
    // so roughly one wrong key in thirty "succeeds" with four bytes of garbage
    // — which made an earlier version of this test flaky about 3% of runs.
    // For base64 the frame byte passes 1/255 and the UTF-8 check then has to
    // accept ~47 uniform random bytes, so a false accept is a ~2^-40 event and
    // the failure wording is deterministic in practice.
    await page.locator('#preset').selectOption('base64');
    await expect(page.locator('#format-status-text')).toContainText('Compiled.');
    await page.fill('#encode-passphrase', 'right');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');
    await page.click('#decode-fill');

    await page.fill('#decode-passphrase', 'wrong');
    await page.click('#decode-run');
    await settleStatus(page, 'decode-status');
    // Either of the two rejection points is correct — the frame byte or the
    // UTF-8 decode — but the page must name which of the three inputs could be
    // wrong rather than blaming something else.
    expect(await text(page, 'decode-status-text')).toMatch(
      /The passphrase, the salt, or the pattern|The passphrase or the salt does not match/
    );
    await expect(page.locator('#decode-out')).toHaveClass(/is-empty/);

    await page.fill('#decode-passphrase', 'right');
    await page.fill('#decode-salt', '00'.repeat(16));
    await page.click('#decode-run');
    await settleStatus(page, 'decode-status');
    expect(await text(page, 'decode-status-text')).toContain('Decode failed');
    await expect(page.locator('#decode-out')).toHaveClass(/is-empty/);

    // These three are deterministic on any format: they fail before any key is
    // derived, on the shape of the input rather than on its value.
    await page.fill('#decode-salt', 'not-hex');
    await page.click('#decode-run');
    await expect(page.locator('#decode-salt')).toHaveAttribute('aria-invalid', 'true');
    expect(await text(page, 'decode-status-text')).toContain('Hex must contain');

    await page.fill('#decode-salt', '00'.repeat(8));
    await page.click('#decode-run');
    expect(await text(page, 'decode-status-text')).toContain('exactly 32 hex characters');

    // A string that is not in the language at all, at a length the format does
    // accept — so it is the RANKING that rejects it, not a length check.
    await page.fill('#decode-salt', '00'.repeat(16));
    await page.fill('#decode-stego', '!'.repeat(64));
    await page.click('#decode-run');
    await settleStatus(page, 'decode-status');
    expect(await text(page, 'decode-status-text')).toContain('not accepted here by this pattern');

    // And a string of a length the format cannot produce at all.
    await page.fill('#decode-stego', 'AAAA');
    await page.click('#decode-run');
    await settleStatus(page, 'decode-status');
    expect(await text(page, 'decode-status-text')).toContain('accepts no string of length 4');
  });

  test('a wrong key never returns the real message, even when it is not rejected', async ({
    page
  }) => {
    // The deterministic half of the previous test, on the format where the
    // frame byte is weakest. This is the property that actually holds for every
    // wrong key: confidentiality. Whether the wrong key is REJECTED is a
    // property of the domain size; whether it can recover the plaintext is a
    // property of AES.
    await boot(page);
    await page.fill('#encode-message', 'hi');
    await page.fill('#encode-passphrase', 'right');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');
    await page.click('#decode-fill');

    for (const passphrase of ['wrong-a', 'wrong-b', 'wrong-c']) {
      await page.fill('#decode-passphrase', passphrase);
      await page.click('#decode-run');
      await settleStatus(page, 'decode-status');
      // It may fail, or it may print garbage. It may never print "hi".
      expect(await text(page, 'decode-out'), `passphrase ${passphrase}`).not.toBe('hi');
    }

    // And the correct passphrase still works afterwards, so the loop above did
    // not simply break the panel.
    await page.fill('#decode-passphrase', 'right');
    await page.click('#decode-run');
    await settleStatus(page, 'decode-status');
    expect(await text(page, 'decode-out')).toBe('hi');
  });
});

test.describe('stale results are retired, and only when they are stale', () => {
  test('changing the format retires the stego string and says so', async ({ page }) => {
    await boot(page);
    await page.fill('#encode-passphrase', 'pw');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');
    await expect(page.locator('#encode-out')).not.toHaveClass(/is-empty/);

    await page.locator('#preset').selectOption('hex');
    await expect(page.locator('#encode-out')).toHaveClass(/is-empty/);
    expect(await text(page, 'encode-status-text')).toContain('Retired the previous stego string');
    await expect(page.locator('#encode-copy')).toBeDisabled();
    await expect(page.locator('#decode-fill')).toBeDisabled();
  });

  test('changing n alone also retires it', async ({ page }) => {
    await boot(page);
    await page.fill('#pattern', '[0-9a-f]{1,64}');
    await expect(page.locator('#preset')).toHaveValue('custom');
    await expect(page.locator('#stat-states')).toHaveText('65');
    await page.fill('#length', '32');
    await page.fill('#encode-passphrase', 'pw');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');
    await expect(page.locator('#encode-out')).not.toHaveClass(/is-empty/);

    await page.fill('#length', '33');
    await expect(page.locator('#encode-out')).toHaveClass(/is-empty/);
    expect(await text(page, 'encode-status-text')).toContain('Retired');
  });

  test('no-op guard: re-selecting the SAME preset must not retire a fresh result', async ({
    page
  }) => {
    await boot(page);
    await page.fill('#encode-passphrase', 'pw');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');
    const stego = await text(page, 'encode-out');
    expect(stego).not.toContain('Nothing encoded');

    await page.locator('#preset').selectOption('phone');
    await page.fill('#length', await page.inputValue('#length'));
    expect(await text(page, 'encode-out')).toBe(stego);
    expect(await text(page, 'encode-status-text')).toContain('Encoded.');
    await expect(page.locator('#encode-copy')).toBeEnabled();
  });

  test('the n the encoder grew into is not treated as a change', async ({ page }) => {
    await boot(page);
    await page.fill('#pattern', '[0-9a-f]{1,512}');
    await expect(page.locator('#preset')).toHaveValue('custom');
    await expect(page.locator('#stat-states')).toHaveText('513');
    await page.fill('#length', '4');
    await page.fill('#encode-message', 'grow me');
    await page.fill('#encode-passphrase', 'pw');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');
    // The encoder moved n itself; the result must survive its own move.
    expect(await text(page, 'encode-status-text')).toContain('so n grew from 4 to');
    await expect(page.locator('#encode-out')).not.toHaveClass(/is-empty/);
    await expect(page.locator('#decode-fill')).toBeEnabled();
  });
});
