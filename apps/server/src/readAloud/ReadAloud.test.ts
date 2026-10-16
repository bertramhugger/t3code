import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
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

/** The sentence a Google request asks for, read back from its JSON body. */
const requestText = (request: HttpClientRequest.HttpClientRequest) =>
  request.body._tag === "Uint8Array"
    ? (JSON.parse(new TextDecoder().decode(request.body.body)) as { input: { text: string } }).input
        .text
    : "";

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
  it.effect("streams each sentence's audio in reading order with the stored key", () => {
    const requests: HttpClientRequest.HttpClientRequest[] = [];
    return Effect.gen(function* () {
      const readAloud = yield* ReadAloud.make;
      const sentences = yield* Stream.runCollect(readAloud.synthesize("First one. Second one."));

      expect(requests).toHaveLength(2);
      expect(requests[0]!.headers["x-goog-api-key"]).toBe("test-key");
      expect(
        sentences.map((sentence) => ({
          index: sentence.index,
          text: sentence.text,
          audio: Buffer.from(sentence.audioContent, "base64").toString(),
          mimeType: sentence.mimeType,
        })),
      ).toEqual([
        { index: 0, text: "First one.", audio: "audio for First one.", mimeType: "audio/mpeg" },
        { index: 1, text: "Second one.", audio: "audio for Second one.", mimeType: "audio/mpeg" },
      ]);
    }).pipe(
      Effect.provide([
        ServerSettings.layerTest({
          readAloud: { googleApiKey: "test-key", voice: "da-DK-Wavenet-A" },
        }),
        googleClient(
          (request) =>
            new Response(
              JSON.stringify({
                audioContent: Buffer.from(`audio for ${requestText(request)}`).toString("base64"),
              }),
            ),
          requests,
        ),
      ]),
    );
  });

  it.effect("refuses without an API key and never calls Google", () =>
    Effect.gen(function* () {
      const readAloud = yield* ReadAloud.make;
      const error = yield* Effect.flip(Stream.runDrain(readAloud.synthesize("Hello.")));
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
      const error = yield* Effect.flip(Stream.runDrain(readAloud.synthesize("Hello.")));
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

  it.effect("reads with OpenAI, streaming the MP3 it sends per sentence", () => {
    const requests: HttpClientRequest.HttpClientRequest[] = [];
    return Effect.gen(function* () {
      const readAloud = yield* ReadAloud.make;
      const sentences = yield* Stream.runCollect(readAloud.synthesize("First. Second."));
      expect(requests.map((request) => request.url)).toEqual([
        "https://api.openai.com/v1/audio/speech",
        "https://api.openai.com/v1/audio/speech",
      ]);
      expect(requests[0]!.headers.authorization).toBe("Bearer sk-test");
      expect(sentences.map((sentence) => [sentence.text, sentence.mimeType])).toEqual([
        ["First.", "audio/mpeg"],
        ["Second.", "audio/mpeg"],
      ]);
      expect(Buffer.from(sentences[0]!.audioContent, "base64").toString()).toBe("mp3 bytes");
    }).pipe(
      Effect.provide([
        ServerSettings.layerTest({ readAloud: { provider: "openai", openaiApiKey: "sk-test" } }),
        googleClient(() => new Response("mp3 bytes"), requests),
      ]),
    );
  });

  it.effect("asks for the chosen service's key", () =>
    Effect.gen(function* () {
      const readAloud = yield* ReadAloud.make;
      const error = yield* Effect.flip(Stream.runDrain(readAloud.synthesize("Hello.")));
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
