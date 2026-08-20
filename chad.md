# Chad Review: Making Crypto Lab FTE a 10/10 Demo

## Executive verdict

This is already an excellent cryptography implementation. The correctness story, threat-model
honesty, independent claims tests, offline fallback, and accessibility gate are stronger than
most public demos ever become.

The main problem is presentation order. The demo currently asks the visitor to understand the
work before it shows the payoff. On the published page at 1440 x 900:

- the first format control starts just below the first viewport;
- the Encode section starts about 1,910 px down;
- the page is about 5,534 px tall;
- the first viewport contains explanation, but no runnable transformation.

On mobile, the whole first viewport is also explanatory. There is also a large blank gap between
the hero description and the "Why it matters" block because `.cl-hero-main` retains its `22rem`
flex basis after the hero changes to a column.

My short version: **this is a 9.5/10 technical artifact inside a 6.5/10 first-run experience.**
Do not add more cryptography. Put the transformation first, make its three stages visible, close
the round trip in place, and move the proof underneath it.

## Current scorecard

| Dimension | Current | Why |
| --- | ---: | --- |
| Cryptographic and mathematical rigor | 10/10 | Real WebCrypto, FF1 vectors, exact `BigInt` counting, independent ranking checks |
| Honesty and trust | 10/10 | The limits are unusually specific and do not oversell the threat model |
| Test quality | 9.5/10 | Claims, mutations, accessibility states, offline fallback, and reflow are all exercised |
| Teaching content | 8.5/10 | Excellent material, but its hierarchy follows the implementation more than the learner |
| First 30 seconds | 5.5/10 | No input, action, or result is visible before scrolling |
| Interaction flow | 6.5/10 | Encode and decode work, but feel like separate forms rather than one experiment |
| Visual identity | 7/10 | Clean and legible, but the dark blue/purple card stack feels more generic than the subject |
| Replay and sharing | 5.5/10 | The stego string can be copied, but the complete non-secret packet cannot be moved as one unit |

## The product idea

A 10/10 version should deliver one clear promise:

> Type `hi`, click once, and watch ordinary encrypted bytes become a phone number that the regex
> accepts. Then reverse it and inspect every honest detail.

The first screen should answer four questions without scrolling:

1. What went in?
2. What did ordinary encryption produce?
3. What did FTE turn it into?
4. Does it really match the selected regex and decode back?

Everything else is evidence for that moment.

## Recommended first screen

Keep the Crypto Lab top bar and the literal product name. Replace the long opening runway with a
compact live workbench.

```text
FORMAT-TRANSFORMING ENCRYPTION
Encrypted bytes that match a regular expression.

[ Phone number ] [ HTTP request ] [ Hex ] [ Base64 ] [ Custom ]
  Pattern: \(\d{3}\) \d{3}-\d{4}      Capacity: 3 message bytes

Message                  Demo passphrase
[ hi                  ]  [ demo-only              ]  [ Transform ]

PLAINTEXT          AES-CTR BYTES          FTE OUTPUT
hi          ->      8f 31 ...       ->     (617) 204-9381
                                             MATCHES REGEX

[ Verify round trip ]  [ Copy non-secret packet ]  [ Inspect the math ]
```

On mobile, stack the three result stages vertically. The action and result placeholder should
still be visible in the first 844 px. Do not auto-run the cryptography on load; the click is the
visitor's experiment.

The current `hi` default is exactly right for the phone preset. Keep it. Make the human limit
visible as "up to 3 UTF-8 bytes" instead of requiring visitors to translate 33 capacity bits and
the frame byte themselves.

## P0: Changes that create the demo moment

### 1. Put a runnable transformation above the fold

Move the essential Encode controls directly under a much shorter hero. Move "What this actually
does" below the first result, where it answers a question the visitor now has.

Cut from the opening state:

- the six primitive chips;
- the duplicate long-form introduction;
- the separate "Why it matters" card on mobile.

Keep one sentence of context and one sentence of honesty. The current prose is good; it is simply
arriving too early.

**Acceptance criteria**

- At 1440 x 900, message, passphrase, primary action, all three output stages, and capacity are
  visible without scrolling.
- At 390 x 844, message, primary action, and the beginning of the result are visible without
  scrolling.
- A first-time visitor can get a valid phone-number result with one click from the arrival state.

### 2. Show the missing middle: raw ciphertext

The page explains that ordinary ciphertext "looks like nothing," but the raw AES-CTR bytes are
hidden in the closed step trace. Promote that value into the main result.

The visible transformation should be:

```text
plaintext -> AES-CTR ciphertext -> regex-conforming FTE output
```

This single comparison explains the project more effectively than another paragraph can. Give
the three states stable semantic colors:

- plaintext: neutral;
- raw ciphertext: amber;
- valid cover-format output: mint/green;
- combinatorics and rank metadata: violet.

Color must remain redundant with labels and icons, as the current statuses already do well.

### 3. Close the round trip in the same workbench

The current Decode panel is roughly another screen below Encode. After a successful encode, show
a `Verify round trip` action beside the result. It should use the generated stego string, salt,
pattern, and `n`, derive again, and reveal `hi` immediately below the pipeline.

