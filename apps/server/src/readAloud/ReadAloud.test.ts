import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { ReadAloudSettings } from "@t3tools/contracts";
import { HttpClient, type HttpClientRequest, HttpClientResponse } from "effect/http";

import * as ServerSettings from "../serverSettings.ts";
import * as ReadAloud from "./ReadAloud.ts";

describe("speechTextFromMarkdown", () => {
  it("drops code and markup but keeps the prose", () => {
    expect(
      ReadAloud.speechTextFromMarkdown(
        [
          "## Summary",
          "",
          "I changed **two files** in `apps/web` and fixed *one* bug.",
          "",
          "```ts",
          "const x = 1;",
          "```",
          "",
          "- See [the docs](https://example.com) for details.",
          "1. Run the tests.",
          "",
          "> Note: snake_case_names stay intact.",
          "",
          "| File | Change |",
          "| --- | --- |",
          "| a.ts | added |",
        ].join("\n"),
      ),
    ).toBe(
      [
        "Summary",
        "",
        "I changed two files in apps/web and fixed one bug.",
        "",
        "See the docs for details.",
        "Run the tests.",
        "",
        "Note: snake_case_names stay intact.",
        "",
        "File, Change",
        "a.ts, added",
      ].join("\n"),
    );
  });
});

describe("splitSpeechChunks", () => {
  it("packs sentences under the byte limit without splitting them", () => {
    expect(ReadAloud.splitSpeechChunks("One two. Three four! Five six?", 15)).toEqual([
      "One two.",
      "Three four!",
      "Five six?",
    ]);
    expect(ReadAloud.splitSpeechChunks("One. Two. Three.", 20)).toEqual(["One. Two. Three."]);
  });

  it("splits an oversized sentence on words", () => {
    const chunks = ReadAloud.splitSpeechChunks("alpha beta gamma delta epsilon", 12);
    expect(chunks).toEqual(["alpha beta", "gamma delta", "epsilon"]);
    expect(chunks.every((chunk) => Buffer.byteLength(chunk) <= 12)).toBe(true);
  });

  it("counts multi-byte characters as bytes", () => {
    const chunks = ReadAloud.splitSpeechChunks("æøå æøå æøå", 12);
    expect(chunks.every((chunk) => Buffer.byteLength(chunk) <= 12)).toBe(true);
    expect(chunks.join(" ")).toBe("æøå æøå æøå");
  });
});

const DEFAULT_READ_ALOUD = Schema.decodeSync(ReadAloudSettings)({});
const readAloudSettings = (overrides: Partial<ReadAloudSettings> = {}) => ({
  ...DEFAULT_READ_ALOUD,
  ...overrides,
});

describe("synthesizeRequestBody", () => {
  it("speaks a named voice in its own language", () => {
    expect(
      ReadAloud.synthesizeRequestBody(
        readAloudSettings({ voice: "da-DK-Wavenet-F", languageCode: "en-US" }),
        "Hej.",
      ).voice,
    ).toEqual({ languageCode: "da-DK", name: "da-DK-Wavenet-F" });
    expect(ReadAloud.synthesizeRequestBody(readAloudSettings(), "Hi.").voice).toEqual({
      languageCode: "en-US",
    });
  });

  it("sends a Gemini voice its model, chosen language, and style prompt", () => {
    const body = ReadAloud.synthesizeRequestBody(
      readAloudSettings({
        voice: "Kore",
        languageCode: "da-DK",
        stylePrompt: "Calm and warm.",
        geminiModel: "gemini-2.5-pro-tts",
        speakingRate: 1.5,
        pitch: 4,
      }),
      "Hej.",
    );
    expect(body.input).toEqual({ text: "Hej.", prompt: "Calm and warm." });
    expect(body.voice).toEqual({
      languageCode: "da-DK",
      name: "Kore",
      modelName: "gemini-2.5-pro-tts",
    });
    // Gemini voices take pace from the prompt; Google rejects pitch.
    expect(body.audioConfig).toEqual({ audioEncoding: "MP3" });
  });

  it("only sends the options a voice accepts", () => {
    const tuned = { speakingRate: 1.25, pitch: -3, stylePrompt: "Excited." };
    expect(
      ReadAloud.synthesizeRequestBody(
        readAloudSettings({ ...tuned, voice: "en-US-Chirp3-HD-Kore" }),
        "Hi.",
      ),
    ).toMatchObject({ input: { text: "Hi." }, audioConfig: { speakingRate: 1.25 } });
    expect(
      ReadAloud.synthesizeRequestBody(
        readAloudSettings({ ...tuned, voice: "en-US-Chirp3-HD-Kore" }),
        "Hi.",
      ).audioConfig,
    ).not.toHaveProperty("pitch");
    expect(
      ReadAloud.synthesizeRequestBody(
        readAloudSettings({ ...tuned, voice: "en-US-Neural2-F" }),
        "Hi.",
      ).audioConfig,
    ).toEqual({ audioEncoding: "MP3", speakingRate: 1.25, pitch: -3 });
  });
});

