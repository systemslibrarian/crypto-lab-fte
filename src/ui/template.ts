/**
 * The page, as static markup. Everything that changes is filled in by
 * `controller.ts`; nothing here is generated from data, so the structure a
 * screen reader meets on arrival is the structure it keeps.
 */

export const FORMAT_WARD_URL = "https://systemslibrarian.github.io/crypto-lab-format-ward/";

export interface Preset {
  id: string;
  label: string;
  pattern: string;
  /** The n this preset is naturally read at. */
  n: number;
  /** Shown in the option label; the page cross-checks it against the DFA. */
  bits: number;
  note: string;
}

/**
 * The four shipped presets. `bits` is the capacity the counting DP computes at
 * `n` — asserted against the live figure by `e2e/claims.spec.ts`, so a label
 * that drifts from the mathematics fails the build rather than misleading a
 * reader.
 */
export const PRESETS: Preset[] = [
  {
    id: "phone",
    label: "Phone number",
    pattern: "\\(\\d{3}\\) \\d{3}-\\d{4}",
    n: 14,
    bits: 33,
    note: "Ten free digits, so the slice holds 10^10 strings — 33 whole bits. Four bytes of message plus the frame byte already overflow it."
  },
  {
    id: "ipv4",
    label: "IPv4 dotted quad",
    pattern: "\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}",
    n: 15,
    bits: 39,
    note: "At n = 15 the slice is exactly the zero-padded quads (192.168.001.001), because that is the only shape 15 characters can take. Shorter n gives a different, smaller slice — one of the ways a fixed length narrows a format."
  },
  {
    id: "base64",
    label: "Base64 block",
    pattern: "[A-Za-z0-9+/]{64}",
    n: 64,
    bits: 384,
    note: "64 symbols per character, 64 characters: 2^384. The roomiest preset here, and the one that looks least like anything a person wrote."
  },
  {
    id: "hex",
    label: "Hex string",
    pattern: "[0-9a-f]{32}",
    n: 32,
    bits: 128,
    note: "Exactly 128 bits — the size of an MD5 digest, a UUID, or an AES block, which is what makes it plausible in a log line."
  }
];

