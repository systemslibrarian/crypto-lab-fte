/**
 * The guided path.
 *
 * The six numbered sections are already in the right order; nothing walked the
 * reader along them. That mattered most at the far end — the honest limitations
 * sit past seven viewports on a phone, which is exactly where the people who
 * most need them stop scrolling. So the path deliberately ENDS there, on what
 * the construction does not do, rather than on the encode that makes it look
 * good.
 *
 * Steps are data, not behaviour: each names an element to scroll to and a
 * sentence saying why the reader is looking at it. The controller does the
 * scrolling and the focusing, and honours `prefers-reduced-motion` when it does.
 */

export interface TourStep {
  title: string;
  body: string;
  /** Element scrolled into view and given focus for this step. */
  target: string;
}

export const TOUR: TourStep[] = [
  {
    title: "Choose the shape",
    body:
      "Everything starts with a regular expression. This one describes a North American phone number. The automaton, the capacity and the count table below all recompile as you type — change a digit count and watch every number on the page move.",
    target: "format-heading"
  },
  {
    title: "Meet the automaton",
    body:
      "The regex is compiled to a minimal DFA. Every circle is a state the counting arithmetic has a column for, and the double ring is where a string is allowed to end. This picture is not an illustration — it is the thing that produces the output.",
    target: "dfa-heading"
  },
  {
    title: "Count the language",
    body:
      "C[q0][k] counts the strings of length exactly k the automaton accepts. floor(log2 C) is how many whole bits one of those strings can carry. For this phone format that is 33 bits — four bytes of message plus the frame byte already overflow it.",
    target: "counts-heading"
  },
  {
    title: "Encode something",
    body:
      "Real PBKDF2 and AES-CTR, then FF1 cycle-walked into [0, N), then unranked back into a string. Press Encode and follow the pipeline: your message becomes an integer, the integer is enciphered, and the enciphered integer is looked up as a phone number.",
    target: "encode-heading"
  },
  {
    title: "Run the adversary",
    body:
      "Now the point of all of it. The same ciphertext goes to a regex classifier three ways. The stego string passes; the hex and base64 encodings of the identical bytes are flagged. That gap is the entire product.",
    target: "classifier-heading"
  },
  {
    title: "Get it back",
    body:
      "Ranking is a bijection, so the whole pipeline runs backwards. Note what has to travel out of band: the pattern, n, and the salt. The stego string has no room for them — every character is spoken for by the regex.",
    target: "decode-heading"
  },
  {
    title: "Now the honest part",
    body:
      "A regex classifier is beaten. A human is not. Play Spot the fake below, then read the three limitations — uniform is not realistic, length leaks, and there is no MAC. This is the step the demo exists for.",
    target: "limits-heading"
  }
];
