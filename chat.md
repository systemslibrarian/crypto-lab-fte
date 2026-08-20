# What Would Make This Demo a 10/10

> **Status: all four phases implemented, plus the question-8 gap closed.** Every upgrade below is on
> the page. The gate is green — `tsc --noEmit`, 102 unit tests across 10 files, the build, 48 claims
> tests (was 22) and the WCAG A/AA gate at desktop and 380 px, whose drive was extended to scan all
> the new states.
>
> **The Definition of 10/10 at the foot of this document is now fully answerable.** Question 8 —
> "what can an adversary who is not a regex do to me?" — was the one gap after the four phases: of
> the three honest limitations, only *uniform is not realistic* had become experiential. The other
> two now have demonstrations of their own:
>
> - **Length leakage** is a ladder of message size against wire length, built from a character
>   count alone. The four presets are fixed-length and leak nothing, which the readout says is an
>   accident of the format rather than a property of FTE; `[0-9a-f]{1,64}` separates every size.
> - **No authentication** performs the substitution attack: sixty real members of the language put
>   on the wire in place of the reader's string, each run through the receiver's own decode. The
>   measured share getting past the frame byte is printed against `frameByteFalseAccept`'s closed
>   form — ~42% against 43.1% on the phone preset — so the paragraph's central number is now
>   confirmed by the page rather than asserted by it. What never happens, and is asserted in both
>   the unit and claims suites, is a substitution returning the message that was sent.
>
> Three things came out differently from the plan, and they are worth reading before the document:
>
> 1. **The in-page vector runner found something the test suite structurally could not.** WebCrypto
>    has no AES-192 — no browser implements it — so samples 4, 5 and 6 cannot run in a browser at
>    all. They pass in CI only because Node's WebCrypto *does* implement AES-192. The page now shows
>    all nine, runs the six it can, and marks the other three UNSUPPORTED with the reason, rather
>    than printing FAIL against an implementation that is correct. A green CI run on Node was
>    saying nothing about what a visitor could reproduce; now the page says so itself.
>
> 2. **Upgrade 07 required moving the hero prose, not just adding a panel.** The plan said "keep
>    every existing panel exactly where it is". That held for the panels, but the encoder still
>    landed at 1.04 viewports on a 390 x 844 phone with the hero's description and "why it matters"
>    aside above it. Those two moved below the encoder into `.cl-hero-context`. The title is still
>    first, and the desktop two-column row is reproduced in its new position. Field, button and
>    result are now all inside the first viewport at both widths.
>
> 3. **A pre-existing CSS bug was the real cause of the mobile pacing problem.** `.cl-hero-main`
>    carries `flex: 1 1 22rem` so it can share a row with the "why it matters" aside. `flex-basis`
>    resolves against the main axis, so the moment the mobile media query turns the hero into a
>    column that 22rem became a **352px height** for ~110px of title — 240px of dead space directly
>    above the fold. Resetting the basis alongside the direction reclaimed 243px, which is more
>    than every other mobile trim combined. (Credit where due: this one is called out in
>    `chad.md`, a second review of this repo that appeared alongside this one.)
>
> 4. **Two real defects were found by the new tests rather than by review.** `assertNoSecrets`
>    compared against `decodeURIComponent(fragment)`, which does not turn `+` back into a space —
>    so a passphrase containing a space would have been written to the URL undetected. It now
>    compares against the parsed parameter values. And the base64 preset's `N` is a 116-digit
>    number that, printed raw in the cycle-walk readout, pushed the whole document sideways at
>    380 px; it is abbreviated the way the stat grid abbreviates it.
>
> The scores and measurements below are the pre-implementation reading, kept as the record of why
> this work was done.

## Short Answer

Current score: **8.5/10**.

