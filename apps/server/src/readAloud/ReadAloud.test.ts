import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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

describe("voiceSelection", () => {
  it("derives the language from the voice name", () => {
    expect(ReadAloud.voiceSelection("")).toEqual({ languageCode: "en-US" });
    expect(ReadAloud.voiceSelection("da-DK-Wavenet-A")).toEqual({
      languageCode: "da-DK",
      name: "da-DK-Wavenet-A",
    });
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
});