describe("voiceListForLanguage", () => {
  it("keeps the language's voices plus every Gemini voice", () => {
    const list = ReadAloud.voiceListForLanguage(
      [
        { name: "Kore", languageCodes: ["en-US"], ssmlGender: "FEMALE" },
        { name: "da-DK-Wavenet-F", languageCodes: ["da-DK"], ssmlGender: "FEMALE" },
        { name: "en-US-Neural2-D", languageCodes: ["en-US"], ssmlGender: "MALE" },
        { name: "fil-ph-Neural2-A", languageCodes: ["fil-PH"] },
      ],
      "da-DK",
    );
    expect(list.languageCodes).toEqual(["da-DK", "en-US", "fil-PH"]);
    expect(list.voices).toEqual([
      { name: "da-DK-Wavenet-F", gender: "female" },
      { name: "Kore", gender: "female" },
    ]);
  });
});

const googleClient = (
  respond: (request: HttpClientRequest.HttpClientRequest) => Response,
  requests: HttpClientRequest.HttpClientRequest[] = [],
) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      requests.push(request);
      return Effect.succeed(HttpClientResponse.fromWeb(request, respond(request)));
    }),
  );

describe("ReadAloud.synthesize", () => {
  it.effect("sends the stored key and voice and joins chunk audio in order", () => {
    const requests: HttpClientRequest.HttpClientRequest[] = [];
    let call = 0;
    return Effect.gen(function* () {
      const readAloud = yield* ReadAloud.make;
      const text = `${"a".repeat(4_000)}. ${"b".repeat(4_000)}.`;
      const result = yield* readAloud.synthesize(text);

      expect(requests).toHaveLength(2);
      expect(requests[0]!.headers["x-goog-api-key"]).toBe("test-key");
      expect(Buffer.from(result.audioContent, "base64").toString()).toBe("chunk0chunk1");
    }).pipe(
      Effect.provide([
        ServerSettings.layerTest({
          readAloud: { googleApiKey: "test-key", voice: "da-DK-Wavenet-A" },
        }),
        googleClient(
          () =>
            new Response(
              JSON.stringify({ audioContent: Buffer.from(`chunk${call++}`).toString("base64") }),
            ),
          requests,
        ),
      ]),
    );
  });

  it.effect("refuses without an API key and never calls Google", () =>
    Effect.gen(function* () {
      const readAloud = yield* ReadAloud.make;
      const error = yield* Effect.flip(readAloud.synthesize("Hello."));
      expect(error.detail).toContain("Google Cloud API key");
    }).pipe(
      Effect.provide([
        ServerSettings.layerTest(),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("Unexpected network request")),
        ),
      ]),
    ),
  );

  it.effect("surfaces Google's error message", () =>
    Effect.gen(function* () {
      const readAloud = yield* ReadAloud.make;
      const error = yield* Effect.flip(readAloud.synthesize("Hello."));
      expect(error.detail).toBe("Google Text-to-Speech: API key not valid.");
    }).pipe(
      Effect.provide([
        ServerSettings.layerTest({ readAloud: { googleApiKey: "bad-key" } }),
        googleClient(
          () =>
            new Response(JSON.stringify({ error: { message: "API key not valid." } }), {
              status: 400,
            }),
        ),
      ]),
    ),
  );

  it.effect("lists voices with the stored key", () => {
    const requests: HttpClientRequest.HttpClientRequest[] = [];
    return Effect.gen(function* () {
      const readAloud = yield* ReadAloud.make;
      const list = yield* readAloud.listVoices("en-US");
      expect(requests[0]!.url).toBe("https://texttospeech.googleapis.com/v1/voices");
      expect(requests[0]!.headers["x-goog-api-key"]).toBe("test-key");
      expect(list.voices).toEqual([{ name: "en-US-Neural2-F", gender: "female" }]);
    }).pipe(
      Effect.provide([
        ServerSettings.layerTest({ readAloud: { googleApiKey: "test-key" } }),
        googleClient(
          () =>
            new Response(
              JSON.stringify({
                voices: [
                  { name: "en-US-Neural2-F", languageCodes: ["en-US"], ssmlGender: "FEMALE" },
                  { name: "da-DK-Wavenet-F", languageCodes: ["da-DK"], ssmlGender: "FEMALE" },
                ],
              }),
            ),
          requests,
        ),
      ]),
    );
  });
});
