/**
 * ReadAloud — turns an assistant message into speech with Google Cloud
 * Text-to-Speech, using the API key stored in `settings.readAloud`.
 *
 * The key never leaves the server: clients send the message text and get MP3
 * audio back, and ask the server for the voice catalog, so a phone or a remote
 * browser can read aloud without holding the credential. Markdown is reduced to plain prose first, and long messages
 * are split under Google's 5000-byte request limit and joined back into one
 * MP3 stream.
 *
 * @module readAloud/ReadAloud
 */
import {
  READ_ALOUD_PITCH,
  READ_ALOUD_SPEAKING_RATE,
  ReadAloudError,
  type ReadAloudSettings,
  type ReadAloudSynthesizeResult,
  type ReadAloudVoice,
  type ReadAloudVoiceList,
  speechVoiceLanguage,
  speechVoiceOptions,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as Settings from "../serverSettings.ts";

const SYNTHESIZE_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
const VOICES_URL = "https://texttospeech.googleapis.com/v1/voices";
// Google caps `input.text` at 5000 bytes; leave headroom for multi-byte text.
const MAX_CHUNK_BYTES = 4_500;
const DEFAULT_LANGUAGE_CODE = "en-US";

export class ReadAloud extends Context.Service<
  ReadAloud,
  {
    readonly synthesize: (text: string) => Effect.Effect<ReadAloudSynthesizeResult, ReadAloudError>;
    readonly listVoices: (
      languageCode: string,
    ) => Effect.Effect<ReadAloudVoiceList, ReadAloudError>;
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

/**
 * The `voice` part of a request. A voice named for a language (`da-DK-Wavenet-A`)
 * must be sent with that language. A name without one (an old Gemini choice)
 * falls back to Google's default voice for the chosen language.
 */
export function voiceSelection(settings: Pick<ReadAloudSettings, "voice" | "languageCode">): {
  languageCode: string;
  name?: string;
} {
  const voiceLanguage = speechVoiceLanguage(settings.voice);
  if (voiceLanguage === null)
    return { languageCode: settings.languageCode || DEFAULT_LANGUAGE_CODE };
  return { languageCode: voiceLanguage, name: settings.voice };
}

/** The request body for one chunk, carrying only the options the voice accepts. */
export function synthesizeRequestBody(settings: ReadAloudSettings, text: string) {
  const options = speechVoiceOptions(settings.voice);
  return {
    input: { text },
    voice: voiceSelection(settings),
    audioConfig: {
      audioEncoding: "MP3",
      ...(options.speakingRate && settings.speakingRate !== READ_ALOUD_SPEAKING_RATE.default
        ? { speakingRate: settings.speakingRate }
        : {}),
      ...(options.pitch && settings.pitch !== READ_ALOUD_PITCH.default
        ? { pitch: settings.pitch }
        : {}),
    },
  };
}

const SynthesizeResponse = Schema.Struct({ audioContent: Schema.String });
const VoicesResponse = Schema.Struct({
  voices: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      languageCodes: Schema.Array(Schema.String),
      ssmlGender: Schema.optional(Schema.String),
    }),
  ),
});
const GoogleErrorResponse = Schema.Struct({
  error: Schema.Struct({
    message: Schema.String,
    details: Schema.optional(
      Schema.Array(
        Schema.Struct({
          reason: Schema.optional(Schema.String),
          metadata: Schema.optional(
            Schema.Struct({
              activationUrl: Schema.optional(Schema.String),
              serviceTitle: Schema.optional(Schema.String),
            }),
          ),
        }),
      ),
    ),
  }),
});
const decodeSynthesizeResponse = Schema.decodeUnknownEffect(SynthesizeResponse);
const decodeVoicesResponse = Schema.decodeUnknownEffect(VoicesResponse);
const decodeGoogleError = Schema.decodeUnknownOption(GoogleErrorResponse);

const VOICE_GENDERS = { FEMALE: "female", MALE: "male", NEUTRAL: "neutral" } as const;

/**
 * Narrows Google's catalog to one language. Gemini voices are left out: they
 * need OAuth credentials, which an API key cannot provide.
 */