Keep a full manual Decode mode for pasted input, but present Encode and Decode as two modes of one
lab rather than two distant forms. A compact tab or segmented control is appropriate here.

Do not silently claim authentication when verification succeeds. Label it as a round trip, not as
tamper verification.

### 4. Copy a complete non-secret packet

`Copy stego string` is incomplete for the workflow the page teaches because decoding also needs
the pattern, `n`, and salt. Add one primary transport action that copies structured JSON:

```json
{
  "version": 1,
  "stego": "(617) 204-9381",
  "pattern": "\\(\\d{3}\\) \\d{3}-\\d{4}",
  "n": 14,
  "salt": "..."
}
```

Never include the passphrase. The manual fields and raw stego-only copy can remain as secondary
tools. Manual Decode should accept this packet in one paste and populate its non-secret fields.

This does not hide the out-of-band cost. It makes that cost tangible and usable.

### 5. Fix the mobile hero gap

In [styles/main.css](styles/main.css), the mobile column rule resets `.cl-hero-why` but not the
`22rem` flex basis on `.cl-hero-main`. Reset both children to content sizing at the mobile
breakpoint.

The likely minimal fix is:

```css
@media (max-width: 640px) {
  .cl-hero-main,
  .cl-hero-why {
    flex-basis: auto;
  }
}
```

This is independent of the larger redesign and should be fixed even if nothing else changes.

## P1: Make the explanation feel inevitable

### 6. Reorder the page around the learner's questions

Recommended information architecture:

1. **Transform it**: live plaintext, ciphertext, FTE output, capacity, and round trip.
2. **Choose the disguise**: presets, custom regex, `n`, live count, and compiler errors.
3. **Why it matches**: minimized DFA with one generated string traced through it.
4. **How the index becomes text**: rank, FF1, cycle walking, and the count visualization.
5. **Break it**: wrong key, changed character, length leakage, and no authentication.
6. **Audit the implementation**: full transition table, count table, references, and test claims.

The current order mirrors the pipeline's implementation: format, DFA, encode, decode, count.
The proposed order mirrors curiosity: result, reason, mechanism, failure, proof.

### 7. Make presets visual and human-readable

The long native select option combines name, regex, capacity, and `n`. It is accurate but hard to
scan, especially on mobile. Use a compact preset switcher and keep the regex in its own field.

Each preset should show:

- a sample shape, such as `(555) 123-4567`;
- maximum message bytes at the selected `n`;
- the exact capacity bits as secondary detail;
- whether the DFA can be drawn at that size.

Add an **HTTP-shaped request** preset to align the first-run story with the DPI threat model:

```regex
GET /[a-z0-9]{32} HTTP/1\.1
```

Its 32 base-36 characters provide about 165 bits, enough for a short human phrase plus framing.
Call it "HTTP-shaped," not "realistic HTTP." The uniform-vs-realistic limitation still applies.

### 8. Turn the DFA into a replay, not just a diagram

The static graph proves that an automaton exists. A replay teaches what it does.

After encoding, add `Replay DFA walk`. Highlight the current state, consumed character, chosen
edge, and next state for the generated stego string. Include a scrubber or previous/next controls
so the visitor can inspect one character at a time.

For the phone DFA, fit the entire linear path in the panel when possible. The current SVG is about
1,832 px wide for the default phone format and therefore starts as a horizontal scroller. Add fit,
zoom, and reset controls, with the transition table preserved as the accessible text equivalent.

Respect `prefers-reduced-motion`: reduced-motion users should get the same highlighted states with
no animated travel.

### 9. Replace the count-table-first explanation with one visual decision

Keep the exact count table, but move it into advanced evidence. The primary explanation should
show one unrank decision:

```text
index 4,152,340,123 of 10,000,000,000
     -> first digit block
     -> next digit block
     -> ...
     -> (415) 234-0123
```

For one selected character, show how many accepted suffixes lie behind each possible edge and
which block contains the current index. That makes Goldberg-Sipser ranking understandable without
requiring the visitor to infer it from 15 table rows.

### 10. Add a deliberate "Break it" experiment

After a successful round trip, offer three explicit experiments:

- change one character;
- use the wrong passphrase;
- try a message that exceeds the format.

Report the actual result. A changed string or wrong key may fail, or may produce garbage because
there is no MAC. That ambiguity is the lesson, not an edge case to hide. Phrase the conclusion as
"not authenticated" rather than "tampering detected."

Use a roomy preset such as Base64 for deterministic failure-path wording in automated tests, just
as the current claims suite already does.

## P2: Visual and interaction polish

### 11. Give the lab a domain-specific visual language

Keep the dark Crypto Lab shell, but make the interior feel like a transformation instrument rather
than a stack of generic cards.

- Use one unframed process lane for plaintext, bytes, rank, and cover text.
- Reduce panel radius from 16 px toward 8 px and remove shadows from ordinary page sections.
- Reserve bordered surfaces for actual controls, outputs, disclosures, and repeated data.
- Replace the radial color washes with a very subtle DFA/grid pattern or restrained signal lines.
- Use amber, mint, and violet semantically instead of letting purple carry nearly every emphasis.

