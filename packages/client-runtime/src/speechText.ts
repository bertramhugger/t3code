import remarkParse from "remark-parse";
import { unified } from "unified";

interface MarkdownNode {
  readonly type: string;
  readonly value?: string;
  readonly children?: ReadonlyArray<MarkdownNode>;
}

const parser = unified().use(remarkParse);

// Nodes that read badly as speech: source code, raw HTML, images, and link definitions.
const SILENT_NODES = new Set(["code", "html", "image", "imageReference", "definition"]);
const SENTENCE_END = /[.!?:;]$/;

function inlineText(node: MarkdownNode): string {
  if (SILENT_NODES.has(node.type)) return "";
  if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";
  if (node.type === "break") return " ";
  return (node.children ?? []).map(inlineText).join("");
}

function collectBlocks(node: MarkdownNode, blocks: string[]): void {
  if (SILENT_NODES.has(node.type) || node.type === "thematicBreak") return;
  if (node.type === "paragraph" || node.type === "heading") {
    const text = inlineText(node).replace(/\s+/g, " ").trim();
    // A heading or list item without punctuation would run into the next sentence.
    if (text.length > 0) blocks.push(SENTENCE_END.test(text) ? text : `${text}.`);
    return;
  }
  for (const child of node.children ?? []) collectBlocks(child, blocks);
}

/**
 * Reduces assistant markdown to the prose worth speaking: headings,
 * paragraphs, and list items keep their text (link text, inline code), while
 * code blocks, images, and markup are dropped.
 */
export function markdownToSpeechText(markdown: string): string {
  const blocks: string[] = [];
  collectBlocks(parser.parse(markdown) as MarkdownNode, blocks);
  return blocks.join("\n");
}