export function voiceListForLanguage(
  voices: typeof VoicesResponse.Type.voices,
  languageCode: string,
): ReadAloudVoiceList {
  const wanted = languageCode.toLowerCase();
  const languageCodes = new Set<string>();
  const matching: ReadAloudVoice[] = [];
  for (const voice of voices) {
    if (speechVoiceLanguage(voice.name) === null) continue;
    for (const code of voice.languageCodes) languageCodes.add(code);
    if (voice.languageCodes.some((code) => code.toLowerCase() === wanted)) {
      matching.push({
        name: voice.name,
        gender: VOICE_GENDERS[voice.ssmlGender as keyof typeof VOICE_GENDERS] ?? null,
      });
    }
  }
  return {
    languageCodes: [...languageCodes].toSorted(),
    voices: matching.toSorted((left, right) => left.name.localeCompare(right.name)),
  };
}

/**
 * Google's message for a switched-off API is a paragraph with the link buried
 * in it; a toast cuts that off, so name the API and carry the link separately.
 */
export function googleError(body: unknown, status: number): ReadAloudError {
  const decoded = decodeGoogleError(body);
  if (decoded._tag === "None") {
    return new ReadAloudError({ detail: `Google Text-to-Speech failed with status ${status}.` });
  }
  const { message, details } = decoded.value.error;
  const disabled = details?.find((detail) => detail.reason === "SERVICE_DISABLED")?.metadata;
  if (disabled?.activationUrl) {
    const service = disabled.serviceTitle ?? "A required API";
    return new ReadAloudError({
      detail: `${service} is turned off in your Google Cloud project. Enable it, wait a minute, and try again.`,
      actionUrl: disabled.activationUrl,
    });
  }
  return new ReadAloudError({ detail: `Google Text-to-Speech: ${message}` });
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const settingsService = yield* Settings.ServerSettingsService;

  const readSettings = settingsService.getSettings.pipe(
    Effect.mapError(() => new ReadAloudError({ detail: "Couldn't read the server settings." })),
    Effect.flatMap(({ readAloud }) =>
      readAloud.googleApiKey.length === 0
        ? Effect.fail(
            new ReadAloudError({
              detail:
                "Add a Google Cloud API key under Settings → Integrations to read messages aloud.",
            }),
          )
        : Effect.succeed(readAloud),
    ),
  );

  /** Sends a request with the key and returns the JSON body, or Google's own error message. */
  const callGoogle = Effect.fn("ReadAloud.callGoogle")(function* (
    apiKey: string,
    request: HttpClientRequest.HttpClientRequest,
  ) {
    const response = yield* client
      .execute(request.pipe(HttpClientRequest.setHeader("X-Goog-Api-Key", apiKey)))
      .pipe(
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
      return yield* googleError(body, response.status);
    }
    return body;
  });

  const synthesizeChunk = Effect.fn("ReadAloud.synthesizeChunk")(function* (
    settings: ReadAloudSettings,
    text: string,
  ) {
    const body = yield* callGoogle(
      settings.googleApiKey,
      HttpClientRequest.post(SYNTHESIZE_URL).pipe(
        HttpClientRequest.bodyJsonUnsafe(synthesizeRequestBody(settings, text)),
      ),
    );
    const decoded = yield* decodeSynthesizeResponse(body).pipe(
      Effect.mapError(() => new ReadAloudError({ detail: "Google Text-to-Speech sent no audio." })),
    );
    return Buffer.from(decoded.audioContent, "base64");
  });

  const synthesize = Effect.fn("ReadAloud.synthesize")(function* (text: string) {
    const settings = yield* readSettings;
    const chunks = splitSpeechChunks(speechTextFromMarkdown(text));
    if (chunks.length === 0) {
      return yield* new ReadAloudError({ detail: "This message has nothing to read aloud." });
    }
    // MP3 frames are self-delimiting, so per-chunk audio joins into one playable stream.
    const audio = yield* Effect.forEach(chunks, (chunk) => synthesizeChunk(settings, chunk), {
      concurrency: 4,
    });
    return { audioContent: Buffer.concat(audio).toString("base64") };
  });

  const listVoices = Effect.fn("ReadAloud.listVoices")(function* (languageCode: string) {
    const settings = yield* readSettings;
    const body = yield* callGoogle(settings.googleApiKey, HttpClientRequest.get(VOICES_URL));
    const decoded = yield* decodeVoicesResponse(body).pipe(
      Effect.mapError(
        () =>
          new ReadAloudError({ detail: "Google Text-to-Speech sent an unreadable voice list." }),
      ),
    );
    return voiceListForLanguage(decoded.voices, languageCode || DEFAULT_LANGUAGE_CODE);
  });

  return { synthesize, listVoices } satisfies ReadAloud["Service"];
});

export const layer = Layer.effect(ReadAloud, make);
