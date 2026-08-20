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

/**
 * The adversary panel is the one place the page makes a claim about a THIRD
 * party — what a middlebox would do. So the oracle is the platform regex
 * engine, run over the payloads the page printed, never the page's own verdict
 * column read back to itself.
 */
test.describe('the classifier tells the truth about the adversary', () => {
  test('the verdicts match what the platform regex engine says about the printed payloads', async ({
    page
  }) => {
    await boot(page);
    await page.fill('#encode-passphrase', 'correct horse battery staple');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');
    await expect(page.locator('#classifier-status-text')).not.toContainText('Encode a message first');

    const rule = await page.inputValue('#classifier-pattern');
    expect(rule).toBe(PHONE);

    const rows = await page.locator('#classifier-body tr').evaluateAll((trs) =>
      trs.map((tr) => ({
        label: (tr.children[0].textContent ?? '').trim(),
        payload: (tr.children[1].textContent ?? '').trim(),
        verdict: (tr.children[2].textContent ?? '').trim()
      }))
    );
    expect(rows).toHaveLength(3);

    const anchored = new RegExp(`^(?:${rule})$`);
    for (const row of rows) {
      // The payload cell abbreviates long values; only judge the ones printed
      // in full, which is exactly the stego string — the row that matters.
      if (row.payload.includes('…')) continue;
      const expected = anchored.test(row.payload) ? 'PASS' : 'FLAGGED';
      expect(row.verdict, `${row.label}: "${row.payload}"`).toContain(expected);
    }
  });

  test('the stego string passes the same rule the raw ciphertext fails', async ({ page }) => {
    await boot(page);
    await page.fill('#encode-passphrase', 'correct horse battery staple');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');

    const verdicts = await page.locator('#classifier-body tr').evaluateAll((trs) =>
      trs.map((tr) => ({
        label: (tr.children[0].textContent ?? '').trim(),
        verdict: (tr.children[2].textContent ?? '').trim()
      }))
    );
    const stego = verdicts.find((v) => v.label.includes('stego'));
    const raw = verdicts.filter((v) => !v.label.includes('stego'));
    expect(stego?.verdict).toContain('PASS');
    expect(raw).toHaveLength(2);
    for (const row of raw) expect(row.verdict, row.label).toContain('FLAGGED');
    await expect(page.locator('#classifier-summary')).toContainText('entire product');
  });

  /**
   * The honest half. A rule the format is NOT contained in must flag the stego
   * string, and the page must say so rather than keeping its triumphant copy.
   */
  test('a rule sharper than the format flags the stego string, and the page admits it', async ({
    page
  }) => {
    await boot(page);
    await page.fill('#encode-passphrase', 'correct horse battery staple');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');

    const stego = await text(page, 'encode-out');
    const area = stego.slice(1, 4);
    // A rule accepting every area code EXCEPT the one that was produced.
    const sharper = `\\((?!${area})\\d{3}\\) \\d{3}-\\d{4}`;
    await page.fill('#classifier-pattern', sharper);
    await page.click('#classifier-run');

    const verdict = await page.locator('#classifier-body tr').first().evaluate(
      (tr) => (tr.children[2].textContent ?? '').trim()
    );
    expect(verdict).toContain('FLAGGED');
    await expect(page.locator('#classifier-summary')).toContainText('honest limit');
  });

  test('resetting restores the format regex and the textbook result', async ({ page }) => {
    await boot(page);
    await page.fill('#encode-passphrase', 'correct horse battery staple');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');

    await page.fill('#classifier-pattern', '\\d{4}');
    await page.click('#classifier-run');
    await page.click('#classifier-reset');
    expect(await page.inputValue('#classifier-pattern')).toBe(PHONE);
    await expect(page.locator('#classifier-status-text')).toContainText('both raw encodings dropped');
  });
});

