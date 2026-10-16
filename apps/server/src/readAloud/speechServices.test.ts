import { describe, expect, it } from "@effect/vitest";
import { ReadAloudSettings } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import * as SpeechServices from "./speechServices.ts";

const DEFAULT_READ_ALOUD = Schema.decodeSync(ReadAloudSettings)({});
const settings = (overrides: Partial<ReadAloudSettings> = {}) => ({
  ...DEFAULT_READ_ALOUD,
  ...overrides,
});

describe("openAiSpeechBody", () => {
  it("sends the reading style to gpt-4o-mini-tts", () => {
    expect(
      SpeechServices.openAiSpeechBody(
        settings({ openaiVoice: "marin", openaiInstructions: "Calm and warm.", speakingRate: 1.5 }),
        "Hi.",
      ),
    ).toEqual({
      model: "gpt-4o-mini-tts",
      input: "Hi.",
      voice: "marin",
      response_format: "mp3",
      speed: 1.5,
      instructions: "Calm and warm.",
    });
  });

  it("drops what the tts-1 models do not take", () => {
    expect(
      SpeechServices.openAiSpeechBody(
        settings({
          openaiModel: "tts-1-hd",
          openaiVoice: "marin",
          openaiInstructions: "Calm.",
          audioQuality: "high",
        }),
        "Hi.",
      ),
    ).toEqual({ model: "tts-1-hd", input: "Hi.", voice: "coral", response_format: "wav" });
  });
});

describe("elevenLabsSpeechRequest", () => {
  const sentences = ["One.", "Two.", "Three."];

  it("sends the neighbouring sentences and clamps speed to ElevenLabs' range", () => {
    expect(
      SpeechServices.elevenLabsSpeechRequest(
        settings({ elevenlabsVoiceId: "voice-1", speakingRate: 2 }),
        sentences,
        1,
      ),
    ).toEqual({
      url: "https://api.elevenlabs.io/v1/text-to-speech/voice-1?output_format=mp3_44100_128",
      body: {
        text: "Two.",
        model_id: "eleven_multilingual_v2",
        voice_settings: { speed: 1.2 },
        previous_text: "One.",
        next_text: "Three.",
      },
    });
  });

  it("uses the default voice and leaves context out for v3", () => {
    const request = SpeechServices.elevenLabsSpeechRequest(
      settings({ elevenlabsModel: "eleven_v3" }),
      sentences,
      1,
    );
    expect(request.url).toContain("/JBFqnCBsd6RMkjVDRZzb?");
    expect(request.body).toEqual({ text: "Two.", model_id: "eleven_v3" });
  });
});

describe("elevenLabsVoiceList", () => {
  it("names voices and describes them from their labels", () => {
    expect(
      SpeechServices.elevenLabsVoiceList([
        {
          voice_id: "b",
          name: "Rachel",
          labels: { gender: "female", accent: "american", descriptive: "calm" },
        },
        { voice_id: "a", name: "Adam", labels: null },
      ]),
    ).toEqual([
      { name: "a", label: "Adam", gender: null },
      { name: "b", label: "Rachel", gender: "female", description: "american, calm" },
    ]);
  });
});

describe("serviceError", () => {
  it("uses each service's own message", () => {
    expect(
      SpeechServices.serviceError(
        "openai",
        { error: { message: "Incorrect API key provided." } },
        401,
      ).detail,
    ).toBe("OpenAI: Incorrect API key provided.");
    expect(
      SpeechServices.serviceError(
        "elevenlabs",
        { detail: { status: "invalid_api_key", message: "Invalid API key" } },
        401,
      ).detail,
    ).toBe("ElevenLabs: Invalid API key");
    expect(SpeechServices.serviceError("elevenlabs", null, 500).detail).toBe(
      "ElevenLabs failed with status 500.",
    );
  });
});
