# crypto-lab-fte

**Format-Transforming Encryption via regex-ranked steganography.** A regular expression is
compiled to a minimal DFA, the DFA's length-n language slice is counted exactly, and real
AES-CTR ciphertext is enciphered into that slice with FF1 (NIST SP 800-38G) plus cycle-walking,
then unranked back into a string the regular expression accepts.

Live: <https://systemslibrarian.github.io/crypto-lab-fte/> · Source: <https://github.com/systemslibrarian/crypto-lab-fte>

---

## What It Is

Ordinary encryption produces bytes that look like nothing. "Looks like nothing" is itself a
signature: a DPI middlebox that drops what it cannot classify, or a log pipeline that only
accepts well-formed records, rejects high-entropy noise on sight. **Format-Transforming
Encryption** (FTE) fixes the shape of the output without weakening the cipher underneath. You
give it a regular expression; it emits ciphertext that the regular expression accepts, drawn
uniformly from every string the expression accepts at that length.

The exact primitives on this page, all of them running in the browser tab:

| Primitive | Where | What it does here |
| --- | --- | --- |
| Thompson's construction | `src/regex/nfa.ts` | AST to epsilon-NFA; bounded repeats are expanded |
| Subset construction + Hopcroft minimization + trim | `src/regex/dfa.ts` | epsilon-NFA to the unique minimal trim DFA, over alphabet equivalence classes |
| Goldberg-Sipser ranking | `src/rank.ts` | the bijection `{0 … N-1}` to the length-n strings the DFA accepts |
| FF1, radix 2, 10-round Feistel over AES-CBC-MAC | `src/ff1.ts` | permutes `[0, 2^k)`; cycle-walking narrows it to `[0, N)` |
| PBKDF2-HMAC-SHA256, 600,000 iterations | `src/keys.ts` | one pass over passphrase + 16-byte salt yields 384 bits |
| AES-256-CTR (WebCrypto) | `src/keys.ts` | the message cipher |

### The bijection

This is the half of FTE with no key in it — pure combinatorics. Let `C[q][k]` be the number of
strings of length exactly `k` that carry state `q` to an accepting state:

```
C[q][0] = 1 if q is accepting, else 0
C[q][k] = sum over alphabet classes c of  |c| * C[delta(q, c)][k-1]
N       = C[q0][n]
```

Every entry is a `BigInt`, because for a 64-character base64 block `N` is `64^64` and IEEE
doubles stopped counting exactly at `2^53`. `unrank(i)` walks the DFA once, at each position
choosing the symbol whose block of the remaining index range contains `i`; `rank(s)` is the
exact inverse, adding the size of every block that sorts before the symbol actually taken.
Both walk the alphabet in ascending code-point order, so string `i` is the `i`-th accepted
string lexicographically by code point among strings of length `n`. Two properties follow, and
the demo depends on both: `unrank(rank(s)) = s` for every accepted `s`, and `rank` is a
bijection *onto* `[0, N)` with no gaps — so enciphering inside `[0, N)` can land anywhere in the
language and nowhere outside it.

The alphabet Sigma is fixed at 97 symbols: TAB, LF, and printable ASCII `0x20`-`0x7E`. It is
partitioned into equivalence classes — sets of characters that behave identically from every
state — computed from the character sets the pattern actually uses, so `[0-9a-f]{32}` gets two
classes rather than 97. Each class is then cut into maximal contiguous code-point runs, which
is what keeps `rank`/`unrank` at `O(n * |runs|)` rather than `O(n * |Sigma|)` while preserving
strict lexicographic order.

### The regex subset

Small on purpose. Every construct has to survive becoming a DFA and then being counted exactly,
so anything that is not a regular language is not merely unimplemented — it is outside what the
construction can do at all, and `src/regex/parser.ts` says so by name rather than failing later
with something cryptic.

**Supported:** literals (printable ASCII) · `[abc]` `[a-z]` `[^...]` · `\d` `\w` `\s` `\D` `\W`
`\S` `\t` `\n` · escaped punctuation `. ^ $ * + ? ( ) [ ] { } | \ / -` · `.` · `*` `+` `?` `{n}`
`{n,m}` · concatenation · `|` · `(...)` and `(?:...)` · `^` and `$`, which parse to epsilon.

**Not supported, and each rejected with its own message:** backreferences · lookaround · named
groups · open-ended `{n,}` · a repeat bound above 512 · literals outside Sigma. The first two are
not missing features: a language with a backreference or lookaround is not regular, so it has no
DFA and no exact count, and the parser says that rather than implying it could be added.