test.describe('the pipeline and the cycle walk quote the encode they came from', () => {
  test('every pipeline node carries a value the trace also reports', async ({ page }) => {
    await boot(page);
    await page.fill('#encode-passphrase', 'correct horse battery staple');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');

    const stego = await text(page, 'encode-out');
    expect(await text(page, 'pipe-stego-value')).toBe(stego);
    // N on the pipeline is the N the stat grid prints.
    expect(await text(page, 'pipe-domain-value')).toContain(await text(page, 'stat-total'));
    expect(await text(page, 'pipe-message-value')).toContain('UTF-8 byte');
    for (const id of ['pipe-cipher-value', 'pipe-integer-value', 'pipe-ff1-value']) {
      expect(await text(page, id), id).not.toBe('—');
    }
  });

  test('the walk draws exactly as many landings as the status line counts', async ({ page }) => {
    await boot(page);
    await page.fill('#encode-passphrase', 'correct horse battery staple');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');

    const status = await text(page, 'encode-status-text');
    const claimed = /took (\d+) FF1 application/.exec(status);
    // n did not grow for this message, so the walk sentence is present.
    expect(claimed, status).not.toBeNull();
    const steps = Number(claimed![1]);

    const dots = await page.locator('#walk-svg .walk-dot').count();
    expect(dots).toBe(steps);
    // Exactly one landing is inside [0, N) — the last one. That is what
    // terminating the walk MEANS, and it is drawn, not asserted.
    expect(await page.locator('#walk-svg .walk-dot.is-in').count()).toBe(1);
    expect(await page.locator('#walk-svg .walk-dot.is-out').count()).toBe(steps - 1);
    await expect(page.locator('#walk-readout')).toContainText('FF1 application');
  });
});

test.describe('the highlighted path is the path the string actually walks', () => {
  test('the scrubber spans the string, and each step names a real transition', async ({ page }) => {
    await boot(page);
    await page.fill('#encode-passphrase', 'correct horse battery staple');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');

    const stego = await text(page, 'encode-out');
    expect(await page.getAttribute('#pathwalk-scrub', 'max')).toBe(String(stego.length));
    expect(await page.locator('#pathwalk-string .pathchar').count()).toBe(stego.length);

    // Every (from, class) → to the readout claims must appear in the page's own
    // transition table, which is built from the DFA by a different code path.
    await page.click('#dfa-table-details > summary');
    const table = await page.locator('#dfa-table-body tr').evaluateAll((trs) =>
      trs.map((tr) => `${(tr.children[0].textContent ?? '').trim()}->${(tr.children[3].textContent ?? '').trim()}`)
    );

    for (let i = 1; i <= stego.length; i += 1) {
      await page.fill('#pathwalk-scrub', String(i));
      await page.dispatchEvent('#pathwalk-scrub', 'input');
      const readout = await text(page, 'pathwalk-readout');
      const move = /q(\d+) → q(\d+)/.exec(readout);
      expect(move, readout).not.toBeNull();
      expect(table, readout).toContain(`q${move![1]}->q${move![2]}`);
    }
    // The last character must land somewhere the page calls accepting.
    await expect(page.locator('#pathwalk-readout')).toContainText('accepting state');
  });

  test('the highlight marks exactly one current state, and only states on the path', async ({
    page
  }) => {
    await boot(page);
    await page.fill('#encode-passphrase', 'correct horse battery staple');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');

    expect(await page.locator('#dfa-graph .dfa-node.is-current').count()).toBe(1);
    const onPath = await page.locator('#dfa-graph .dfa-node.is-on-path').count();
    const total = await page.locator('#dfa-graph .dfa-node').count();
    expect(onPath).toBeGreaterThan(0);
    expect(onPath).toBeLessThanOrEqual(total);

    await page.fill('#pathwalk-scrub', '0');
    await page.dispatchEvent('#pathwalk-scrub', 'input');
    await expect(page.locator('#pathwalk-readout')).toContainText('start state');
    expect(await page.locator('#dfa-graph .dfa-node.is-current').count()).toBe(1);
  });
});

