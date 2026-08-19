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
          <p class="cl-hero-desc">
            Compile a regular expression to a minimal DFA, count its length-n language exactly, and
            encipher real AES-CTR ciphertext into that count — so the output is a uniformly random
            member of the language, and a regex classifier watching the wire sees a phone number.
          </p>
        </div>
        <aside class="cl-hero-why" aria-label="Why it matters">
          <span class="cl-hero-why-label">WHY IT MATTERS</span>
          <p class="cl-hero-why-text">
            Censorship systems and DPI middleboxes classify traffic by what it looks like. FTE was
            built to answer that: it makes ciphertext satisfy the classifier's own regex, exactly and
            provably, without weakening the cipher underneath.
          </p>
        </aside>
      </header>

      <div class="chip-row" role="list" aria-label="Primitives used">
        <span class="chip primary" role="listitem">Format-Transforming Encryption</span>
        <span class="chip" role="listitem">Rank-then-encipher</span>
        <span class="chip" role="listitem">FF1</span>
        <span class="chip" role="listitem">AES-CTR</span>
        <span class="chip" role="listitem">PBKDF2-SHA256</span>
        <span class="chip" role="listitem">DFA minimization</span>
      </div>

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
          hand-rolled FF1 that passes all nine NIST SP 800-38G sample vectors, and a real
          rank/unrank walk over the DFA your pattern compiles to.
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

      <section class="panel" aria-labelledby="decode-heading">
        <span class="panel-kicker">4 · DECODE</span>
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
        <span class="panel-kicker">5 · COUNTS</span>
        <h2 id="counts-heading">The count table</h2>
        <p>
          C[q0][k] is the number of strings of length exactly k that the automaton accepts from its
          start state. This is the whole of the capacity story: floor(log2 C) is how many whole bits
          a string of that length can carry, and the row for the chosen n is the one the encoder
          uses.
        </p>
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
        <span class="panel-kicker">6 · HONEST LIMITATIONS</span>
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
        </div>
      </section>

      <section class="panel refs" aria-labelledby="refs-heading">
        <span class="panel-kicker">7 · SOURCES</span>
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
