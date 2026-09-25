import {
  TEXT_TO_SPEECH_MAX_CHARS,
  TextToSpeechError,
  type TextToSpeechSettings,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

const SYNTHESIZE_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
// Google rejects `input.text` over 5000 bytes; leave headroom for multibyte text.
const MAX_CHUNK_BYTES = 4_500;
const DEFAULT_LANGUAGE_CODE = "en-US";

const decodeSynthesizeResponse = Schema.decodeUnknownEffect(
  Schema.Struct({ audioContent: Schema.String }),
);

const byteLength = (text: string) => Buffer.byteLength(text, "utf8");

/**
 * Splits text into request-sized chunks, preferring sentence boundaries and
 * falling back to word boundaries for a sentence that is too long by itself.
 */
export function chunkTextForSpeech(text: string, maxBytes = MAX_CHUNK_BYTES): string[] {
  const chunks: string[] = [];
  let current = "";
  const push = (piece: string) => {
    const candidate = current.length > 0 ? `${current} ${piece}` : piece;
    if (byteLength(candidate) <= maxBytes) {
      current = candidate;
      return;
    }
    if (current.length > 0) chunks.push(current);
    current = piece;
  };
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const trimmed = sentence.trim();
    if (trimmed.length === 0) continue;
    if (byteLength(trimmed) <= maxBytes) {
      push(trimmed);
      continue;
    }
    for (const word of trimmed.split(/\s+/)) {
      // A single "word" over the limit (a long URL, say) is cut by characters,
      // sized so even four-byte characters fit.
      const step = Math.floor(maxBytes / 4);
      for (let start = 0; start < word.length; start += step) {
        push(word.slice(start, start + step));
      }
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Voice names lead with their language, e.g. `en-GB-Neural2-A` is `en-GB`. */
function languageCodeForVoice(voice: string): string {
  const [language, region] = voice.split("-");
  return language && region ? `${language}-${region}` : DEFAULT_LANGUAGE_CODE;
}

function failureDetail(status: number | null): string {
  if (status === 400) return "Google could not read this text with the selected voice.";
  if (status === 401 || status === 403) {
    return "Google rejected the API key. Check the key and that the Cloud Text-to-Speech API is enabled for its project.";
  }
  if (status === 429) return "Google Text-to-Speech quota exceeded. Try again later.";
  return "The Google Text-to-Speech request failed.";
}

export const makeGoogleTextToSpeech = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;

  const synthesizeChunk = (apiKey: string, voice: string, text: string) =>
    client
      .execute(
        HttpClientRequest.post(SYNTHESIZE_URL).pipe(
          HttpClientRequest.setHeader("x-goog-api-key", apiKey),
          HttpClientRequest.bodyJsonUnsafe({
            input: { text },
            voice:
              voice.length > 0
                ? { languageCode: languageCodeForVoice(voice), name: voice }
                : { languageCode: DEFAULT_LANGUAGE_CODE },
            audioConfig: { audioEncoding: "MP3" },
          }),
        ),
      )
      .pipe(
        Effect.timeout("30 seconds"),
        // Google's error bodies can echo request details; never forward them.
        Effect.mapError(() => new TextToSpeechError({ detail: failureDetail(null) })),
        Effect.flatMap((response) =>
          response.status >= 200 && response.status < 300
            ? response.json.pipe(
                Effect.flatMap(decodeSynthesizeResponse),
                Effect.mapError(() => new TextToSpeechError({ detail: failureDetail(null) })),
              )
            : Effect.fail(new TextToSpeechError({ detail: failureDetail(response.status) })),
        ),
        Effect.map((body) => Buffer.from(body.audioContent, "base64")),
      );

  /** Synthesizes `text` as one MP3, returned base64-encoded. */
  const synthesize = Effect.fn("GoogleTextToSpeech.synthesize")(function* (
    settings: TextToSpeechSettings,
    text: string,
  ) {
    if (settings.googleApiKey.length === 0) {
      return yield* new TextToSpeechError({
        detail: "Add a Google Cloud API key in Settings to read responses aloud.",
      });
    }
    const chunks = chunkTextForSpeech(text.slice(0, TEXT_TO_SPEECH_MAX_CHARS));
    // MP3 frames are self-delimiting, so per-chunk files concatenate into one playable file.
    const audio = yield* Effect.forEach(
      chunks,
      (chunk) => synthesizeChunk(settings.googleApiKey, settings.voice, chunk),
      { concurrency: 4 },
    );
    return { audioContent: Buffer.concat(audio).toString("base64") };
  });

  return { synthesize };
});