test.describe('the in-page NIST vectors are the ones the test suite runs', () => {
  test('nine rows, none failing, and the unsupported ones say why', async ({ page }) => {
    await boot(page);
    await page.click('#vectors-details > summary');
    await page.click('#vectors-run');
    await settleStatus(page, 'vectors-status');

    const rows = await page.locator('#vectors-body tr').evaluateAll((trs) =>
      trs.map((tr) => ({
        name: (tr.children[0].textContent ?? '').trim(),
        key: (tr.children[1].textContent ?? '').trim(),
        expected: (tr.children[3].textContent ?? '').trim(),
        actual: (tr.children[4].textContent ?? '').trim(),
        result: (tr.children[5].textContent ?? '').trim()
      }))
    );
    expect(rows).toHaveLength(9);
    expect(rows.filter((r) => r.result === 'FAIL')).toEqual([]);

    for (const row of rows) {
      if (row.result === 'PASS') {
        // The page printed both; they must agree. This is the whole point of
        // showing "NIST says" beside "this page produced".
        expect(row.actual, row.name).toBe(row.expected);
      } else {
        expect(row.result, row.name).toBe('UNSUPPORTED');
        expect(row.key, row.name).toContain('AES-192');
      }
    }
    // Chromium has no AES-192, so exactly the three AES-192 samples sit out.
    expect(rows.filter((r) => r.result === 'UNSUPPORTED')).toHaveLength(3);
    await expect(page.locator('#vectors-status-text')).toContainText('6 of 9');
  });
});

test.describe('spot the fake deals real unrankings', () => {
  test('every candidate is a member of the language the page compiled', async ({ page }) => {
    await boot(page);
    await page.click('#game-deal');

    const values = await page.locator('#game-list label').evaluateAll((els) =>
      els.map((el) => (el.textContent ?? '').trim())
    );
    expect(values.length).toBeGreaterThan(0);

    const pattern = await page.inputValue('#pattern');
    const anchored = new RegExp(`^(?:${pattern})$`);
    for (const value of values) {
      // Generated AND realistic candidates must both match — a decoy the regex
      // rejects would be a giveaway that has nothing to do with realism.
      expect(anchored.test(value), `"${value}" vs /${pattern}/`).toBe(true);
    }
    expect(new Set(values).size).toBe(values.length);
  });

  test('the reveal scores against the truth and names a tell for every candidate', async ({
    page
  }) => {
    await boot(page);
    await page.click('#game-deal');
    const count = await page.locator('#game-list .game-item').count();
    await page.click('#game-reveal');

    const status = await text(page, 'game-status-text');
    const score = /^(\d+) of (\d+) correct\./.exec(status);
    expect(score, status).not.toBeNull();
    expect(Number(score![2])).toBe(count);
    // Ticking nothing means every realistic one is right and every generated
    // one is missed, so the score is exactly the realistic count.
    expect(Number(score![1])).toBeLessThan(count);

    const tells = await page.locator('#game-list .game-tell').evaluateAll((els) =>
      els.map((el) => (el.textContent ?? '').trim())
    );
    expect(tells.filter((t) => t.length === 0)).toEqual([]);
    expect(await page.locator('#game-list .game-item.is-generated').count()).toBeGreaterThan(0);
    expect(await page.locator('#game-list .game-item.is-real').count()).toBeGreaterThan(0);
  });

  test('the game declines to invent a corpus for hex, and says why', async ({ page }) => {
    await boot(page);
    await page.selectOption('#preset', 'hex');
    await expect(page.locator('#format-status-text')).toContainText('Compiled.');
    await page.click('#game-deal');
    await expect(page.locator('#game-status-text')).toContainText('no such thing as a realistic random hex');
    expect(await page.locator('#game-list .game-item').count()).toBe(0);
  });
});