The cryptography here is not the problem. FF1 is implemented from NIST SP 800-38G §5.2 and checked
against all nine published sample vectors (`src/ff1.test.ts:29`), the DFA is genuinely minimized
(`src/regex/dfa.ts:403`), ranking and unranking are exact BigInt arithmetic (`src/rank.ts:177`,
`src/rank.ts:215`), and the honest-limitations section is more candid than most published papers.
The 540-line claims suite (`e2e/claims.spec.ts`) checks that the page's printed numbers match the
mathematics behind them, which is rare and worth keeping.

The gap is that **the page explains the threat model but never stages it.** FTE exists to defeat a
regex-based DPI classifier. There is no classifier anywhere on this page. The learner is told the
output is a uniformly random member of the language and told, correctly, that uniform is not
realistic — but never gets to *watch a classifier accept the stego string and flag the raw
ciphertext*, and never gets to fail at telling a real phone number from a generated one. Both of
those are two-panel additions to a codebase that already computes everything they need.

The second gap is pacing. On a 390 × 844 phone the Encode button sits **3,866 px down — 4.58
viewports** below the top, behind a hero, an intro, a format panel and an automaton. The first
interactive control of any kind is 2.33 viewports down.

## Evidence From The Current Repo

01. The crypto is real and the vectors prove it. FF1 known-answer tests cover AES-128/192/256 at
    radix 10 and 36 (`src/ff1.test.ts:29`), and cycle-walking is a separate, tested layer
    (`src/ff1.ts:315`, `src/ff1.ts:331`).

02. The regex path is a real compiler, not a lookup. Parser → NFA → subset construction → Hopcroft
    minimization (`src/regex/parser.ts:341`, `src/regex/nfa.ts`, `src/regex/dfa.ts:403`), with
    alphabet equivalence classes so `\d` is one class rather than ten transitions
    (`src/regex/alphabet.ts`).

03. The counting is exact. `C[q][k]` is built as BigInt (`src/rank.ts:137`) and the claims suite
    verifies it in closed form against `16^k` for the hex preset (`e2e/claims.spec.ts:98`).

04. The frame byte is documented with unusual rigor. The doc comment at `src/fte.ts:1` refuses the
    folklore "1 in 256" and gives the real per-preset rate — 0.431 for the phone format, 1/255 for
    hex and base64 only because their `N` is an exact power of 256. `src/fte.test.ts` computes each
    rate in closed form. This is the best writing in the repo.

05. The claims suite tests the honest things. That the stego string actually matches the pattern per
    the platform regex engine (`e2e/claims.spec.ts:235`), that a wrong key never returns the real
    message even when it is not rejected (`e2e/claims.spec.ts:445`), and that with jsDelivr blocked
    outright the automaton still draws and the page says which engine it used
    (`e2e/claims.spec.ts:210`).

06. Accessibility is gated, not assumed — axe-core WCAG A/AA in both themes and again at 380 px
    (`e2e/a11y.spec.ts:33`, `e2e/a11y.spec.ts:43`), plus bespoke contrast and non-text checks
    (`e2e/contrast.ts`, `e2e/nontext.ts`).

07. Current validation passes. The deployed site at
    `https://systemslibrarian.github.io/crypto-lab-fte/` loads with zero console errors, all five
    SRI-pinned CDN scripts hash-match, and a full encode → decode round trip recovers the message
    ("Recovered 2 bytes. Ranked to index 275615279 of N = 10000000000").

08. **The threat model is asserted, never demonstrated.** The word "classifier" appears in the prose
    of the intro and the limitations section, but no classifier is implemented and none runs. The
    single sentence the whole page is built on — a regex classifier watching the wire sees a phone
    number — is the one claim with no interactive proof behind it.

09. **The step trace is buried and static.** Every intermediate value is computed and available
    (`EncodeTrace`, `src/fte.ts:130`) but rendered as a collapsed `<details>` text list
    (`src/ui/template.ts:291`). The pipeline diagram that the ASCII art at `src/fte.ts:4` draws in
    the source is not drawn on the page.

10. **The automaton and the string are disconnected.** The DFA renders (`src/dfaview.ts:235`) and the
    stego string is produced, but the graph never shows the accepting path that this particular
    string walks. The two most visual assets on the page never touch.