The CSS declares Space Grotesk and IBM Plex Sans, but neither font is bundled, so the published
page falls back to Segoe UI or the system font. If the intended typography matters, self-host a
small WOFF2 subset for the used weights. That preserves the no-external-font promise.

### 12. Use motion only where it explains causality

Good motion here would be:

- a short stage reveal after the real cryptographic result exists;
- DFA edge/state highlighting during replay;
- a capacity bar transition when the message changes;
- a brief copied/success state on the action itself.

Do not animate decorative background objects or fake cryptographic progress. If stage-by-stage
progress is shown during execution, it must correspond to real milestones in the implementation.

### 13. Improve small control details

- Add a show/hide control to passphrase fields.
- Change copy buttons to a familiar copy icon plus a concise label, then show `Copied` briefly.
- Add fit, zoom, and replay icon controls to the DFA with tooltips and accessible names.
- Keep destructive or failure experiments visually separate from the primary path.
- Preserve the current explicit working, success, and error words; they are excellent.

### 14. Make safe state shareable

Allow the selected preset or custom `pattern` and `n` to live in the URL. This makes an automaton or
capacity example linkable without storing a message, salt, stego string, or passphrase.

Never put passphrases, derived keys, plaintext, ciphertext, or complete packets in the URL or
`localStorage`.

## Implementation map

| Surface | Recommended work |
| --- | --- |
| [src/ui/template.ts](src/ui/template.ts) | Reorder the page, add the first-screen workbench, result pipeline, packet import/export, verification, and break-it controls |
| [src/ui/controller.ts](src/ui/controller.ts) | Model the unified flow, render visible ciphertext, import/export packets, preserve retirement semantics, and add safe URL state |
| [styles/main.css](styles/main.css) | Fix the mobile flex gap, create the responsive process lane, tighten sections, add semantic colors, and implement reduced-motion-safe states |
| [src/dfaview.ts](src/dfaview.ts) | Add fit/zoom/reset and an optional highlighted traversal path |
| [src/fte.ts](src/fte.ts) | Keep cryptography pure; expose only any additional trace data genuinely needed by the UI |
| [e2e/claims.spec.ts](e2e/claims.spec.ts) | Pin the visible three-stage result, packet round trip, safe URL state, traversal, and break-it truthfulness |
| [e2e/a11y.spec.ts](e2e/a11y.spec.ts) and [e2e/gate.ts](e2e/gate.ts) | Drive every new state at desktop and 380 px, including reduced motion, tooltips, packet errors, and graph controls |
| [README.md](README.md) | Replace the numbered panel tour with the new learner journey and add one strong first-screen screenshot |

## Build order

### Slice A: First-minute experience

- Fix the mobile hero gap.
- Shorten the hero and move Encode above the explanation.
- Show plaintext, AES bytes, and FTE output together.
- Keep phone + `hi` as the arrival example.
- Update claims and accessibility tests for the new arrival geometry and state.

This slice alone would produce the largest improvement.

### Slice B: One coherent workflow

- Merge Encode and manual Decode into workbench modes.
- Add `Verify round trip`.
- Add packet copy/import without the passphrase.
- Preserve stale-result retirement when the pattern or `n` changes.

### Slice C: The memorable teaching layer

- Add the HTTP-shaped preset.
- Add DFA traversal replay.
- Add the one-step rank visualization.
- Add the three break-it experiments.

### Slice D: Finish and prove it

- Tighten visual hierarchy and typography.
- Add meaningful, reduced-motion-safe transitions.
- Run the existing unit, claims, and accessibility suites.
- Add visual regression screenshots at 1440 x 900 and 390 x 844.
- Re-run the existing mutation checks where behavior moved.

## Definition of done

I would call the demo 10/10 when all of these are true:

- The first useful result requires one click and no scroll.
- The difference between ordinary ciphertext and FTE output is visible, not merely described.
- The generated output visibly proves regex membership and can be decoded in place.
- A complete non-secret packet can be copied and imported without manual field choreography.
- Phone capacity is stated in human bytes as well as exact bits.
- The DFA can replay the generated string and remains fully available as text.
- The rank visualization explains one real choice using values from the current run.
- Tampering teaches the lack of authentication without claiming reliable detection.
- Desktop and mobile have no dead space, overlap, or document-level horizontal overflow.
- Keyboard, screen-reader, contrast, reduced-motion, offline, and stale-state guarantees remain
  green.
- No plaintext, passphrase, derived key, or packet is persisted or added to the URL.
- The page is materially shorter in its default state, while all current technical evidence is
  still reachable.

## What I would not change

- Do not replace the real cryptography with a faster simulation.
- Do not soften or hide the three limitations.
- Do not market this as production-ready or add vague security language.
- Do not remove the transition/count tables; demote them to evidence.
- Do not add a backend, analytics, external fonts, or a mandatory CDN dependency.
- Do not add 3D, decorative canvas effects, or more introductory prose.
- Do not weaken the current claims and accessibility gates to accommodate the redesign.

The underlying work already earns trust. The 10/10 move is to let visitors feel the result first,
then give them unusually strong reasons to trust what they just saw.