test.describe('the shareable link carries state and never carries secrets', () => {
  test('the fragment restores pattern, n and message in a fresh page', async ({ page }) => {
    await boot(page);
    await page.selectOption('#preset', 'hex');
    await expect(page.locator('#format-status-text')).toContainText('Compiled.');
    await page.fill('#encode-message', 'shared');
    await page.click('#share-copy');

    const hash = await page.evaluate(() => window.location.hash);
    expect(hash.length).toBeGreaterThan(1);

    const fresh = await page.context().newPage();
    await fresh.goto(`.${hash}`);
    await expect(fresh.locator('#format-status-text')).toContainText('Compiled.');
    expect(await fresh.inputValue('#pattern')).toBe('[0-9a-f]{32}');
    expect(await fresh.inputValue('#encode-message')).toBe('shared');
    expect(await fresh.inputValue('#length')).toBe('32');
    await fresh.close();
  });

  test('a real passphrase and the salt are provably absent from the URL', async ({ page }) => {
    await boot(page);
    const passphrase = 'zebra-canyon-quartz-77';
    await page.fill('#encode-passphrase', passphrase);
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');
    await page.click('#share-copy');

    const href = await page.evaluate(() => window.location.href);
    const decoded = decodeURIComponent(href).toLowerCase();
    expect(decoded).not.toContain(passphrase.toLowerCase());

    const bundle = await text(page, 'encode-bundle');
    const salt = /salt\s+([0-9a-f]{32})/.exec(bundle);
    expect(salt, bundle).not.toBeNull();
    expect(decoded).not.toContain(salt![1].toLowerCase());
  });

  /**
   * Note what is NOT asserted here: that a weird pattern is rejected. `%%%%` is
   * a perfectly good regular expression matching four literal percent signs,
   * and restoring it is the share feature working, not failing. What must hold
   * is that the fields the page derives numbers from cannot be poisoned.
   */
  test('out-of-range and unknown fragment fields are ignored, not applied', async ({ page }) => {
    await page.goto('.#n=-5&step=999&passphrase=hunter2&__proto__=polluted');
    await expect(page.locator('#format-status-text')).toContainText('Compiled.');
    // The defaults survived: neither the negative n nor the absent pattern took.
    expect(await page.inputValue('#pattern')).toBe(PHONE);
    expect(await page.inputValue('#length')).toBe('14');
    // A step past the end of the path does not open the path.
    await expect(page.locator('#tour-panel')).toBeHidden();
    // Nothing was written onto Object.prototype.
    expect(await page.evaluate(() => ({} as Record<string, unknown>).polluted)).toBeUndefined();
    // And a passphrase in the fragment is not adopted as one.
    expect(await page.inputValue('#encode-passphrase')).toBe('');
  });

  test('a fragment carrying an uncompilable pattern fails visibly and stays usable', async ({
    page
  }) => {
    await page.goto('.#pattern=%28unclosed');
    await expect(page.locator('#pattern')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#encode-run')).toBeDisabled();
    await expect(page.locator('#tour-panel')).toBeHidden();

    // Still a working lab: pick a preset and it recovers.
    await page.selectOption('#preset', 'phone');
    await expect(page.locator('#format-status-text')).toContainText('Compiled.');
    await expect(page.locator('#encode-run')).toBeEnabled();
  });
});

test.describe('the guided path ends where it should', () => {
  test('seven steps, and the last one is the honest limitations', async ({ page }) => {
    await boot(page);
    await page.click('#tour-start');
    await expect(page.locator('#tour-panel')).toBeVisible();
    expect(await text(page, 'tour-total')).toBe('7');

    for (let step = 1; step < 7; step += 1) {
      expect(await text(page, 'tour-index')).toBe(String(step));
      await page.click('#tour-next');
    }
    expect(await text(page, 'tour-index')).toBe('7');
    await expect(page.locator('#tour-body')).toContainText('Spot the fake');
    await expect(page.locator('#tour-title')).toContainText('honest');

    // Finishing closes the path rather than wrapping round to step one.
    await page.click('#tour-next');
    await expect(page.locator('#tour-panel')).toBeHidden();
  });
});

test.describe('the hero encoder cannot disagree with the panel below it', () => {
  test('one encode, one stego string, shown in both places', async ({ page }) => {
    await boot(page);
    await page.fill('#quick-message', 'hi');
    await page.fill('#quick-passphrase', 'correct horse battery staple');
    await page.click('#quick-run');
    await settleStatus(page, 'quick-status');

    const hero = await text(page, 'quick-out');
    const panel = await text(page, 'encode-out');
    expect(hero).toBe(panel);
    expect(await page.inputValue('#encode-message')).toBe('hi');

    const pattern = await page.inputValue('#pattern');
    expect(new RegExp(`^(?:${pattern})$`).test(hero), hero).toBe(true);
  });
});

/**
 * The two limitations that used to be prose. Both panels make a claim about
 * what an adversary can do, so both are checked against something other than
 * their own output: the ladder against closed-form arithmetic, the substitution
 * against the frame byte's independently-computed false-accept rate.
 */
test.describe('length leakage is shown, not just asserted', () => {
  test('a fixed-length preset is one bucket, and the page says it leaks nothing', async ({
    page
  }) => {
    await boot(page);
    await expect(page.locator('#leak-readout')).toContainText('leaks nothing about the message size');

    const wire = await page.locator('#leak-body tr').evaluateAll((trs) =>
      trs
        .map((tr) => (tr.children[3].textContent ?? '').trim())
        .filter((t) => t !== '—')
    );
    // Every message that fits comes out at exactly n = 14 characters.
    expect(new Set(wire).size).toBe(1);
    expect(wire[0]).toBe('14 characters');
  });

  test('a variable-length pattern separates every size, and the ladder matches closed form', async ({
    page
  }) => {
    await boot(page);
    await page.fill('#pattern', '[0-9a-f]{1,64}');
    await expect(page.locator('#format-status-text')).toContainText('Compiled.');
    await expect(page.locator('#leak-readout')).toContainText('distinct wire lengths');

    const rows = await page.locator('#leak-body tr').evaluateAll((trs) =>
      trs.map((tr) => ({
        bytes: Number((tr.children[0].textContent ?? '').trim()),
        bits: Number((tr.children[1].textContent ?? '').trim()),
        n: (tr.children[2].textContent ?? '').trim()
      }))
    );
    for (const row of rows) {
      // Independent oracle: payload is 8(b+1) bits, a hex character carries 4,
      // so the smallest n is 2(b+1). The page never computes it that way.
      expect(row.bits).toBe(8 * (row.bytes + 1));
      expect(row.n).toBe(String(2 * (row.bytes + 1)));
    }
  });

  test('the chosen n is highlighted in the ladder, as it is in the count table', async ({
    page
  }) => {
    await boot(page);
    const highlighted = await page.locator('#leak-body tr.is-chosen').count();
    expect(highlighted).toBeGreaterThan(0);
  });
});

test.describe('the substitution attack runs for real', () => {
  test('no substitution ever returns the message that was sent', async ({ page }) => {
    await boot(page);
    await page.fill('#encode-message', 'hi');
    await page.fill('#encode-passphrase', 'correct horse battery staple');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');
    await page.click('#swap-run');
    await settleStatus(page, 'swap-status');

    await expect(page.locator('#swap-status-text')).toContainText('None returned your message');
    const handed = await page.locator('#swap-body tr').evaluateAll((trs) =>
      trs.map((tr) => (tr.children[2]?.textContent ?? '').trim())
    );
    // The receiver may be handed garbage; it is never handed "hi".
    for (const value of handed) expect(value).not.toBe('"hi"');
  });

  test('every substituted string is a genuine member of the language', async ({ page }) => {
    await boot(page);
    await page.fill('#encode-passphrase', 'correct horse battery staple');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');
    const original = await text(page, 'encode-out');
    await page.click('#swap-run');
    await settleStatus(page, 'swap-status');

    const pattern = await page.inputValue('#pattern');
    const anchored = new RegExp(`^(?:${pattern})$`);
    const swapped = await page.locator('#swap-body tr th[scope="row"]').evaluateAll((ths) =>
      ths.map((th) => (th.textContent ?? '').trim())
    );
    expect(swapped.length).toBeGreaterThan(0);
    for (const value of swapped) {
      expect(anchored.test(value), `"${value}" vs /${pattern}/`).toBe(true);
      // Substituting the original is a no-op, not an attack.
      expect(value).not.toBe(original);
    }
  });

  test('the three outcomes partition the run, and the totals agree', async ({ page }) => {
    await boot(page);
    await page.fill('#encode-passphrase', 'correct horse battery staple');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');
    await page.click('#swap-run');
    await settleStatus(page, 'swap-status');

    const read = async (id: string): Promise<[number, number]> => {
      const parsed = /^(\d+) of (\d+)$/.exec(await text(page, id));
      expect(parsed, id).not.toBeNull();
      return [Number(parsed![1]), Number(parsed![2])];
    };
    const [frame, total] = await read('swap-frame');
    const [utf8] = await read('swap-utf8');
    const [accepted] = await read('swap-accepted');
    expect(frame + utf8 + accepted).toBe(total);
    expect(total).toBe(60);
  });

  /**
   * The cross-check that makes the panel evidence rather than theatre: the
   * share of substitutions getting past the frame byte, MEASURED by running the
   * cipher, against the closed form that only counts intervals of [0, N).
   */
  test('the measured pass-the-frame rate tracks the closed-form prediction it prints', async ({
    page
  }) => {
    await boot(page);
    await page.fill('#encode-passphrase', 'correct horse battery staple');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');
    await page.click('#swap-run');
    await settleStatus(page, 'swap-status');

    const rate = await text(page, 'swap-rate');
    const parsed = /^(\d+)% vs ([\d.]+)%$/.exec(rate);
    expect(parsed, rate).not.toBeNull();
    const measured = Number(parsed![1]);
    const predicted = Number(parsed![2]);

    // The phone slice's closed form is ~43.1%, and the folklore 1/256 is not.
    expect(predicted).toBeGreaterThan(42);
    expect(predicted).toBeLessThan(44);
    // 60 Bernoulli trials at p = 0.43 have a standard error near 6.4 points.
    expect(Math.abs(measured - predicted)).toBeLessThan(20);

    // And the figures in the table agree with that percentage.
    const utf8 = /^(\d+) of (\d+)$/.exec(await text(page, 'swap-utf8'))!;
    const accepted = /^(\d+) of (\d+)$/.exec(await text(page, 'swap-accepted'))!;
    const pastFrame = Number(utf8[1]) + Number(accepted[1]);
    expect(Math.round((pastFrame / Number(utf8[2])) * 100)).toBe(measured);
  });

  test('changing the format retires the attack along with the stego string', async ({ page }) => {
    await boot(page);
    await page.fill('#encode-passphrase', 'correct horse battery staple');
    await page.click('#encode-run');
    await settleStatus(page, 'encode-status');
    await page.click('#swap-run');
    await settleStatus(page, 'swap-status');
    await expect(page.locator('#swap-accepted')).not.toHaveText('—');

    await page.selectOption('#preset', 'hex');
    await expect(page.locator('#format-status-text')).toContainText('Compiled.');
    await expect(page.locator('#swap-accepted')).toHaveText('—');
    await expect(page.locator('#swap-verdict')).toContainText('Nothing substituted yet');
  });
});
