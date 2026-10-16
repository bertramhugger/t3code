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

describe("speechSentences", () => {
  it("splits prose into sentences and drops punctuation-only pieces", () => {
    expect(ReadAloud.speechSentences("One two. Three four!\n\nFive six? ...")).toEqual([
      "One two.",
      "Three four!",
      "Five six?",
    ]);
  });

  it("splits an oversized sentence on words", () => {
    const sentences = ReadAloud.speechSentences("alpha beta gamma delta epsilon", 12);
    expect(sentences).toEqual(["alpha beta", "gamma delta", "epsilon"]);
    expect(sentences.every((sentence) => Buffer.byteLength(sentence) <= 12)).toBe(true);
  });

  it("counts multi-byte characters as bytes", () => {
    const sentences = ReadAloud.speechSentences("æøå æøå æøå", 12);
    expect(sentences.every((sentence) => Buffer.byteLength(sentence) <= 12)).toBe(true);
    expect(sentences.join(" ")).toBe("æøå æøå æøå");
  });
});

describe("mp3Duration", () => {
  // MPEG-2 Layer III, 32 kbps, 24 kHz, mono: what Google sends. Each frame is 96 bytes and 24 ms.
  const frame = Buffer.concat([Buffer.from([0xff, 0xf3, 0x44, 0xc4]), Buffer.alloc(92)]);

  it("adds up frame lengths, past an ID3 tag", () => {
    const id3 = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 5, 1, 2, 3, 4, 5]);
    const file = Buffer.concat([id3, ...Array.from({ length: 50 }, () => frame)]);
    expect(ReadAloud.mp3Duration(file)).toBeCloseTo(1.2, 6);
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

  it("falls back to the default voice for a name without a language", () => {
    expect(
      ReadAloud.synthesizeRequestBody(
        readAloudSettings({ voice: "Kore", languageCode: "da-DK" }),
        "Hej.",
      ).voice,
    ).toEqual({ languageCode: "da-DK" });
  });

  it("only sends the options a voice accepts", () => {
    const tuned = { speakingRate: 1.25, pitch: -3 };
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
    expect(
      ReadAloud.synthesizeRequestBody(readAloudSettings({ audioQuality: "high" }), "Hi.")
        .audioConfig.audioEncoding,
    ).toBe("LINEAR16");
  });
});

describe("voiceListForLanguage", () => {
  it("keeps the language's voices and leaves out Gemini voices", () => {
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
    expect(list.voices).toEqual([{ name: "da-DK-Wavenet-F", gender: "female" }]);
  });
});

describe("joinWavChunks", () => {
  const wav = (samples: number[]) => {
    const data = Buffer.from(Int16Array.from(samples).buffer);
    const file = Buffer.alloc(44 + data.length);
    file.write("RIFF", 0, "ascii");
    file.writeUInt32LE(36 + data.length, 4);
    file.write("WAVEfmt ", 8, "ascii");
    file.writeUInt32LE(16, 16);
    file.writeUInt16LE(1, 20); // PCM
    file.writeUInt16LE(1, 22); // mono
    file.writeUInt32LE(24_000, 24);
    file.writeUInt32LE(48_000, 28);
    file.writeUInt16LE(2, 32);
    file.writeUInt16LE(16, 34);
    file.write("data", 36, "ascii");
    file.writeUInt32LE(data.length, 40);
    data.copy(file, 44);
    return file;
  };

  it("keeps one header and every chunk's samples, in order", () => {
    const joined = ReadAloud.joinWavChunks([wav([1, 2]), wav([3, 4, 5])]);
    expect(joined).toEqual(wav([1, 2, 3, 4, 5]));
  });

  it("measures a WAV by its sample bytes", () => {
    expect(ReadAloud.wavDuration(wav(Array.from({ length: 12_000 }, () => 0)))).toBe(0.5);
  });
});

describe("googleError", () => {
  it("turns a disabled API into a short message with its switch", () => {
    const activationUrl =
      "https://console.developers.google.com/apis/api/texttospeech.googleapis.com/overview?project=1";
    const error = ReadAloud.googleError(
      {
        error: {
          message:
            "Cloud Text-to-Speech API has not been used in project 1 before or it is disabled…",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.ErrorInfo",
              reason: "SERVICE_DISABLED",
              metadata: { activationUrl, serviceTitle: "Cloud Text-to-Speech API" },
            },
          ],
        },
      },
      403,
    );
    expect(error.actionUrl).toBe(activationUrl);
    expect(error.detail).toBe(
      "Cloud Text-to-Speech API is turned off in your Google Cloud project. Enable it, wait a minute, and try again.",
    );
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
      expect(result.mimeType).toBe("audio/mpeg");
      expect(result.segments.map((segment) => segment.text)).toHaveLength(2);
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
      const list = yield* readAloud.listVoices("google", "en-US");
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

  it.effect("reads with OpenAI, joining the MP3 it sends per sentence", () => {
    const requests: HttpClientRequest.HttpClientRequest[] = [];
    // One MPEG-2 Layer III frame: 96 bytes, 24 ms.
    const frame = Buffer.concat([Buffer.from([0xff, 0xf3, 0x44, 0xc4]), Buffer.alloc(92)]);
    return Effect.gen(function* () {
      const readAloud = yield* ReadAloud.make;
      const result = yield* readAloud.synthesize("First. Second.");
      expect(requests.map((request) => request.url)).toEqual([
        "https://api.openai.com/v1/audio/speech",
        "https://api.openai.com/v1/audio/speech",
      ]);
      expect(requests[0]!.headers.authorization).toBe("Bearer sk-test");
      expect(result.mimeType).toBe("audio/mpeg");
      expect(result.segments).toEqual([
        { text: "First.", start: 0 },
        { text: "Second.", start: expect.closeTo(0.024, 6) },
      ]);
    }).pipe(
      Effect.provide([
        ServerSettings.layerTest({ readAloud: { provider: "openai", openaiApiKey: "sk-test" } }),
        googleClient(() => new Response(frame), requests),
      ]),
    );
  });

  it.effect("asks for the chosen service's key", () =>
    Effect.gen(function* () {
      const readAloud = yield* ReadAloud.make;
      const error = yield* Effect.flip(readAloud.synthesize("Hello."));
      expect(error.detail).toBe(
        "Add an ElevenLabs API key under Settings → Integrations to read messages aloud.",
      );
    }).pipe(
      Effect.provide([
        ServerSettings.layerTest({
          readAloud: { provider: "elevenlabs", googleApiKey: "google-key" },
        }),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("Unexpected network request")),
        ),
      ]),
    ),
  );
});
