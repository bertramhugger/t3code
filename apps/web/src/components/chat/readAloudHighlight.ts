import type { ReadAloudSegment } from "@t3tools/contracts";

const HIGHLIGHT_NAME = "t3-read-aloud";
// Code is not read aloud, and toolbars are not part of the message.
const SKIPPED = "pre, svg, [data-thread-find-ignore], [role='toolbar']";
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/**
 * Letters and digits only, lowercased. Spoken text drops markdown, and rendered
 * text adds list markers and table cells, so only the words themselves line up.
 */
export function speechMatchKey(text: string): string {
  let key = "";
  for (const character of text) {
    if (WORD_CHARACTER.test(character)) key += character.toLowerCase();
  }
  return key;
}

/**
 * Where each segment sits in the message, searching forward from the previous
 * match so a repeated sentence lands on the right occurrence. Unfound segments
 * are null and do not move the search.
 */
export function locateSegments(
  haystack: string,
  segments: readonly string[],
): Array<{ start: number; end: number } | null> {
  let cursor = 0;
  return segments.map((segment) => {
    const needle = speechMatchKey(segment);
    if (needle.length === 0) return null;
    const start = haystack.indexOf(needle, cursor);
    if (start === -1) return null;
    cursor = start + needle.length;
    return { start, end: cursor };
  });
}

/** The message's text as a match key, with the DOM position of each key character. */
function indexMessageText(root: Element) {
  let key = "";
  const positions: Array<{ node: Text; offset: number }> = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest(SKIPPED) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const value = node.data;
    let offset = 0;
    for (const character of value) {
      if (WORD_CHARACTER.test(character)) {
        for (const lower of character.toLowerCase()) {
          key += lower;
          positions.push({ node, offset });
        }
      }
      offset += character.length;
    }
  }
  return { key, positions };
}

function messageTextRoot(messageKey: string): Element | null {
  return document.querySelector(
    `[data-timeline-row-kind="message"][data-message-id="${CSS.escape(messageKey)}"] [data-thread-find-text]`,
  );
}

/** The segment holding the character at `keyIndex`, or the next one when it falls between them. */
export function segmentAtKeyIndex(
  located: ReadonlyArray<{ start: number; end: number } | null>,
  keyIndex: number,
): number | null {
  let next: number | null = null;
  for (const [index, match] of located.entries()) {
    if (!match) continue;
    if (keyIndex >= match.start && keyIndex < match.end) return index;
    if (match.start > keyIndex && next === null) next = index;
  }
  return next;
}

/** The click's position in the message's match key, or null outside its text. */
export function speechKeyIndexAtPoint(messageKey: string, x: number, y: number): number | null {
  const root = messageTextRoot(messageKey);
  if (!root) return null;
  const caret = document.caretPositionFromPoint?.(x, y);
  const legacy = caret ? null : document.caretRangeFromPoint?.(x, y);
  const node = caret?.offsetNode ?? legacy?.startContainer;
  const offset = caret?.offset ?? legacy?.startOffset ?? 0;
  if (!node || !root.contains(node)) return null;
  const at = document.createRange();
  at.setStart(node, offset);
  const { positions } = indexMessageText(root);
  const index = positions.findIndex(
    (position) => at.comparePoint(position.node, position.offset) >= 0,
  );
  return index === -1 ? null : index;
}

/** Which segment a click landed in, given where it fell in the message's text. */
export function segmentAtSpeechKey(
  messageKey: string,
  segments: readonly ReadAloudSegment[],
  keyIndex: number,
): number | null {
  const root = messageTextRoot(messageKey);
  if (!root) return null;
  const { key } = indexMessageText(root);
  return segmentAtKeyIndex(
    locateSegments(
      key,
      segments.map((segment) => segment.text),
    ),
    keyIndex,
  );
}

let highlighted: Range | null = null;

/**
 * Paints the sentence being read in its rendered message, without touching the
 * markdown. A message scrolled out of the list simply shows nothing; the next
 * call finds it again once it is back.
 */
export function highlightSpokenSegment(
  messageKey: string,
  segments: readonly ReadAloudSegment[],
  index: number,
): void {
  if (typeof CSS === "undefined" || !CSS.highlights) return;
  const root = messageTextRoot(messageKey);
  const { key, positions } = root ? indexMessageText(root) : { key: "", positions: [] };
  const match = locateSegments(
    key,
    segments.slice(0, index + 1).map((segment) => segment.text),
  )[index];
  const first = match ? positions[match.start] : undefined;
  const last = match ? positions[match.end - 1] : undefined;
  if (!first || !last) {
    clearSpokenHighlight();
    return;
  }
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  // The end offset sits after the last matched character, which may be a surrogate pair.
  range.setEnd(
    last.node,
    last.offset + (last.node.data.codePointAt(last.offset)! > 0xffff ? 2 : 1),
  );
  highlighted = range;
  CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(range));
}

/** Whether the painted sentence is still on screen; virtualized rows unmount when scrolled away. */
export function spokenHighlightIsAttached(): boolean {
  return highlighted !== null && highlighted.startContainer.isConnected;
}

export function clearSpokenHighlight(): void {
  highlighted = null;
  if (typeof CSS !== "undefined" && CSS.highlights) CSS.highlights.delete(HIGHLIGHT_NAME);
}