Two deliberate deviations from a general-purpose engine: matching is always **full-string**, so
an anchor is either redundant or a lie and is accepted and ignored; and `.` is printable ASCII
only, never TAB or LF, matching the usual convention that dot does not cross a line break.

### Security model

Within the FTE threat model the guarantee is exact: the output is a uniformly random member of
`L ∩ Sigma^n`, so **no regular expression that accepts the language can distinguish it from a
genuine member**. That is the whole of what is proved. It defeats a regex classifier. It defeats
nothing else — not a human reader, not a digit-frequency test, not a model trained on real
traffic. Dyer et al. say the same in the paper that introduced FTE: it targets regex-based DPI,
not traffic analysis.

**This is not production cryptography. It is a teaching demo.** There is no authentication
anywhere in the pipeline, the salt and pattern and `n` must travel out of band, and the whole
thing runs client-side with no backend, no storage of key material, and nothing sent anywhere.

---

## Exhibits

A tour of the interactive panels, numbered as the page numbers them.

1. **Regex and format.** Four presets plus a free-text pattern box. The automaton, the capacity
   arithmetic and the count table recompute as you type (180 ms debounce). The stat row reports
   `|Q|`, alphabet classes, `N` at the chosen `n`, capacity at that `n`, and the smallest `n`
   that would hold a 128-bit payload. A pattern that will not compile sets `aria-invalid` on the
   input and names the reason.
2. **The minimized DFA.** The automaton your pattern compiles to, drawn as an SVG graph: dashed
   ring for the start state, double ring for accepting states, one labelled edge per alphabet
   equivalence class. The status line reports how many states the powerset construction produced
   and how many minimization and trimming left. Above 64 states the graph is not drawn — the
   panel says so, and the transition table in the disclosure below still lists every transition
   as text.
3. **Encode.** Message plus passphrase. PBKDF2 derives both keys from a fresh 16-byte salt, the
   message is AES-CTR encrypted, framed with a leading `0x01`, read big-endian as an integer `I`,
   cycle-walked through FF1 inside `[0, N)`, and unranked into the stego string. A capacity bar
   shows payload bits used against bits available and turns red before you can overflow it. The
   out-of-band bundle — `pattern`, `n`, `salt` — is printed separately, because none of it can
   live inside a string every character of which is spoken for by the regex. A six-step trace
   disclosure shows every intermediate: derived key material, ciphertext hex, `I` and its bit
   length, `N` and its capacity, the FF1 domain width `k` with how many applications the cycle
   walk took, and the stego string.
4. **Decode.** Paste a stego string, passphrase and salt; the same pattern ranks the string back
   to an integer, FF1 runs backwards through the same cycle walk, and AES-CTR recovers the
   message. A "fill from the encode above" button wires the two panels together.
5. **The count table.** `C[q0][k]` for `k = 0` to 20, plus the chosen `n` if it is larger, with
   `floor(log2 C)` beside each row and the active row highlighted. A note prints the estimated
   BigInt storage for the table at the current `n` — computed by the same estimator that enforces
   the 50 MB ceiling, so the number quoted is the number that would refuse the build.
6. **Honest limitations.** Three named failures of the construction, reproduced below.
7. **References and glossary.** The four sources this is built from, and nine terms defined.

Changing the pattern or `n` **retires** any stego string on screen and says so: a stego string
belongs to exactly one `(pattern, n)` pair, and leaving a plausible-looking string that quietly
belongs to a format nobody is looking at any more would be worse than clearing it.

---

## When to Use It

Use this demo to explain, to a colleague or a class:

- what FTE actually is, and why "encryption that looks like a phone number" is a counting problem
  before it is a cryptography problem;
- rank-then-encipher — that a cipher can be made to act on a *language* by acting on the integers
  the language is in bijection with, and that the cipher never sees a string;
- why a DFA is the right data structure: minimization, alphabet equivalence classes, and a
  counting DP that is linear in `n * |Q| * |classes|`;
- what format conformance does and does not buy you, with the three limitations on screen rather
  than in a footnote.

**Do NOT use this to hide real traffic, real messages, or anything whose exposure matters.** It
has no MAC, so any adversary can swap your stego string for a different member of the language
and the receiver cannot tell; it leaks message length through `n`; it is a hand-rolled FF1 in
TypeScript with no side-channel hardening; and the uniform output is trivially separable from
real traffic by anything smarter than a regular expression. If you need a real censorship-
circumvention transport, use a maintained one. If you need format-preserving encryption in
production, use a vetted FF1 implementation and read SP 800-38G Rev. 1 first.