export function template(): string {
  const presetOptions = PRESETS.map(
    (p) =>
      `<option value="${p.id}">${p.label} — ${p.pattern.replace(/&/g, "&amp;").replace(/</g, "&lt;")} (${p.bits} bits at n = ${p.n})</option>`
  ).join("\n            ");

  return `
    <main id="main-content" class="shell" tabindex="-1">
      <header class="cl-hero">
        <div class="cl-hero-main">
          <h1 class="cl-hero-title">Format-Transforming Encryption</h1>
          <p class="cl-hero-sub">FTE · regex-ranked steganography · FF1 (NIST SP 800-38G)</p>
        </div>
      </header>

      <section class="panel quickstart" aria-labelledby="quick-heading">
        <span class="panel-kicker">TRY IT NOW</span>
        <h2 id="quick-heading">Hide a message in a phone number</h2>
        <p class="quick-lede">
          Type something short, pick a passphrase, press the button. What comes back is real
          AES-CTR ciphertext wearing a phone number, and the rule below it is the kind a DPI
          middlebox runs.
        </p>

        <div class="quick-grid">
          <div class="field">
            <label for="quick-message">Message</label>
            <input id="quick-message" type="text" spellcheck="false" autocomplete="off" />
          </div>
          <div class="field">
            <label for="quick-passphrase">Passphrase</label>
            <input id="quick-passphrase" type="password" autocomplete="new-password" />
          </div>
          <div class="field quick-action">
            <button id="quick-run" type="button" class="primary">Encode</button>
          </div>
        </div>

        <output id="quick-out" class="quick-out is-empty" for="quick-run quick-message">Nothing encoded yet.</output>

        <p class="status" id="quick-status" role="status" aria-live="polite">
          <span class="status-icon" aria-hidden="true">·</span><span id="quick-status-text">Ready.</span>
        </p>

        <p class="quick-more">
          <a href="#format-heading" id="quick-jump">See how this works &mdash; the regex, the automaton and the arithmetic</a>
        </p>
      </section>

      <div class="cl-hero-context">
        <p class="cl-hero-desc">
          Compile a regular expression to a minimal DFA, count its length-n language exactly, and
          encipher real AES-CTR ciphertext into that count — so the output is a uniformly random
          member of the language, and a regex classifier watching the wire sees a phone number.
        </p>
        <aside class="cl-hero-why" aria-label="Why it matters">
          <span class="cl-hero-why-label">WHY IT MATTERS</span>
          <p class="cl-hero-why-text">
            Censorship systems and DPI middleboxes classify traffic by what it looks like. FTE was
            built to answer that: it makes ciphertext satisfy the classifier's own regex, exactly and
            provably, without weakening the cipher underneath.
          </p>
        </aside>
      </div>

      <div class="chip-row" role="list" aria-label="Primitives used">
        <span class="chip primary" role="listitem">Format-Transforming Encryption</span>
        <span class="chip" role="listitem">Rank-then-encipher</span>
        <span class="chip" role="listitem">FF1</span>
        <span class="chip" role="listitem">AES-CTR</span>
        <span class="chip" role="listitem">PBKDF2-SHA256</span>
        <span class="chip" role="listitem">DFA minimization</span>
      </div>

      <div class="labbar">
        <div class="labbar-actions">
          <button id="tour-start" type="button">Start the guided path</button>
          <button id="share-copy" type="button">Copy link to this state</button>
        </div>
        <p class="status labbar-status" id="labbar-status" role="status" aria-live="polite">
          <span class="status-icon" aria-hidden="true">·</span><span id="labbar-status-text">Seven steps, or wander freely &mdash; the link never carries your passphrase.</span>
        </p>
      </div>

      <section class="panel tour" id="tour-panel" aria-labelledby="tour-heading" hidden>
        <span class="panel-kicker">GUIDED PATH</span>
        <h2 id="tour-heading">Step <span id="tour-index">1</span> of <span id="tour-total">7</span>: <span id="tour-title">&mdash;</span></h2>
        <p id="tour-body">&mdash;</p>
        <div class="button-row">
          <button id="tour-prev" type="button">Previous</button>
          <button id="tour-next" type="button" class="primary">Next step</button>
          <button id="tour-end" type="button">End the path</button>
        </div>
      </section>

      <section class="panel" aria-labelledby="intro-heading">
        <span class="panel-kicker">START HERE</span>
        <h2 id="intro-heading">What this actually does</h2>
        <p>
          Ordinary encryption turns a message into bytes that look like nothing. That is usually the
          point — and occasionally the problem, because "looks like nothing" is itself a signature. A
          firewall that drops everything it cannot classify, or a log pipeline that only accepts
          well-formed records, will reject high-entropy noise on sight.
        </p>
        <p>
          Format-Transforming Encryption fixes the shape without touching the security. You give it a
          <strong>regular expression</strong>. It compiles that expression into an automaton, counts
          <em>exactly</em> how many strings of length n the expression accepts — call it N — and
          numbers them 0 to N-1 in strict alphabetical order. Encrypting a message now means: encrypt
          normally, read the ciphertext as one big number, encipher that number into the range
          [0, N), and look up the string with that number. The result is a string the regex accepts,
          drawn uniformly from every string it accepts.
        </p>
        <p class="callout">
          Nothing here is simulated. Every encode below runs WebCrypto PBKDF2 and AES-CTR, a
          hand-rolled FF1 that passes all nine NIST SP 800-38G sample vectors in the test suite,
          and a real rank/unrank walk over the DFA your pattern compiles to. You can
          <a href="#refs-heading">run those vectors yourself</a>, in this tab: six of the nine
          will reproduce here, and the three that will not are the AES-192 ones, because WebCrypto
          does not implement AES-192 in any browser.
        </p>
        <p class="hint">
          Sibling demo: <a href="${FORMAT_WARD_URL}" target="_blank" rel="noopener">Format Ward</a>
          runs the same FF1 from the format-preserving end — there the domain is the format itself
          (16 digits stay 16 digits). Here the domain is |L &cap; &Sigma;<sup>n</sup>|, the number of
          strings a regex accepts, and the format comes back out of the unranking. Same cipher, one
          more layer of combinatorics.
        </p>
      </section>

      <section class="panel" aria-labelledby="format-heading">
        <span class="panel-kicker">1 · FORMAT</span>
        <h2 id="format-heading">Regex &amp; format</h2>
        <p>
          Pick a shape for the output. The automaton, the capacity and the count table below all
          recompute as you type.
        </p>

        <div class="field">
          <label for="preset">Preset format</label>
          <select id="preset">
            ${presetOptions}
            <option value="custom">Custom — write your own below</option>
          </select>
        </div>

        <div class="field">
          <label for="pattern">Regular expression (full match; ^ and $ are implied)</label>
          <input id="pattern" type="text" spellcheck="false" autocapitalize="off" autocomplete="off"
            aria-describedby="pattern-note" />
          <p class="field-note" id="pattern-note">
            Supported: literals, <code>[abc]</code>, <code>[a-z]</code>, <code>[^…]</code>,
            <code>\\d</code> <code>\\w</code> <code>\\s</code>, <code>.</code>, <code>*</code>
            <code>+</code> <code>?</code> <code>{n}</code> <code>{n,m}</code>, alternation and
            groups. Alphabet: printable ASCII plus tab and newline.
          </p>
        </div>

        <div class="field">
          <label for="length">Target string length n</label>
          <input id="length" type="number" min="0" max="512" step="1" aria-describedby="length-note" />
          <p class="field-note" id="length-note">&nbsp;</p>
        </div>

        <p class="status" id="format-status" role="status" aria-live="polite">
          <span class="status-icon" aria-hidden="true">·</span><span id="format-status-text">Compiling…</span>
        </p>

        <dl class="stat-grid">
          <div class="stat">
            <dt>DFA states |Q|</dt>
            <dd id="stat-states">—</dd>
          </div>
          <div class="stat">
            <dt>Alphabet classes</dt>
            <dd id="stat-classes">—</dd>
          </div>
          <div class="stat">
            <dt>N at this n</dt>
            <dd id="stat-total">—</dd>
          </div>
          <div class="stat">
            <dt>Capacity at this n</dt>
            <dd id="stat-capacity">—</dd>
          </div>
          <div class="stat">
            <dt>n for a 128-bit payload</dt>
            <dd id="stat-n128">—</dd>
          </div>
        </dl>
        <p class="field-note" id="preset-note">&nbsp;</p>
      </section>

      <section class="panel" aria-labelledby="dfa-heading">
        <span class="panel-kicker">2 · AUTOMATON</span>
        <h2 id="dfa-heading">The minimized DFA</h2>
        <p>
          Thompson's construction builds an NFA, the powerset construction determinizes it, and
          Hopcroft's algorithm merges every pair of states no string can tell apart. Edge labels are
          <em>alphabet equivalence classes</em>: one edge stands for every character that behaves
          identically from every state, which is what keeps the counting tractable and the picture
          readable.
        </p>
        <span id="dfa-graph-title" class="sr-only">Directed graph of the minimized DFA. States are circles; the start state has a dashed ring and accepting states a double ring. The transition table below the diagram gives the same information as text.</span>
        <div class="graph-wrap" id="dfa-graph-wrap" role="region" tabindex="0"
          aria-label="Minimized DFA diagram, scrollable">
          <svg id="dfa-graph" class="dfa-svg" role="img" aria-labelledby="dfa-graph-title"></svg>
        </div>
        <p class="dfa-legend" id="dfa-legend">
          <span>Dashed ring: start state q0</span>
          <span>Double ring: accepting state</span>
          <span id="dfa-engine">Layout: —</span>
        </p>
        <p class="status" id="dfa-status" role="status" aria-live="polite">
          <span class="status-icon" aria-hidden="true">·</span><span id="dfa-status-text">—</span>
        </p>

        <div class="pathwalk" id="pathwalk">
          <h3>The path your string walks</h3>
          <p class="hint" id="pathwalk-hint">
            Encode below and this lights up the exact route the stego string takes through the
            automaton above &mdash; one state per character, ending on an accepting ring. The
            transition table is the same information as text.
          </p>
          <div class="field">
            <label for="pathwalk-scrub">Character position</label>
            <input id="pathwalk-scrub" type="range" min="0" max="0" step="1" value="0" disabled
              aria-describedby="pathwalk-readout" />
          </div>
          <p class="pathwalk-readout" id="pathwalk-readout" role="status" aria-live="polite">Nothing encoded yet.</p>
          <div class="pathwalk-string" id="pathwalk-string" role="group" aria-label="Stego string, character by character"></div>
        </div>

        <details class="trace" id="dfa-table-details">
          <summary>Transition table — the same automaton as text</summary>
          <div>
            <div class="table-wrap" role="region" tabindex="0" aria-label="DFA transition table, scrollable">
              <table>
                <caption id="dfa-table-caption">Every defined transition, as (state, class) &rarr; state.</caption>
                <thead>
                  <tr>
                    <th scope="col">From</th>
                    <th scope="col">On characters</th>
                    <th scope="col">Class size</th>
                    <th scope="col">To</th>
                    <th scope="col">Accepting?</th>
                  </tr>
                </thead>
                <tbody id="dfa-table-body"></tbody>
              </table>
            </div>
          </div>
        </details>
      </section>

      <section class="panel" aria-labelledby="encode-heading">
        <span class="panel-kicker">3 · ENCODE</span>
        <h2 id="encode-heading">Encode a message into the format</h2>
        <p>
          PBKDF2-SHA256 at 600,000 iterations over your passphrase and a fresh 16-byte salt derives
          the AES-CTR key and the FF1 key. The message is encrypted, framed, read as an integer,
          cycle-walked through FF1 inside [0, N), and unranked back into a string.
        </p>

        <div class="field">
          <label for="encode-message">Message</label>
          <textarea id="encode-message" rows="3" spellcheck="false" aria-describedby="encode-message-note"></textarea>
          <p class="field-note" id="encode-message-note">&nbsp;</p>
        </div>

        <div class="field">
          <label for="encode-passphrase">Passphrase</label>
          <input id="encode-passphrase" type="password" autocomplete="new-password" />
        </div>

        <div class="button-row">
          <button id="encode-run" type="button" class="primary">Encode</button>
          <button id="encode-copy" type="button" disabled>Copy stego string</button>
        </div>

        <p class="status" id="encode-status" role="status" aria-live="polite">
          <span class="status-icon" aria-hidden="true">·</span><span id="encode-status-text">Idle.</span>
        </p>

        <h3>Stego string</h3>
        <output id="encode-out" class="mono-out is-empty" for="encode-run encode-message">Nothing encoded yet.</output>

        <div class="capacity">
          <div class="capacity-track" id="capacity-track" role="progressbar"
            aria-labelledby="capacity-label" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"
            aria-valuetext="0 of 0 bits used">
            <div class="capacity-fill" id="capacity-fill"></div>
          </div>
          <p class="capacity-legend">
            <span id="capacity-label">Payload bits used</span>
            <span id="capacity-figures">— / —</span>
          </p>
        </div>

        <h3>The pipeline, with your values on it</h3>
        <ol class="pipeline" id="pipeline">
          <li class="pipe" id="pipe-message">
            <span class="pipe-name">Message</span>
            <span class="pipe-value" id="pipe-message-value">&mdash;</span>
          </li>
          <li class="pipe" id="pipe-cipher">
            <span class="pipe-name">AES-CTR ciphertext</span>
            <span class="pipe-value" id="pipe-cipher-value">&mdash;</span>
          </li>
          <li class="pipe" id="pipe-integer">
            <span class="pipe-name">Framed 0x01 &Vert; ct, big-endian &rarr; I</span>
            <span class="pipe-value" id="pipe-integer-value">&mdash;</span>
          </li>
          <li class="pipe" id="pipe-domain">
            <span class="pipe-name">Language slice N = |L &cap; &Sigma;<sup>n</sup>|</span>
            <span class="pipe-value" id="pipe-domain-value">&mdash;</span>
          </li>
          <li class="pipe" id="pipe-ff1">
            <span class="pipe-name">FF1, cycle-walked into [0, N)</span>
            <span class="pipe-value" id="pipe-ff1-value">&mdash;</span>
          </li>
          <li class="pipe" id="pipe-stego">
            <span class="pipe-name">Unranked through the DFA</span>
            <span class="pipe-value" id="pipe-stego-value">&mdash;</span>
          </li>
        </ol>

        <h3>The cycle walk</h3>
        <p class="hint" id="walk-hint">
          FF1 permutes [0, 2<sup>k</sup>), which is wider than [0, N). Anything landing outside is
          re-enciphered until it lands inside &mdash; that is the whole trick, and it terminates
          because a permutation cannot revisit a value without cycling.
        </p>
        <span id="walk-title" class="sr-only">Number line of the cycle walk. The wide bar is the 2^k domain FF1 permutes; the inner bar is [0, N). Each marked landing is one FF1 application, the last of them inside the inner bar. The reading below states the same figures as text.</span>
        <div class="walk-wrap" id="walk-wrap" role="region" tabindex="0" aria-label="Cycle walk diagram, scrollable">
          <svg id="walk-svg" class="walk-svg" role="img" aria-labelledby="walk-title"></svg>
        </div>
        <p class="walk-readout" id="walk-readout" role="status" aria-live="polite">Nothing encoded yet.</p>

        <h3>Send these alongside the string</h3>
        <p class="hint">
          The salt cannot live inside the stego string — every character of that string is spoken for
          by the regex. It travels out of band, with the pattern and n. That is a real cost of FTE,
          not a shortcut taken here.
        </p>
        <output id="encode-bundle" class="mono-out is-empty" for="encode-run">Nothing encoded yet.</output>

        <details class="trace" id="encode-trace">
          <summary>Step trace — every intermediate value</summary>
          <div>
            <ol class="trace-list" id="trace-list">
              <li><span class="trace-step">Nothing encoded yet</span></li>
            </ol>
          </div>
        </details>
      </section>

      <section class="panel classifier" aria-labelledby="classifier-heading">
        <span class="panel-kicker">4 · THE ADVERSARY</span>
        <h2 id="classifier-heading">Run the classifier</h2>
        <p>
          This is the machine FTE was built for. A regex-based DPI middlebox anchors a rule at both
          ends of whatever crosses the wire and drops what does not match. Below, the same message
          is offered to it three ways &mdash; as the stego string, and as the raw AES-CTR ciphertext
          in the two encodings anyone would reach for first. The bytes underneath are identical.
          Only the shape differs.
        </p>

        <div class="field">
          <label for="classifier-pattern">Classifier rule (anchored; ^ and $ are implied)</label>
          <input id="classifier-pattern" type="text" spellcheck="false" autocapitalize="off"
            autocomplete="off" aria-describedby="classifier-pattern-note" />
          <p class="field-note" id="classifier-pattern-note">
            Starts as a copy of your format regex, which is the case FTE promises to win. Sharpen it
            past the format &mdash; <code>\(9\d{2}\) \d{3}-\d{4}</code>, say &mdash; and watch
            the promise expire: FTE beats the regex it was compiled against, not every regex.
          </p>
        </div>

        <div class="button-row">
          <button id="classifier-run" type="button" class="primary">Run the classifier</button>
          <button id="classifier-reset" type="button">Reset to the format regex</button>
        </div>

        <p class="status" id="classifier-status" role="status" aria-live="polite">
          <span class="status-icon" aria-hidden="true">·</span><span id="classifier-status-text">Encode a message first &mdash; the classifier needs something to look at.</span>
        </p>

        <div class="table-wrap" role="region" tabindex="0" aria-label="Classifier verdicts, scrollable">
          <table>
            <caption id="classifier-caption">One rule, three encodings of one ciphertext.</caption>
            <thead>
              <tr>
                <th scope="col">On the wire</th>
                <th scope="col">Payload</th>
                <th scope="col">Verdict</th>
                <th scope="col">Why</th>
              </tr>
            </thead>
            <tbody id="classifier-body"></tbody>
          </table>
        </div>

        <p class="callout" id="classifier-summary">Nothing classified yet.</p>
      </section>

      <section class="panel" aria-labelledby="decode-heading">
        <span class="panel-kicker">5 · DECODE</span>
        <h2 id="decode-heading">Decode it back</h2>
        <p>
          The same pattern ranks the string to an integer, FF1 runs backwards through the same cycle
          walk, and AES-CTR recovers the message. Change one character of the string, the passphrase
          or the salt and it will almost certainly fail — but <em>almost</em> is the honest word,
          not a hedge. There is no MAC here, so a wrong key is caught only by the frame byte and the
          UTF-8 check, and on this phone-number format roughly one wrong passphrase in thirty gets
          past both and returns four bytes of plausible-looking garbage instead of an error. What
          never happens is recovering the real message. See the third limitation.
        </p>

        <div class="field">
          <label for="decode-stego">Stego string</label>
          <textarea id="decode-stego" rows="3" spellcheck="false" autocapitalize="off"></textarea>
        </div>

        <div class="field">
          <label for="decode-passphrase">Passphrase</label>
          <input id="decode-passphrase" type="password" autocomplete="current-password" />
        </div>

        <div class="field">
          <label for="decode-salt">Salt (32 hex characters)</label>
          <input id="decode-salt" type="text" spellcheck="false" autocomplete="off" inputmode="latin" />
        </div>

        <div class="button-row">
          <button id="decode-run" type="button" class="primary">Decode</button>
          <button id="decode-fill" type="button" disabled>Fill from the encode above</button>
        </div>

        <p class="status" id="decode-status" role="status" aria-live="polite">
          <span class="status-icon" aria-hidden="true">·</span><span id="decode-status-text">Idle.</span>
        </p>

        <h3>Recovered message</h3>
        <output id="decode-out" class="mono-out is-empty" for="decode-run decode-stego">Nothing decoded yet.</output>
      </section>

      <section class="panel" aria-labelledby="counts-heading">
        <span class="panel-kicker">6 · COUNTS</span>
        <h2 id="counts-heading">The count table</h2>
        <p>
          C[q0][k] is the number of strings of length exactly k that the automaton accepts from its
          start state. This is the whole of the capacity story: floor(log2 C) is how many whole bits
          a string of that length can carry, and the row for the chosen n is the one the encoder
          uses.
        </p>
        <span id="curve-title" class="sr-only">Line chart of capacity in bits against string length n, for the current pattern. A marker shows the chosen n, and a horizontal line shows the bits the current message needs; where the line crosses the curve is the shortest n that fits. The table below carries the same numbers.</span>
        <div class="curve-wrap" id="curve-wrap" role="region" tabindex="0" aria-label="Capacity curve, scrollable">
          <svg id="curve-svg" class="curve-svg" role="img" aria-labelledby="curve-title"></svg>
        </div>
        <p class="curve-readout" id="curve-readout" role="status" aria-live="polite">&nbsp;</p>

        <div class="table-wrap" role="region" tabindex="0" aria-label="Count table, scrollable">
          <table>
            <caption id="counts-caption">C[q0][k] for k = 0 to 20.</caption>
            <thead>
              <tr>
                <th scope="col">k</th>
                <th scope="col">C[q0][k] — strings of that exact length</th>
                <th scope="col">Capacity = floor(log2 C)</th>
              </tr>
            </thead>
            <tbody id="counts-body"></tbody>
          </table>
        </div>
        <p class="field-note" id="counts-note">&nbsp;</p>
      </section>

      <section class="panel limits" aria-labelledby="limits-heading">
        <span class="panel-kicker">7 · HONEST LIMITATIONS</span>
        <h2 id="limits-heading">What this does not do</h2>
        <p>
          These are not caveats bolted on at the end. Each one is a property of the construction on
          this page, and each has a name in the literature.
        </p>

        <div class="limit">
          <h3>Uniform is not the same as realistic</h3>
          <p>
            Format conformance defeats a <em>regex</em> classifier — that is the FTE threat model, and
            within it the guarantee is exact: the output is a uniformly random member of the language,
            so no regex that accepts the language can distinguish it. It defeats nothing else. A phone
            number drawn uniformly from (000) 000-0000 through (999) 999-9999 has no area code
            structure, no exchange conventions, and a leading zero about a tenth of the time. A human
            glancing at it, a statistical test on digit frequencies, or a model trained on real phone
            numbers all separate it from the genuine article immediately. Dyer et al. say so in the
            paper that introduced FTE: it targets regex-based DPI, not traffic analysis.
          </p>

          <div class="game" id="game">
            <h4 id="game-heading">Spot the fake</h4>
            <p class="hint" id="game-hint">
              Half of these came out of the encoder above, by the same unranking that produced your
              stego string. Half are shaped the way the real world shapes them. Tick the ones you
              think the encoder made.
            </p>

            <fieldset class="game-set" id="game-set">
              <legend id="game-legend">Which of these did the encoder produce?</legend>
              <div id="game-list" class="game-list"></div>
            </fieldset>

            <div class="button-row">
              <button id="game-deal" type="button" class="primary">Deal a round</button>
              <button id="game-reveal" type="button" disabled>Reveal</button>
            </div>

            <p class="status" id="game-status" role="status" aria-live="polite">
              <span class="status-icon" aria-hidden="true">·</span><span id="game-status-text">Deal a round to play.</span>
            </p>
          </div>
        </div>

        <div class="limit">
          <h3>Length leakage</h3>
          <p>
            n is fixed and public, so the stego string's length is a direct function of the message's
            length class — and worse, the encoder <em>grows</em> n when a message will not fit, which
            turns a longer message into a visibly longer string. Two messages that land in the same
            length bucket are indistinguishable; two that do not, are not. The fixes are the usual
            ones and neither is implemented here: pad every message to a constant size before
            encrypting, or drop the fixed-length slice entirely for variable-length arithmetic coding
            against a real corpus, so that the length distribution matches the cover traffic instead
            of the payload.
          </p>

          <div class="leak" id="leak">
            <h4 id="leak-heading">What the wire sees</h4>
            <p class="hint" id="leak-hint">
              The ladder an observer would build for the format above. They do not need the key,
              the salt or the pattern &mdash; only a character count. Rows that share a wire length
              are indistinguishable to them; rows that do not, are not. The four presets are all
              fixed-length, so they leak nothing here &mdash; put
              <code>[0-9a-f]{1,64}</code> in the pattern box above and the ladder separates every
              single message size, which is the leak this limitation is about.
            </p>
            <div class="table-wrap" role="region" tabindex="0" aria-label="Length ladder, scrollable">
              <table>
                <caption id="leak-caption">Message size against the length that appears on the wire.</caption>
                <thead>
                  <tr>
                    <th scope="col">Message bytes</th>
                    <th scope="col">Payload bits</th>
                    <th scope="col">n the encoder picks</th>
                    <th scope="col">Wire length</th>
                    <th scope="col">Indistinguishable from</th>
                  </tr>
                </thead>
                <tbody id="leak-body"></tbody>
              </table>
            </div>
            <p class="leak-readout" id="leak-readout" role="status" aria-live="polite">&nbsp;</p>
          </div>
        </div>

        <div class="limit">
          <h3>No authentication</h3>
          <p>
            There is no MAC anywhere in this pipeline. An adversary who sees a stego string can
            replace it with <em>any other member of the language</em> — a different phone number is
            still a phone number — and the receiver has no way to tell substitution from a genuine
            message. The 0x01 frame byte and the UTF-8 check catch accidents, not attacks, and the
            frame byte is weaker than the obvious guess. It is <em>not</em> a 1-in-256 check,
            because the leading byte of a minimal big-endian encoding is not uniform: a wrong key
            lands uniformly in [0, N), and for this phone-number format about
            <strong>43%</strong> of [0, 10<sup>10</sup>) begins with 0x01 — the whole of
            [2<sup>32</sup>, 2<sup>33</sup>) is inside it. The hex and base64 formats <em>do</em>
            come out at 1/255, but only because their N is an exact power of 256; that coincidence
            is what makes the folklore number sound right. A check whose strength swings by two
            orders of magnitude depending on whether the format happens to be byte-aligned is
            precisely what a real MAC is not. A real deployment computes HMAC-SHA256 over the
            stego string under a separate derived key, transmits or embeds the tag, and refuses to
            decode anything that does not verify — encrypt-then-MAC, checked before ranking.
          </p>

          <div class="swap" id="swap">
            <h4 id="swap-heading">Substitute the string</h4>
            <p class="hint" id="swap-hint">
              This performs the attack the paragraph above describes. Your stego string is replaced
              with other <em>real members of the same language</em> &mdash; different phone numbers,
              drawn by the same unranking &mdash; and each one is handed to the receiver's own
              decode, under your passphrase and your salt. Nothing is simulated: every trial is a
              real inverse cycle walk through FF1.
            </p>

            <div class="button-row">
              <button id="swap-run" type="button" class="primary">Run 60 substitutions</button>
            </div>

            <p class="status" id="swap-status" role="status" aria-live="polite">
              <span class="status-icon" aria-hidden="true">·</span><span id="swap-status-text">Encode a message first &mdash; the attack needs a string to replace.</span>
            </p>

            <dl class="stat-grid" id="swap-stats">
              <div class="stat">
                <dt>Refused: no frame byte</dt>
                <dd id="swap-frame">—</dd>
              </div>
              <div class="stat">
                <dt>Refused: not valid UTF-8</dt>
                <dd id="swap-utf8">—</dd>
              </div>
              <div class="stat">
                <dt>Accepted as a message</dt>
                <dd id="swap-accepted">—</dd>
              </div>
              <div class="stat">
                <dt>Measured vs predicted past the frame byte</dt>
                <dd id="swap-rate">—</dd>
              </div>
            </dl>

            <div class="table-wrap" role="region" tabindex="0" aria-label="Substitution trials, scrollable">
              <table>
                <caption id="swap-caption">A sample of the substitutions and what the receiver did with each.</caption>
                <thead>
                  <tr>
                    <th scope="col">Put on the wire instead</th>
                    <th scope="col">What the receiver did</th>
                    <th scope="col">What it handed the reader</th>
                  </tr>
                </thead>
                <tbody id="swap-body"></tbody>
              </table>
            </div>

            <p class="callout" id="swap-verdict">Nothing substituted yet.</p>
          </div>
        </div>
      </section>

      <section class="panel" aria-labelledby="fix-heading">
        <span class="panel-kicker">8 · THE FIX</span>
        <h2 id="fix-heading">What production would actually require</h2>
        <p>
          The three limitations above are not unfixable &mdash; they are unfixed, which is a
          different thing. This panel is the same lab with the fixes applied, running beside the
          unauthenticated pipeline rather than replacing it, because a mode that has a MAC cannot
          demonstrate what happens to one that does not.
        </p>

        <ol class="fixlist">
          <li><strong>Encrypt-then-MAC.</strong> HMAC-SHA256 over the counter and the ciphertext, truncated, carried inside the enciphered payload and verified before the plaintext is touched at all.</li>
          <li><strong>One failure, always.</strong> Wrong string, wrong key, wrong counter, bad padding &mdash; every refusal is the same error with the same words. The unauthenticated decoder tells you <em>which</em> check caught you, which is an oracle you can watch it leak in the panel above.</li>
          <li><strong>A key schedule.</strong> PBKDF2 runs once to stand in for a handshake; every message after that is HKDF, with a ratchet so each message key is independent.</li>
          <li><strong>Nothing beside the string.</strong> The FF1 tweak comes from a counter both sides keep, so the 16-byte salt the mode above must ship out of band disappears. The counter is never transmitted either &mdash; which also saves the 32 bits a sequence number would cost.</li>
          <li><strong>Fixed-size padding, and n never grows.</strong> Every message becomes the same number of bytes, so the wire length stops being a function of the message length. A message that does not fit is refused, not accommodated.</li>
          <li><strong>Branchless ranking.</strong> The unranking walk no longer branches on the secret index. Read the caveat below &mdash; this is a real reduction, not a guarantee.</li>
        </ol>

        <h3>What it costs</h3>
        <p>
          A tag has to live inside the payload, because every character of the stego string is
          already spoken for by the regex. So authentication competes with the message for the
          format's capacity, and narrow formats simply lose. This table is computed live from the
          same count table everything else on this page uses.
        </p>
        <div class="table-wrap" role="region" tabindex="0" aria-label="Authenticated capacity budget, scrollable">
          <table>
            <caption id="budget-caption">Longest message that fits, once the frame byte and a tag are paid for.</caption>
            <thead>
              <tr>
                <th scope="col">Format</th>
                <th scope="col">Capacity</th>
                <th scope="col">Unauthenticated</th>
                <th scope="col">128-bit tag</th>
                <th scope="col">64-bit tag</th>
                <th scope="col">32-bit tag</th>
              </tr>
            </thead>
            <tbody id="budget-body"></tbody>
          </table>
        </div>
        <p class="field-note" id="budget-note">&nbsp;</p>

        <h3>Run it</h3>
        <div class="field">
          <label for="auth-tag">Tag size</label>
          <select id="auth-tag">
            <option value="16">128-bit — forgery odds 1 in 2^128</option>
            <option value="8" selected>64-bit — forgery odds 1 in 2^64</option>
            <option value="4">32-bit — forgery odds 1 in 2^32</option>
          </select>
          <p class="field-note" id="auth-tag-note">&nbsp;</p>
        </div>

        <div class="field">
          <label for="auth-message">Message</label>
          <input id="auth-message" type="text" spellcheck="false" autocomplete="off" />
          <p class="field-note" id="auth-message-note">&nbsp;</p>
        </div>

        <div class="field">
          <label for="auth-passphrase">Passphrase</label>
          <input id="auth-passphrase" type="password" autocomplete="new-password" />
          <p class="field-note">PBKDF2 runs once for this passphrase, not once per message. Every message after the first is HKDF, which is microseconds.</p>
        </div>

        <div class="field">
          <label for="auth-counter">Message counter</label>
          <input id="auth-counter" type="number" min="0" max="100000" step="1" value="0"
            aria-describedby="auth-counter-note" />
          <p class="field-note" id="auth-counter-note">Never transmitted. The receiver searches forward from its own counter to resynchronise.</p>
        </div>

        <div class="button-row">
          <button id="auth-seal" type="button" class="primary">Seal</button>
          <button id="auth-open" type="button">Open it back</button>
          <button id="auth-attack" type="button">Run the substitution attack on it</button>
        </div>

        <p class="status" id="auth-status" role="status" aria-live="polite">
          <span class="status-icon" aria-hidden="true">·</span><span id="auth-status-text">Idle.</span>
        </p>

        <h3>Sealed string</h3>
        <output id="auth-out" class="mono-out is-empty" for="auth-seal auth-message">Nothing sealed yet.</output>
        <p class="hint" id="auth-oob">Nothing travels beside it. Compare with the unauthenticated mode, which must ship a pattern, an n and a 16-byte salt out of band.</p>

        <details class="trace" id="auth-trace">
          <summary>Step trace — the authenticated pipeline</summary>
          <div>
            <ol class="trace-list" id="auth-trace-list">
              <li><span class="trace-step">Nothing sealed yet</span></li>
            </ol>
          </div>
        </details>

        <p class="callout" id="auth-verdict">Seal something, then attack it.</p>

        <div class="limit">
          <h3>The honest caveat on item 6</h3>
          <p>
            Branchless is not constant-time, and calling it that would be exactly the kind of claim
            this page exists to avoid. What is gone is the secret-dependent <em>control flow</em>:
            the unranking walk used to break out of its loop as soon as the remaining index landed
            inside a run, so the trip count carried the secret. Now every position visits every run
            and the choice is made by arithmetic. What remains is that <strong>BigInt is
            variable-time and allocates</strong> &mdash; arithmetic on a small remainder is
            measurably faster than on a large one, and the JIT may reintroduce branches when it
            specialises the code. Closing that needs fixed-width limb arithmetic over typed arrays
            with hand-rolled carries. Against a local or co-resident attacker, do not rely on this.
          </p>
        </div>
      </section>

      <section class="panel" aria-labelledby="beyond-heading">
        <span class="panel-kicker">9 · KEYS, FRAGMENTS, FRESHNESS</span>
        <h2 id="beyond-heading">The three things a mode still is not a protocol without</h2>
        <p>
          The panel above fixes the construction. It does not make it a protocol. Three gaps are
          left, and each one is small enough to close here rather than describe.
        </p>

        <h3>A real key agreement</h3>
        <p>
          The mode above derives its root by running PBKDF2 over a passphrase, which is a stand-in
          and says so. This is the thing it stands in for: two ephemeral key pairs, public keys
          exchanged over a channel the adversary may read, and a shared secret that never crosses
          it. X25519 where the browser has it, P-256 otherwise &mdash; which one ran is reported
          rather than assumed.
        </p>
        <div class="button-row">
          <button id="hs-run" type="button" class="primary">Run the exchange</button>
        </div>
        <p class="status" id="hs-status" role="status" aria-live="polite">
          <span class="status-icon" aria-hidden="true">·</span><span id="hs-status-text">No exchange yet.</span>
        </p>
        <div class="table-wrap" role="region" tabindex="0" aria-label="Key exchange, scrollable">
          <table>
            <caption id="hs-caption">What each side holds, and what it derives.</caption>
            <thead>
              <tr>
                <th scope="col">Side</th>
                <th scope="col">Public key (crosses the channel)</th>
                <th scope="col">Derived root (never does)</th>
              </tr>
            </thead>
            <tbody id="hs-body"></tbody>
          </table>
        </div>
        <p class="callout" id="hs-verdict">Run it and compare the two roots.</p>
        <div class="limit">
          <h4>What this still is not</h4>
          <p>
            Unauthenticated Diffie&ndash;Hellman. Nothing here proves <em>whose</em> public key you
            received, so an adversary who can relay messages can sit in the middle and run two
            exchanges, one with each side. Closing that needs a signature over the transcript under
            a long-term identity key, a key pinned out of band, or a full Noise pattern. The
            transcript binding below is necessary for that and nowhere near sufficient.
          </p>
        </div>

        <h3>Fragments, so a phone number can carry a tag after all</h3>
        <p>
          One phone number holds four whole bytes and an authenticated message needs more than
          that, so the mode above refuses. The way out is to send several &mdash; but a fragment
          cannot afford to carry its own index or its own tag. So the counter doubles as the
          sequence number, only the first fragment spends a byte on the count, and there is
          <strong>one tag over the whole message</strong> rather than one per piece.
        </p>
        <div class="field">
          <label for="frag-message">Message</label>
          <input id="frag-message" type="text" spellcheck="false" autocomplete="off" />
          <p class="field-note" id="frag-plan">&nbsp;</p>
        </div>
        <div class="button-row">
          <button id="frag-seal" type="button" class="primary">Seal into phone numbers</button>
          <button id="frag-open" type="button">Reassemble</button>
          <button id="frag-tamper" type="button">Tamper with one</button>
        </div>
        <p class="status" id="frag-status" role="status" aria-live="polite">
          <span class="status-icon" aria-hidden="true">·</span><span id="frag-status-text">Idle.</span>
        </p>
        <h4>On the wire</h4>
        <output id="frag-out" class="mono-out is-empty" for="frag-seal frag-message">Nothing sealed yet.</output>
        <p class="hint">
          Twelve phone numbers in a row is itself a traffic-analysis signal &mdash; which is exactly
          the limitation FTE does not address, and fragmenting does not fix.
        </p>

        <h3>Freshness</h3>
        <p>
          A verified message is authentic. It is not necessarily <em>new</em>: replay a recorded
          string and the tag verifies, because it is the same tag it always was. The receiver keeps
          a sliding window of counters it has already accepted &mdash; the standard IPsec and DTLS
          construction &mdash; and refuses a repeat through the same path as a forgery.
        </p>
        <div class="button-row">
          <button id="replay-open" type="button" class="primary">Open the fragments</button>
          <button id="replay-again" type="button">Open the very same strings again</button>
          <button id="replay-reset" type="button">Reset the window</button>
        </div>
        <p class="status" id="replay-status" role="status" aria-live="polite">
          <span class="status-icon" aria-hidden="true">·</span><span id="replay-status-text">Seal some fragments first.</span>
        </p>
        <p class="field-note" id="replay-window">&nbsp;</p>
      </section>

      <section class="panel refs" aria-labelledby="refs-heading">
        <span class="panel-kicker">10 · SOURCES</span>
        <h2 id="refs-heading">References</h2>
        <ol>
          <li>
            A. V. Goldberg and M. Sipser, <em>Compression and Ranking</em>, STOC 1985 (SIAM J. Comput.
            20(3), 1991). The ranking function for a regular language, and the observation that it is
            an optimal compressor for it — the combinatorial half of everything above.
          </li>
          <li>
            M. Bellare, T. Ristenpart, P. Rogaway and T. Stegers,
            <em>Format-Preserving Encryption</em>, SAC 2009. Names and analyses
            <strong>rank-then-encipher</strong>: rank into an integer, encipher on the integers,
            unrank back.
            <a href="https://eprint.iacr.org/2009/251" target="_blank" rel="noopener">eprint 2009/251</a>
          </li>
          <li>
            K. P. Dyer, S. E. Coull, T. Ristenpart and T. Shrimpton,
            <em>Protocol Misidentification Made Easy with Format-Transforming Encryption</em>, CCS
            2013 — the FTE construction and libfte, aimed squarely at regex-based DPI.
            <a href="https://eprint.iacr.org/2012/494" target="_blank" rel="noopener">eprint 2012/494</a>
          </li>
          <li>
            NIST, <em>SP 800-38G: Recommendation for Block Cipher Modes of Operation: Methods for
            Format-Preserving Encryption</em>, March 2016 — FF1, implemented here from §5.2 and
            checked against all nine published sample vectors.
            <a href="https://csrc.nist.gov/pubs/sp/800/38/g/final" target="_blank" rel="noopener">csrc.nist.gov</a>
          </li>
        </ol>

        <details class="trace" id="vectors-details">
          <summary>Known-answer tests &mdash; run the nine NIST vectors in this browser</summary>
          <div>
            <p class="hint">
              The page claims FF1 per SP 800-38G. This runs the sample vectors NIST published with
              it &mdash; radix 10 and 36, with and without a tweak &mdash; against the same
              implementation every encode above uses, in your browser, now. Each is checked both
              ways: the ciphertext must equal NIST's, and decryption must return the plaintext.
            </p>
            <p class="hint">
              Six of the nine will run here. The other three use AES-192, which WebCrypto does not
              implement in any browser, so the key import is refused before FF1 is reached. Those
              three are marked UNSUPPORTED rather than failed, and they are covered by the Node test
              suite, which runs all nine. That split is worth noticing on its own: a green CI run on
              Node says nothing about what a visitor's browser can actually reproduce.
            </p>
            <div class="button-row">
              <button id="vectors-run" type="button" class="primary">Run all nine</button>
            </div>
            <p class="status" id="vectors-status" role="status" aria-live="polite">
              <span class="status-icon" aria-hidden="true">·</span><span id="vectors-status-text">Not run yet.</span>
            </p>
            <div class="table-wrap" role="region" tabindex="0" aria-label="NIST FF1 sample vector results, scrollable">
              <table>
                <caption id="vectors-caption">The nine SP 800-38G sample vectors, as run here.</caption>
                <thead>
                  <tr>
                    <th scope="col">Vector</th>
                    <th scope="col">Key</th>
                    <th scope="col">Radix</th>
                    <th scope="col">NIST says</th>
                    <th scope="col">This page produced</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody id="vectors-body"></tbody>
              </table>
            </div>
          </div>
        </details>

        <details class="glossary" id="glossary-details">
          <summary>Glossary — terms used on this page</summary>
          <div>
            <dl>
              <dt>DFA</dt>
              <dd>Deterministic finite automaton. One state, one character, one next state. A regular expression and a DFA describe exactly the same class of languages.</dd>
              <dt>Minimal DFA</dt>
              <dd>The unique smallest DFA for a language, up to renaming states. Hopcroft's algorithm finds it by repeatedly splitting groups of states that some character can tell apart.</dd>
              <dt>Alphabet equivalence class</dt>
              <dd>A set of characters that behave identically from every state, so the automaton can carry one transition for all of them. Keeps the count table small without changing the language.</dd>
              <dt>Rank / unrank</dt>
              <dd>The bijection between the strings of length n a language accepts and the integers 0 … N-1, in alphabetical order. Rank goes string to number; unrank goes back.</dd>
              <dt>Rank-then-encipher</dt>
              <dd>Encrypt on a language by ranking into integers, enciphering the integer, and unranking. The cipher never sees a string.</dd>
              <dt>FF1</dt>
              <dd>NIST's format-preserving cipher: a 10-round Feistel network whose round function is AES-CBC-MAC. Here it permutes k-bit integers, i.e. radix 2.</dd>
              <dt>Cycle walking</dt>
              <dd>Turning a permutation of [0, 2^k) into a permutation of [0, N) by re-enciphering any result that lands outside. Expected cost under two applications.</dd>
              <dt>Capacity</dt>
              <dd>floor(log2 N): how many whole bits of payload a length-n string of this language can carry.</dd>
              <dt>Tweak</dt>
              <dd>A public per-message input to FF1. This lab uses the salt, so the same message under a new salt takes a different route through the language.</dd>
            </dl>
          </div>
        </details>

        <p class="hint">
          Not production cryptography — a teaching demo. It runs entirely in this tab: no backend, no
          storage of key material, and nothing sent anywhere. The only network requests it can make
          are the five SHA-384-integrity-pinned scripts in the page head — dagre plus the four
          d3-force modules — and they are a layout enhancement: block them and the automaton still
          draws, using a built-in layering.
        </p>
      </section>

    </main>

    <footer class="scripture-footer shell shell-foot" role="contentinfo">
      <p>So whether you eat or drink or whatever you do, do it all for the glory of God. — 1 Corinthians 10:31</p>
    </footer>
  `;
}