11. **The cycle walk is a number, not a picture.** `walkSteps` is reported as prose — "the cycle walk
    took 4 FF1 applications" (`src/ui/controller.ts:481`) — when it is the most visually explainable
    idea in format-preserving encryption: re-encipher until you land inside the domain.

12. **No shareable state, no guided path, no presenter mode.** Confirmed absent: no `location.hash`,
    no `searchParams`, no `history.replaceState`, no tour, no checkpoints anywhere in `src/`.

13. **Pacing measured.** iPhone 390 × 844: document 9,089 px; first control 1,970 px (2.33 vp);
    automaton 3,020 px (3.58 vp); Encode 3,866 px (4.58 vp); Decode 5,169 px (6.12 vp). Desktop
    1440 × 900: Encode 2,270 px (2.52 vp). No horizontal overflow at either width — that part is
    already clean.

## Highest-Impact Upgrades

01. **Stage the DPI classifier. This is the missing centrepiece.**

Add a panel that runs the actual adversary. Three payloads go in — the stego string, the raw AES-CTR
ciphertext as hex, and the same ciphertext base64'd — and the classifier regex (the user's own
pattern, the one already in `#pattern`) runs against each. Show three verdicts: PASS, FLAGGED,
FLAGGED. Then let the user edit the classifier regex independently of the format regex and watch what
happens when the two diverge.

Why this matters: this is the entire thesis of the demo and it is currently a sentence. When the
learner sees their own ciphertext get flagged and their own stego string sail through the same
matcher, the point lands in about four seconds and never has to be argued again. Everything needed is
already computed — `trace.ciphertextHex` is right there in `EncodeTrace`.

Acceptance criteria:

- Stego string matches the classifier; hex and base64 ciphertext do not.
- Classifier regex is editable and separate from the format regex; when they differ, the verdict
  changes accordingly and the page explains why.
- A deliberate mismatch (classifier stricter than the format) shows the stego string being flagged —
  the honest failure case.
- Tests assert all three verdicts against the platform regex engine, in the style of
  `e2e/claims.spec.ts:235`.

02. **"Spot the fake" — make the central limitation experiential.**

The Uniform-is-not-realistic limitation is the most important caveat on the page and it is pure prose.
Replace the top of it with a game: show eight phone numbers, some drawn uniformly from the language
and some drawn from a small table of realistic North American numbers (valid area codes, no leading
zero, plausible exchanges). Ask the user to pick the generated ones. Reveal and score.

Why this matters: the learner discovers the limitation instead of being told it, and they discover it
*after* the classifier panel has just convinced them FTE works. That sequence — it defeats the
regex, and here is what it does not defeat — is the whole intellectual arc of the paper, delivered as
an experience.

Acceptance criteria:

- Generated candidates come from the real `unrank` path, not a mock.
- Reveal explains the specific tells: leading zeros, invalid area codes, uniform digit frequency.
- Score is stated plainly ("you found 3 of 4") with no gamification chrome.
- The prose limitation stays below the game, unabridged.

03. **Draw the rank-then-encipher pipeline, and put the live values on it.**

The ASCII diagram at `src/fte.ts:4` is exactly the right mental model. Render it as a persistent
horizontal flow — message → AES-CTR → ciphertext → frame → I → FF1 + cycle walk → i → unrank → stego —
with each node showing the actual current value, abbreviated, and clickable to expand. Replace the
collapsed `<details>` trace with this, or keep the text list behind it for the full hex.

Why this matters: the page currently asks the reader to hold seven transformations in their head
while reading prose about them. The diagram makes the pipeline the thing on screen, and it stays
populated after every encode rather than needing to be opened.

Acceptance criteria:

- Every node shows a real value from `EncodeTrace`, not a placeholder.
- The diagram is visible without opening a disclosure.
- Decode shows the same flow running right to left.
- Legible at 380 px — stack vertically rather than shrinking text.
- Passes the existing axe and contrast gates in both themes.