---

## Live Demo

<https://systemslibrarian.github.io/crypto-lab-fte/>

A visitor can pick one of four presets or type a pattern, watch the automaton and the count
table rebuild live, encode a message into a phone number or a hex string or a base64 block,
read every intermediate value in the trace, decode it back, and then break it deliberately —
wrong passphrase, wrong salt, one character changed, a message too long for the format — and
watch each failure land in a different place. Everything runs in the tab: no backend, no
analytics, no fonts, no telemetry, and no key material or message ever leaves the browser.

**Network:** the only requests the page can make are the five SHA-384-integrity-pinned scripts
in the document head — `dagre` and the four `d3-force` modules — served from jsDelivr with
`crossorigin="anonymous"` and `referrerpolicy="no-referrer"`. They are a **layout enhancement,
nothing more**. If either engine fails to load, or the page is opened with no network at all,
the automaton still draws using a built-in BFS layering (column = distance from `q0`), and the
legend says which engine it used. The favicon is an inline SVG data URI, so it costs no request
either.

---

## What Can Go Wrong

- **Salt reuse is a two-time pad.** AES-CTR here runs from an all-zero counter block. That is
  safe *only* because a fresh 16-byte salt is drawn on every encode, so the AES-256 key is never
  reused. Encrypt two different messages under the same passphrase **and** the same salt and the
  keystream repeats. The UI generates a new salt every time for exactly this reason, and displays
  the salt rather than hiding it so the reuse is visible if it ever happens. Do not lift
  `keys.ts` into anything that reuses a salt.
- **Lose the salt, the pattern or `n` and the message is gone.** None of the three fit inside the
  stego string. That is a real cost of FTE, not a shortcut taken here.
- **A message that does not fit grows `n`.** The encoder picks the shortest length that holds the
  payload and tells you it did, rather than silently changing the format — but a longer message
  then produces a visibly longer string. See "Length leakage" below.
- **Decode failures are not integrity checks, and the frame byte is weaker than it looks.** The
  `0x01` byte exists so that a big-endian integer can remember its leading zero bytes. The obvious
  guess — that a wrong key passes it 1 time in 256 — is wrong, because the leading byte of a
  *minimal* big-endian encoding is not uniform over `0..255`. A wrong passphrase lands uniformly in
  `[0, N)`, and the fraction of that range beginning with `0x01` is a property of `N`:
  **0.431 for the phone preset** (all of `[2^32, 2^33)` is inside `[0, 10^10)`), 0.0043 for IPv4,
  and `1/255` for hex and base64 — the last two only because their `N` is an exact power of 256,
  which is the coincidence that makes the folklore number sound right. `src/fte.test.ts` computes
  all four in closed form. The strict UTF-8 decode behind it catches most of what gets through;
  "most" is not a security property, and a check whose strength swings by two orders of magnitude
  depending on whether the format happens to be byte-aligned is exactly what a MAC is not.
  End to end on the phone preset, roughly **one wrong passphrase in thirty** clears both checks and
  returns four bytes of plausible-looking garbage rather than an error. The page says so in the
  decode panel. What never happens is recovering the real message: confidentiality is a property
  of AES, and it does not depend on any of this.
- **The ranking order is code-point order, not the format's own order.** For
  `[A-Za-z0-9+/]{64}`, index 0 is 64 `+` characters and index `N-1` is 64 `z` characters, because
  `+` is `0x2B` and `z` is `0x7A`. Base64's own alphabet order is irrelevant to the bijection.
- **Some patterns are rejected, on purpose.** Under 8 bits of capacity at every length up to
  `n_max` ("a format has to have choices in it to hide anything"); over 4096 DFA states, which
  `[ab]*a[ab]{20}` reaches because subset construction is exponential in the worst case; a count
  table over 50 MB; a language slice under the FF1 minimum domain of `10^6`.

### The three named limitations, as the page states them

**Uniform is not the same as realistic.** Format conformance defeats a *regex* classifier, and
within that model the guarantee is exact. It defeats nothing else. A phone number drawn uniformly
from `(000) 000-0000` through `(999) 999-9999` has no area-code structure, no exchange
conventions, and a leading zero about a tenth of the time. A human glance, a digit-frequency
test, or a model trained on real phone numbers separates it from the genuine article
immediately.

