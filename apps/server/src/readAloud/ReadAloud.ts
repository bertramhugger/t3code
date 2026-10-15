/**
 * ReadAloud — turns an assistant message into speech with Google Cloud
 * Text-to-Speech, using the API key stored in `settings.readAloud`.
 *
 * The key never leaves the server: clients send the message text and get MP3
 * audio back, so a phone or a remote browser can read aloud without holding
 * the credential. Markdown is reduced to plain prose first, and long messages
 * are split under Google's 5000-byte request limit and joined back into one
 * MP3 stream.
 *
 * @module readAloud/ReadAloud
 */
import { ReadAloudError, type ReadAloudSynthesizeResult } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as Settings from "../serverSettings.ts";

const SYNTHESIZE_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
// Google caps `input.text` at 5000 bytes; leave headroom for multi-byte text.
const MAX_CHUNK_BYTES = 4_500;
const DEFAULT_LANGUAGE_CODE = "en-US";

export class ReadAloud extends Context.Service<
  ReadAloud,
  {
    readonly synthesize: (text: string) => Effect.Effect<ReadAloudSynthesizeResult, ReadAloudError>;
  }
>()("t3/readAloud/ReadAloud") {}

/** Reduces assistant markdown to what a listener wants to hear. Code blocks are dropped. */
export function speechTextFromMarkdown(markdown: string): string {
  return markdown
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/^[ \t]*\|?([ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*:?-*:?[ \t]*\n?/gm, "")
    .replace(/^[ \t]*\|[ \t]*(.*?)[ \t]*\|[ \t]*$/gm, "$1")
    .replace(/[ \t]*\|[ \t]*/g, ", ")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const byteLength = (text: string) => Buffer.byteLength(text, "utf8");

/** Packs sentences into chunks of at most `maxBytes`, splitting oversized ones on words. */
export function splitSpeechChunks(text: string, maxBytes = MAX_CHUNK_BYTES): string[] {
  const pieces = text
    .split(/\n{2,}/)
    .flatMap((paragraph) => paragraph.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)
    .flatMap((sentence) => splitOversized(sentence, maxBytes));
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const next = current.length === 0 ? piece : `${current} ${piece}`;
    if (byteLength(next) <= maxBytes) {
      current = next;
    } else {
      chunks.push(current);
      current = piece;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function splitOversized(sentence: string, maxBytes: number): string[] {
  if (byteLength(sentence) <= maxBytes) return [sentence];
  const parts: string[] = [];
  let current = "";
  for (const char of sentence) {
    if (byteLength(current + char) > maxBytes) {
      const cut = current.lastIndexOf(" ");
      const head = cut > 0 ? current.slice(0, cut) : current;
      parts.push(head.trim());
      current = (cut > 0 ? current.slice(cut + 1) : "") + char;
    } else {
      current += char;
    }
  }
  if (current.trim().length > 0) parts.push(current.trim());
  return parts;
}

/** `da-DK-Wavenet-A` speaks `da-DK`; Google rejects a voice whose language does not match. */
export function voiceSelection(voice: string): { languageCode: string; name?: string } {
  if (voice.length === 0) return { languageCode: DEFAULT_LANGUAGE_CODE };
  const languageCode = /^([a-z]{2,3}-[A-Z]{2})-/.exec(voice)?.[1] ?? DEFAULT_LANGUAGE_CODE;
  return { languageCode, name: voice };
}

const SynthesizeResponse = Schema.Struct({ audioContent: Schema.String });
const GoogleErrorResponse = Schema.Struct({
  error: Schema.Struct({ message: Schema.String }),
});
const decodeSynthesizeResponse = Schema.decodeUnknownEffect(SynthesizeResponse);
const decodeGoogleError = Schema.decodeUnknownOption(GoogleErrorResponse);

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const settingsService = yield* Settings.ServerSettingsService;

  const synthesizeChunk = Effect.fn("ReadAloud.synthesizeChunk")(function* (
    apiKey: string,
    voice: string,
    text: string,
  ) {
    const request = HttpClientRequest.post(SYNTHESIZE_URL).pipe(
      HttpClientRequest.setHeader("X-Goog-Api-Key", apiKey),
      HttpClientRequest.bodyJsonUnsafe({
        input: { text },
        voice: voiceSelection(voice),
        audioConfig: { audioEncoding: "MP3" },
      }),
    );
    const response = yield* client.execute(request).pipe(
      Effect.timeout("30 seconds"),
      Effect.mapError(
        () => new ReadAloudError({ detail: "Couldn't reach Google Text-to-Speech." }),
      ),
    );
    const body = yield* response.json.pipe(
      Effect.mapError(
        () => new ReadAloudError({ detail: "Google Text-to-Speech sent an unreadable reply." }),
      ),
    );
    if (response.status < 200 || response.status >= 300) {
      const googleError = decodeGoogleError(body);
      return yield* new ReadAloudError({
        detail:
          googleError._tag === "Some"
            ? `Google Text-to-Speech: ${googleError.value.error.message}`
            : `Google Text-to-Speech failed with status ${response.status}.`,
      });
    }
    const decoded = yield* decodeSynthesizeResponse(body).pipe(
      Effect.mapError(() => new ReadAloudError({ detail: "Google Text-to-Speech sent no audio." })),
    );
    return Buffer.from(decoded.audioContent, "base64");
  });

  const synthesize = Effect.fn("ReadAloud.synthesize")(function* (text: string) {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(() => new ReadAloudError({ detail: "Couldn't read the server settings." })),
    );
    const { googleApiKey, voice } = settings.readAloud;
    if (googleApiKey.length === 0) {
      return yield* new ReadAloudError({
        detail: "Add a Google Cloud API key under Settings → Integrations to read messages aloud.",
      });
    }
    const chunks = splitSpeechChunks(speechTextFromMarkdown(text));
    if (chunks.length === 0) {
      return yield* new ReadAloudError({ detail: "This message has nothing to read aloud." });
    }
    // MP3 frames are self-delimiting, so per-chunk audio joins into one playable stream.
    const audio = yield* Effect.forEach(
      chunks,
      (chunk) => synthesizeChunk(googleApiKey, voice, chunk),
      { concurrency: 4 },
    );
    return { audioContent: Buffer.concat(audio).toString("base64") };
  });

  return { synthesize } satisfies ReadAloud["Service"];
});

export const layer = Layer.effect(ReadAloud, make);