04. **Animate the cycle walk.**

Show the walk as a number line: the domain `[0, N)` as a bar, the full `2^k` walk width as a wider
bar behind it, and each FF1 application as a dot landing either outside (rejected, re-encipher) or
inside (accepted, done). Four applications means four dots.

Why this matters: cycle-walking is the one idea in FPE that people consistently get wrong, and it is
trivially animatable. The page already knows `walkBits`, `domain`, and `walkSteps`.

Acceptance criteria:

- Dot count equals `trace.walkSteps` exactly.
- Rejected landings are visibly outside `[0, N)`; the final landing is inside.
- Works when `walkSteps` is 1 (the common case) without looking broken.
- Colour is never the only signal.

05. **Connect the automaton to the string.**

When an encode completes, highlight on the DFA graph the accepting path the stego string walks, one
state at a time, with a scrubber. Clicking a character of the stego string jumps to that state.

Why this matters: the two strongest visual assets on the page — a minimized automaton and a string
that the automaton accepts — currently never acknowledge each other. Connecting them turns "the DFA
counts the language" from a claim into something the learner traces with their finger.

Acceptance criteria:

- Path highlighting matches the transitions `rank` actually takes (`src/rank.ts:215`).
- Scrubber is keyboard operable.
- Degrades cleanly when the graph exceeds the 64-state display cap
  (`src/dfaview.ts:235`, `e2e/claims.spec.ts:137`).
- Works under the built-in layout with jsDelivr blocked.

06. **Run the NIST vectors in the page.**

The nine SP 800-38G sample vectors are checked in CI (`src/ff1.test.ts:29`) and invisible to anyone
reading the site. Add a collapsed panel to the Sources section that runs all nine live in the browser
and prints a pass/fail table with the expected and actual ciphertexts.

Why this matters: the page's central credibility claim is "real FF1, per NIST." A visitor currently
has to take that on trust or clone the repo. Nine rows of green computed in their own browser settles
it, and costs almost nothing — the implementation is already imported.

Acceptance criteria:

- All nine vectors run client-side on demand and report pass/fail individually.
- Expected and actual are both shown, not just a checkmark.
- A deliberate failure would be visible rather than silently swallowed.
- Panel is collapsed by default and does not delay first paint.

07. **Put a working encoder in the first viewport.**

At 4.58 viewports down on a phone, the Encode button is past the point most visitors leave. Add a
compact encoder to the hero: message field, passphrase field, one button, and the resulting phone
number in large type with a PASS badge from the classifier of upgrade 01. Keep every existing panel
exactly where it is — this is an addition, not a reorganisation, and the full format and automaton
panels remain the place where the mechanism is explained.

Why this matters: the demo's best moment is a phone number appearing where a ciphertext should be.
That moment should be free.

Acceptance criteria:

- On 390 × 844 the message field, the button and the result are all in the first viewport.
- The hero encoder and the main encode panel share one controller and cannot disagree.
- Scrolling to the full panel is offered explicitly ("see how this works").
- No layout shift when the result appears.

08. **Shareable teaching states, never the passphrase.**

Serialize pattern, `n`, preset id and message into the URL hash; restore on load. Add a "copy link to
this state" button. The passphrase and the salt must never enter the URL.

Why this matters: this is how a lab gets used in a classroom or a talk. It is also how a bug report
becomes reproducible.

Acceptance criteria:

- Round trip: copy link, open in a clean profile, identical page state.
- Passphrase, salt and derived keys are provably absent from the URL — assert it in a test.
- A malformed or hostile hash fails closed to defaults without throwing.
- No `localStorage` beyond the existing theme pin.

09. **A guided path through the six sections.**

An optional stepper: compile the format → read the count → encode → run the classifier → fail the
spot-the-fake game → decode → read what it does not do. Seven steps, each scrolling to and
highlighting the relevant panel, each with one sentence of why-you-are-here.

Why this matters: the six numbered sections are already in the right order, but nothing walks the
learner along them, and section 6 — the honest limitations — is 7.2 viewports down where the people
who most need it will never reach.