**Length leakage.** `n` is fixed and public, so the stego string's length is a direct function of
the message's length class — and the encoder *grows* `n` when a message will not fit, turning a
longer message into a visibly longer string. Two messages in the same length bucket are
indistinguishable; two that are not, are not. The fixes are the usual ones and neither is
implemented here: pad every message to a constant size before encrypting, or abandon the
fixed-length slice for variable-length arithmetic coding against a real corpus.

**No authentication.** There is no MAC anywhere in this pipeline. An adversary who sees a stego
string can replace it with *any other member of the language* — a different phone number is still
a phone number — and the receiver cannot tell substitution from a genuine message. The frame byte
does not help: see the false-accept rates above. A real
deployment computes HMAC-SHA256 over the stego string under a separate derived key, transmits or
embeds the tag, and refuses to decode anything that does not verify: encrypt-then-MAC, checked
before ranking.

---

## Real-World Usage

- **Censorship circumvention.** FTE was built for this. Dyer, Coull, Ristenpart and Shrimpton
  (CCS 2013) showed that regex-driven DPI — the kind deployed by commercial middlebox vendors and
  by national firewalls — could be made to misclassify a tunnel as HTTP, SMTP or SSH by forcing
  the ciphertext to satisfy the classifier's own regular expression. Their `libfte` and the
  `fteproxy` pluggable transport built on it were deployed in the Tor ecosystem. This demo is not
  libfte and is not a transport; it is the construction, laid open.
- **Format-preserving encryption in industry.** The same rank-then-encipher idea, with the
  language fixed to a format rather than a regex, is what protects card numbers, national ID
  numbers and other fixed-shape fields in databases and payment systems that cannot widen a
  column. That is FF1's day job, and the sibling demo below is the one that shows it.
- **Ranking as compression.** Goldberg and Sipser's original point was not encryption at all: the
  ranking function for a regular language is an *optimal* compressor for it, since a uniformly
  distributed member of a language of size `N` needs exactly `log2 N` bits. Capacity on this page
  is that same number, rounded down.

---

## References

1. A. V. Goldberg and M. Sipser, *Compression and Ranking*, STOC 1985 (SIAM J. Comput. 20(3),
   1991). The ranking function for a regular language, and the observation that it is an optimal
   compressor for it — the combinatorial half of everything above.
2. M. Bellare, T. Ristenpart, P. Rogaway and T. Stegers, *Format-Preserving Encryption*, SAC 2009.
   Names and analyses **rank-then-encipher**: rank into an integer, encipher on the integers,
   unrank back. <https://eprint.iacr.org/2009/251>
3. K. P. Dyer, S. E. Coull, T. Ristenpart and T. Shrimpton, *Protocol Misidentification Made Easy
   with Format-Transforming Encryption*, CCS 2013 — the FTE construction and libfte, aimed
   squarely at regex-based DPI. <https://eprint.iacr.org/2012/494>
4. NIST, *SP 800-38G: Recommendation for Block Cipher Modes of Operation: Methods for
   Format-Preserving Encryption*, March 2016 — FF1, implemented here from §5.2 and checked against
   all nine published sample vectors. Draft Rev. 1 (Feb 2025) supplies the `10^6` minimum domain
   this lab enforces. <https://csrc.nist.gov/pubs/sp/800/38/g/final>

---

## How to Run Locally

```sh
git clone https://github.com/systemslibrarian/crypto-lab-fte.git
cd crypto-lab-fte
npm install

npm run dev        # Vite dev server on http://localhost:5173/crypto-lab-fte/
npm run build      # tsc --noEmit, then vite build into dist/
npm run preview    # serve the production build
npm test           # Vitest, the whole unit suite
npm run test:e2e   # Playwright claims suite (needs: npx playwright install chromium)
npm run test:a11y  # Playwright + axe WCAG gate
npm run test:e2e:all  # both Playwright projects
```

Vite's `base` is pinned to `/crypto-lab-fte/` because GitHub Pages serves the lab from a project
subpath, so nothing in the page may use a root-absolute asset path. There is no backend and no
build-time secret; opening `dist/index.html` through any static server is enough.

---

## Related Demos

