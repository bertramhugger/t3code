import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { chunkTextForSpeech, makeGoogleTextToSpeech } from "./googleTextToSpeech.ts";

const RequestBody = Schema.Struct({
  input: Schema.Struct({ text: Schema.String }),
  voice: Schema.Struct({ languageCode: Schema.String, name: Schema.optional(Schema.String) }),
  audioConfig: Schema.Struct({ audioEncoding: Schema.String }),
});
const decodeRequest = Schema.decodeUnknownSync(Schema.fromJsonString(RequestBody));

function fixture(respond: (text: string) => Response) {
  const requests: Array<typeof RequestBody.Type> = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      expect(request.headers["x-goog-api-key"]).toBe("google-key");
      const body = decodeRequest(
        request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
      );
      requests.push(body);
      return HttpClientResponse.fromWeb(request, respond(body.input.text));
    }),
  );
  return {
    requests,
    tts: makeGoogleTextToSpeech.pipe(Effect.provideService(HttpClient.HttpClient, http)),
  };
}

const settings = { googleApiKey: "google-key", voice: "en-GB-Neural2-A" };
const audioFor = (text: string) =>
  Response.json({ audioContent: Buffer.from(`[${text}]`).toString("base64") });

describe("chunkTextForSpeech", () => {
  it("keeps sentences whole and within the byte limit", () => {
    const chunks = chunkTextForSpeech("One two. Three four! Five six?", 12);
    expect(chunks).toEqual(["One two.", "Three four!", "Five six?"]);
  });

  it("splits a sentence longer than the limit on words, then characters", () => {
    const chunks = chunkTextForSpeech(`alpha beta ${"x".repeat(30)}`, 16);
    expect(chunks.every((chunk) => Buffer.byteLength(chunk) <= 16)).toBe(true);
    expect(chunks.join("").replaceAll(" ", "")).toBe(`alphabeta${"x".repeat(30)}`);
  });
});

describe("makeGoogleTextToSpeech", () => {
  it.effect("sends the voice and joins chunk audio in order", () =>
    Effect.gen(function* () {
      const test = fixture(audioFor);
      const tts = yield* test.tts;
      const text = `${"a".repeat(3000)}. ${"b".repeat(3000)}.`;
      const result = yield* tts.synthesize(settings, text);
      expect(test.requests.map((request) => request.voice)).toEqual([
        { languageCode: "en-GB", name: "en-GB-Neural2-A" },
        { languageCode: "en-GB", name: "en-GB-Neural2-A" },
      ]);
      expect(Buffer.from(result.audioContent, "base64").toString()).toBe(
        `[${"a".repeat(3000)}.][${"b".repeat(3000)}.]`,
      );
    }),
  );

  it.effect("fails without a key and never calls Google", () =>
    Effect.gen(function* () {
      const test = fixture(audioFor);
      const tts = yield* test.tts;
      const error = yield* Effect.flip(tts.synthesize({ googleApiKey: "", voice: "" }, "Hi."));
      expect(error.detail).toContain("API key");
      expect(test.requests).toHaveLength(0);
    }),
  );

  it.effect("explains a rejected key without publishing Google's error body", () =>
    Effect.gen(function* () {
      const test = fixture(() =>
        Response.json({ error: { message: "do-not-publish" } }, { status: 403 }),
      );
      const tts = yield* test.tts;
      const error = yield* Effect.flip(tts.synthesize(settings, "Hi."));
      expect(error.detail).toContain("rejected the API key");
      expect(error.detail).not.toContain("do-not-publish");
    }),
  );
});