Acceptance criteria:

- Dismissible, and never blocks freeform use.
- Keyboard navigable, respects `prefers-reduced-motion`.
- Step state is part of the shareable URL from upgrade 08.
- The final step lands on Honest Limitations, deliberately.

10. **A capacity explorer instead of a static table.**

The count table (`#counts-body`) shows `C[q0][k]` per length. Add a small chart of capacity bits
against `n`, with the current `n` marked and the current message's requirement drawn as a horizontal
line — so the moment the encoder grows `n` (`chooseLength`, `src/fte.ts:227`) is visible as the line
crossing the curve rather than inferred from a status message.

Why this matters: "n grew because your message did not fit" is currently a sentence. It is a
crossing point, and the data is already in `scanCapacity` (`src/rank.ts:112`).

Acceptance criteria:

- Curve is computed from the real `scanCapacity` output.
- Requirement line moves live as the message is typed.
- The chosen `n` is marked and matches the encoder's choice exactly.
- Table stays as the accessible representation of the same data.

## What Not To Add

01. **Do not add a MAC and leave the framing ambiguous.** If encrypt-then-MAC is ever added, it must
    be a clearly labelled second mode next to the unauthenticated one, because the No-authentication
    limitation and its 43%-vs-1/255 analysis is one of the most valuable things on this page. Do not
    let a fix quietly delete the lesson.

02. **Do not add a backend, telemetry, or any network call.** The claim that nothing leaves the tab
    is load-bearing and currently true, with the five SRI-pinned layout scripts as the audited
    exception.

03. **Do not build a general-purpose regex playground.** The four presets plus a custom field is the
    right surface. Full PCRE — backreferences, lookaround — is not a regular language and cannot be
    ranked, and chasing it would break the one thing the DFA guarantees.

04. **Do not simulate real network traffic or a real DPI appliance.** A regex classifier over three
    payloads is the honest scope. Packet captures and TLS framing belong to a different demo.

05. **Do not replace the hand-rolled FF1 or the regex compiler with libraries.** Inspectability is
    the product.

06. **Do not gamify past the single spot-the-fake score.** No streaks, no badges, no confetti.

## Suggested Build Order

01. **Phase 1 — Stage the threat model.** Upgrades 01 and 02. The classifier panel and the
    spot-the-fake game. This is the biggest quality jump in the document and together they are
    perhaps 300 lines. Everything they need is already computed.

02. **Phase 2 — Make the mechanism visible.** Upgrades 03, 04, 05 and 06. Pipeline diagram, cycle
    walk, DFA path highlighting, in-page NIST vectors.

03. **Phase 3 — Pacing and reach.** Upgrades 07, 08 and 09. Hero encoder, shareable state, guided
    path.

04. **Phase 4 — Depth.** Upgrade 10, plus a pass over mobile density now that four panels have been
    added.

Every phase keeps the existing gates green: `npm test`, `npx tsc --noEmit`, `npm run test:e2e`,
`npm run test:a11y`. New visible claims get new rows in `e2e/claims.spec.ts` — that suite is the
reason this demo can be trusted, and it should grow with the page.

## Definition Of 10/10

A visitor should be able to answer these from direct observation, not from reading:

01. What does a regex-based DPI classifier see when it looks at my ciphertext, and what does it see
    when it looks at my stego string?
02. Which exact integer did my message become, and where did it land inside `[0, N)`?
03. Why did FF1 have to run more than once, and what was wrong with the first result?
04. Which path through the automaton does my phone number walk?
05. Why did `n` grow when I typed a longer message?
06. Can I tell a generated phone number from a real one — and having failed or succeeded, do I
    understand why that is a different question from whether the regex accepts it?
07. Is this really FF1, or does the page just say so?
08. What can an adversary who is not a regex do to me?

If those are all answerable in under three minutes, backed by the claims suite, with no backend and
nothing leaving the tab, this is a 10/10.