- **[Format Ward](https://systemslibrarian.github.io/crypto-lab-format-ward/)** — the same FF1,
  approached from the format-**preserving** end. There the domain is the format itself: 16 digits
  go in and 16 digits come out. Here the domain is `|L ∩ Sigma^n|`, the number of strings of
  length `n` a regular expression accepts, and the format is recovered by unranking. Same cipher,
  one more layer of combinatorics. Reading the two together is the clearest way to see what
  rank-then-encipher actually generalises.

---

## Build & Verify

`npm test` runs **48 tests across 4 files** (about 9 seconds; the bulk of it is PBKDF2, which is the point):

| File | Tests | What it pins down |
| --- | --- | --- |
| `src/ff1.test.ts` | 16 | **All nine NIST SP 800-38G sample vectors** (S1-S9: AES-128/192/256, radix 10 and 36, with and without tweak), FF1 at radix 2 as a genuine permutation of `{0,1}^k`, cycle-walking injective and round-tripping on a non-power-of-two domain, refusal below the `10^6` domain floor |
| `src/rank.test.ts` | 11 | The count table against brute-force enumeration; **the textbook known answers** `16^32`, `64^64`, `10^10`, `1110^4`; rank/unrank a bijection onto `[0, N)` whose enumeration is sorted; **`rank("(415) 555-0123") = 4155550123`** and `unrank(0) = "(000) 000-0000"` |
| `src/fte.test.ts` | 12 | Round trips through every preset, the stego string re-checked against the platform `RegExp` engine, failing closed on a wrong passphrase or salt, a different salt giving a different string, `n` growing when the payload does not fit, and the frame byte's false-accept rate computed in closed form for all four presets |
| `src/regex/dfa.test.ts` | 9 | The DFA cross-checked against the platform `RegExp` engine on a spread of patterns and inputs, minimization (two spellings of one language give one state count), the alphabet partition covering Sigma exactly once, and the parser rejecting out-of-subset constructs by name |

The known-answer tests are the first two rows: `src/ff1.test.ts` for the cipher, `src/rank.test.ts`
for the combinatorics.

**Numbers the code actually produces** (recomputed from source while writing this):

| Preset | Pattern | `n` | `\|Q\|` | classes | `N` | capacity |
| --- | --- | --- | --- | --- | --- | --- |
| Phone number | `\(\d{3}\) \d{3}-\d{4}` | 14 | 15 | 6 | `10^10` | 33 bits |
| IPv4 dotted quad | `\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}` | 15 | 16 | 3 | `10^12` | 39 bits |
| Hex string | `[0-9a-f]{32}` | 32 | 33 | 2 | `16^32 = 2^128` | 128 bits |
| Base64 block | `[A-Za-z0-9+/]{64}` | 64 | 65 | 2 | `64^64 = 2^384` | 384 bits |

At `n = 15` the IPv4 slice is *exactly* the zero-padded quads (`192.168.001.001`), because that is
the only shape 15 characters can take — one of the ways a fixed length narrows a format. The
phone preset's 33 bits are worth staring at: four message bytes plus the frame byte already
overflow it. Base64 at 65 states is over the 64-state display cap, so that preset is counted and
tabulated but not drawn.

**Accessibility gate.** `e2e/a11y.spec.ts` runs axe-core against `wcag2a`, `wcag2aa`, `wcag21a`
and `wcag21aa` on the production build (Chromium, dark scheme, at desktop width and again at
380 px). It does not scan one arrival state: `e2e/gate.ts` drives the lab through everything it
teaches — the 15-state phone automaton on arrival, the skip link focused, each disclosure opened
by clicking its own `<summary>`, all four presets, an unparseable pattern behind `aria-invalid`,
an 81-state automaton over the display cap, an over-capacity message with the encode refused
before any key derivation, a real encode with its trace, the decode that recovers it, a wrong
passphrase and a malformed salt, hover states and focus rings — and scans every one. It also adds
three checks axe has no rule for: a contrast audit that resolves `color-mix()` fills, a non-text
contrast audit against a checked-in baseline, and a horizontal-overflow check for WCAG 1.4.10
reflow. Uncaught page errors fail the run. Nothing is injected into the page and no disclosure is
opened from script, so the rendering that is scanned is the rendering a reader actually gets.

**Claims suite.** `e2e/claims.spec.ts` (`npm run test:e2e`) runs **22 tests** asking a different
question from the unit tests: does the page tell the truth about what it computed? The rule that
makes them worth anything is that each compares two values the *page* printed, or re-derives a
claim from the page's own inputs by a different route than the source takes. The independent
oracles are the platform `RegExp` engine (is the stego string really a language member?),
closed-form combinatorics (a hex format's length-`k` slice has exactly `16^k` members and so
exactly `4k` bits), BigInt arithmetic over the printed numbers (every `capacity = floor(log2 N)`
claim), and the round trip itself. The cross-checks a single surface cannot fake: the preset
menu's hand-written `(33 bits at n = 14)` against the live stat grid, the count table's
highlighted row against that grid, the capacity bar's figures against both, and the SVG's circle
count against the transition table. It also covers every failure path by name, and both halves of
retirement — changing the pattern or `n` must clear a stale stego string *and say it was retired*,
while re-selecting the same preset must not. One test blocks every request to jsDelivr and asserts
the automaton still draws with the built-in layering, which is what makes the CDN tags an
enhancement rather than a dependency.

**The tests have been watched to fail.** Five mutations were applied to the source, one at a
time, each confirmed to leave `tsc` clean and (for the browser ones) to change the bundle hash
before being reverted, with the hash confirmed to return afterwards:

| Mutation | Test that caught it |
| --- | --- |
| `<` to `<=` in the unrank block comparison | the far-ends round-trip in `src/rank.test.ts` |
| `p[6] = 0x0a` to `0x0b` in the FF1 P block | all nine NIST vectors |
| the encrypt cycle walk run through `ff1Decrypt` | the walk's round trip, plus three FTE round trips |
| the phone preset's declared `bits: 33` to `34` | the claims suite's preset-label cross-check |
| the `clearDfa` call removed from the failure branch | the stale-drawing claim (16 stale circles survived) |

A green suite that has never been seen red is not evidence.

**A pre-push audit found two flaky assertions, and both were structural.** Both asserted that a
wrong passphrase always fails, which this construction does not guarantee — so both were rewritten
to drive the state on the base64 preset, where a false accept is a `~2^-40` event rather than a
`~1-in-30` one. The lesson is worth stating plainly: the flake was not a test-timing problem, it
was a test asserting something the README's own "What Can Go Wrong" section says is untrue.

---

## Performance

Measured on the development container; your numbers will differ, but the shape will not.

- **PBKDF2 dominates everything.** 600,000 iterations of HMAC-SHA256 (the OWASP 2023 floor) is
  roughly 300-400 ms per derivation in WebCrypto, and a full encode-then-decode round trip in the
  test suite lands around 700 ms. One derivation produces 384 bits split into the AES-CTR key and
  the FF1 key — domain-separating with two derivations would double the wait for no security
  gain, since distinct non-overlapping ranges of one PRF output are already independent.
- **FF1 is cheap by comparison.** Ten Feistel rounds, each an AES-CBC-MAC over a few blocks
  through WebCrypto. The cycle walk re-enciphers only when the result lands in `[N, 2^k)`, which
  happens with probability under 1/2, so the expected number of applications is `2^k/N < 2`; the
  hard stop at 512 applications is there because looping forever would hide a wrong domain rather
  than report it.
- **Compilation is the interactive cost.** Every keystroke re-parses, rebuilds the epsilon-NFA,
  determinizes, minimizes and re-scans capacity, behind a 180 ms debounce. `scanCapacity` uses a
  single rolling row, so capacity for every `k` up to `n_max` costs `O(|Q|)` memory rather than
  `O(n * |Q|)`.
- **The count table is the memory cost.** `(n+1) * |Q|` BigInt cells, and a BigInt cannot live in
  a typed array — V8 stores each as a heap object of a header plus 64-bit limbs. `estimateTableBytes`
  models that shape honestly and the page prints the estimate; the same estimator enforces the
  50 MB ceiling.
- **rank/unrank are `O(n * |runs|)`** BigInt operations, with `|runs|` typically a handful. Note
  that runs and classes are not the same count: the phone preset has 6 classes but 10 runs, and
  hex has 2 classes but 6 runs, because a class is cut wherever it is not contiguous in code-point
  order (`[0-9a-f]` is one class, two runs) and Sigma itself has a gap between LF and space.
- **Guards, all of them stated in the code and enforced:** NFA expansion 20,000 states; `|Q|`
  ceiling **4096**; repeat bound and `n_max` **512**; count table **50 MB**; minimum useful
  capacity **8 bits**; FF1 minimum domain **10^6**, from Draft SP 800-38G Rev. 1 (2nd public
  draft, Feb 2025), which promoted the 2016 text's recommendation to a requirement after
  Hoang-Tessaro-Trieu showed small domains fall to known-plaintext message recovery; cycle-walk
  hard stop 512 applications; graph display cap 64 states.

---

*One of the browser demos in the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
