import { describe, expect, it } from "vite-plus/test";

import { describeVoice, effectiveLanguage, voiceOptions } from "./readAloudVoices";

describe("describeVoice", () => {
  it("names voices the way Google's catalog groups them", () => {
    expect(describeVoice({ name: "Kore", gender: "female" })).toMatchObject({
      label: "Kore",
      detail: "Gemini · female",
    });
    expect(describeVoice({ name: "en-US-Chirp3-HD-Kore" })).toMatchObject({
      label: "Kore",
      kind: "Chirp 3 HD",
    });
    expect(describeVoice({ name: "da-DK-Wavenet-F", gender: "female" })).toMatchObject({
      label: "WaveNet F",
      detail: "WaveNet · female",
    });
    expect(describeVoice({ name: "fil-ph-Neural2-A" }).label).toBe("Neural2 A");
  });
});

describe("voiceOptions", () => {
  it("lists expressive families first, then by name", () => {
    expect(
      voiceOptions([
        { name: "en-US-Standard-B", gender: "male" },
        { name: "en-US-Chirp3-HD-Puck", gender: "male" },
        { name: "Puck", gender: "male" },
        { name: "en-US-Chirp3-HD-Kore", gender: "female" },
        { name: "en-US-Neural2-F", gender: "female" },
      ]).map((option) => option.name),
    ).toEqual([
      "Puck",
      "en-US-Chirp3-HD-Kore",
      "en-US-Chirp3-HD-Puck",
      "en-US-Neural2-F",
      "en-US-Standard-B",
    ]);
  });
});

describe("effectiveLanguage", () => {
  it("prefers the language a voice is named for", () => {
    expect(effectiveLanguage("da-DK-Wavenet-F", "en-US")).toBe("da-DK");
    expect(effectiveLanguage("Kore", "da-DK")).toBe("da-DK");
    expect(effectiveLanguage("", "")).toBe("en-US");
  });
});
