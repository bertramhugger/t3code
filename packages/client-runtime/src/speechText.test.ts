import { describe, expect, it } from "vite-plus/test";

import { markdownToSpeechText } from "./speechText.ts";

describe("markdownToSpeechText", () => {
  it("keeps prose and drops code blocks, images, and markup", () => {
    const markdown = [
      "## Summary",
      "",
      "I updated **`server.ts`** and [the docs](https://example.com/docs).",
      "",
      "```ts",
      "const secret = 1;",
      "```",
      "",
      "- First change",
      "- Second change!",
      "",
      "![diagram](diagram.png)",
    ].join("\n");

    expect(markdownToSpeechText(markdown)).toBe(
      ["Summary.", "I updated server.ts and the docs.", "First change.", "Second change!"].join(
        "\n",
      ),
    );
  });

  it("returns an empty string for code-only responses", () => {
    expect(markdownToSpeechText("```sh\nls -la\n```")).toBe("");
  });
});
