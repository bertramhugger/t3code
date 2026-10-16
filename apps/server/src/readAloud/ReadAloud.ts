/**
 * ReadAloud — turns an assistant message into speech with the service chosen
 * in `settings.readAloud` (Google Cloud Text-to-Speech, OpenAI, or ElevenLabs),
 * using that service's stored API key.
 *
 * Keys never leave the server: clients send the message text and get audio
 * back, and ask the server for the voice catalog, so a phone or a remote
 * browser can read aloud without holding the credential. Markdown is reduced
 * to plain prose first, then each sentence is synthesized on its own and
 * streamed to the client in order, so playback starts with the first sentence.
 *
 * @module readAloud/ReadAloud
 */
import {
  READ_ALOUD_PITCH,
  READ_ALOUD_SPEAKING_RATE,
  ReadAloudError,
  type ReadAloudProvider,
  type ReadAloudSettings,
  type ReadAloudSentenceAudio,
  type ReadAloudVoice,
  type ReadAloudVoiceList,
  speechVoiceLanguage,
  speechVoiceOptions,
  readAloudApiKey,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as Settings from "../serverSettings.ts";
import {
  decodeElevenLabsVoices,
  ELEVENLABS_API_URL,
  elevenLabsSpeechRequest,
  elevenLabsVoiceList,
  OPENAI_SPEECH_URL,
  openAiSpeechBody,
  openAiVoiceList,
  SERVICE_CONCURRENCY,
  SERVICE_KEY_LABELS,
  SERVICE_MAX_SENTENCE_BYTES,
  SERVICE_NAMES,
  serviceError,
} from "./speechServices.ts";

const SYNTHESIZE_URL = "https://texttospeech.googleapis.com/v1/text:synthesize";
const VOICES_URL = "https://texttospeech.googleapis.com/v1/voices";
// Google caps `input.text` at 5000 bytes; a sentence longer than this is split on words.
const MAX_CHUNK_BYTES = 4_500;
const DEFAULT_LANGUAGE_CODE = "en-US";

export class ReadAloud extends Context.Service<
  ReadAloud,
  {
    readonly synthesize: (text: string) => Stream.Stream<ReadAloudSentenceAudio, ReadAloudError>;
    readonly listVoices: (
      provider: ReadAloudProvider,
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

/**
 * Splits text into the sentences that are synthesized one request each, so the
 * length of each piece of audio says when its sentence starts. Sentences over
 * `maxBytes` are split on words.
 */
export function speechSentences(text: string, maxBytes = MAX_CHUNK_BYTES): string[] {
  return text
    .split(/\n{2,}/)
    .flatMap((paragraph) => paragraph.match(/[^.!?\n]+(?:[.!?]+|\n|$)/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => /[\p{L}\p{N}]/u.test(sentence))
    .flatMap((sentence) => splitOversized(sentence, maxBytes));
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
      audioEncoding: settings.audioQuality === "high" ? "LINEAR16" : "MP3",
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

  /** Settings, provided the service in use (or `provider`) has a key. */
  const readSettings = (provider?: ReadAloudProvider) =>
    settingsService.getSettings.pipe(
      Effect.mapError(() => new ReadAloudError({ detail: "Couldn't read the server settings." })),
      Effect.flatMap(({ readAloud }) => {
        const service = provider ?? readAloud.provider;
        return readAloudApiKey({ ...readAloud, provider: service }).length === 0
          ? Effect.fail(
              new ReadAloudError({
                detail: `Add ${SERVICE_KEY_LABELS[service]} under Settings → Integrations to read messages aloud.`,
              }),
            )
          : Effect.succeed(readAloud);
      }),
    );

  /** Sends a request and returns the response, or the service's own reason it failed. */
  const send = Effect.fn("ReadAloud.send")(function* (
    provider: ReadAloudProvider,
    request: HttpClientRequest.HttpClientRequest,
  ) {
    const response = yield* client.execute(request).pipe(
      Effect.timeout("60 seconds"),
      Effect.mapError(
        () => new ReadAloudError({ detail: `Couldn't reach ${SERVICE_NAMES[provider]}.` }),
      ),
    );
    if (response.status >= 200 && response.status < 300) return response;
    const body = yield* response.json.pipe(Effect.orElseSucceed(() => null));
    return yield* provider === "google"
      ? googleError(body, response.status)
      : serviceError(provider, body, response.status);
  });

  const unreadable = (provider: ReadAloudProvider, what: string) => () =>
    new ReadAloudError({ detail: `${SERVICE_NAMES[provider]} sent ${what}.` });

  /** Audio for one sentence; the neighbours give ElevenLabs its intonation. */
  const synthesizeSentence = Effect.fn("ReadAloud.synthesizeSentence")(function* (
    settings: ReadAloudSettings,
    sentences: readonly string[],
    index: number,
  ) {
    const text = sentences[index]!;
    if (settings.provider === "openai") {
      const response = yield* send(
        "openai",
        HttpClientRequest.post(OPENAI_SPEECH_URL).pipe(
          HttpClientRequest.bearerToken(settings.openaiApiKey),
          HttpClientRequest.bodyJsonUnsafe(openAiSpeechBody(settings, text)),
        ),
      );
      const audio = yield* response.arrayBuffer.pipe(
        Effect.mapError(unreadable("openai", "no audio")),
      );
      return Buffer.from(audio);
    }
    if (settings.provider === "elevenlabs") {
      const { url, body } = elevenLabsSpeechRequest(settings, sentences, index);
      const response = yield* send(
        "elevenlabs",
        HttpClientRequest.post(url).pipe(
          HttpClientRequest.setHeader("xi-api-key", settings.elevenlabsApiKey),
          HttpClientRequest.bodyJsonUnsafe(body),
        ),
      );
      const audio = yield* response.arrayBuffer.pipe(
        Effect.mapError(unreadable("elevenlabs", "no audio")),
      );
      return Buffer.from(audio);
    }
    const response = yield* send(
      "google",
      HttpClientRequest.post(SYNTHESIZE_URL).pipe(
        HttpClientRequest.setHeader("X-Goog-Api-Key", settings.googleApiKey),
        HttpClientRequest.bodyJsonUnsafe(synthesizeRequestBody(settings, text)),
      ),
    );
    const decoded = yield* response.json.pipe(
      Effect.flatMap(decodeSynthesizeResponse),
      Effect.mapError(unreadable("google", "no audio")),
    );
    return Buffer.from(decoded.audioContent, "base64");
  });

  /**
   * One request per sentence, streamed back in reading order as each finishes:
   * playback starts after the first sentence, not the whole message, and the
   * client knows each sentence's text for highlighting.
   */
  const synthesize = (text: string) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const settings = yield* readSettings();
        const { provider } = settings;
        const sentences = speechSentences(
          speechTextFromMarkdown(text),
          SERVICE_MAX_SENTENCE_BYTES[provider],
        );
        if (sentences.length === 0) {
          return yield* new ReadAloudError({ detail: "This message has nothing to read aloud." });
        }
        // ElevenLabs always sends MP3; the others send WAV at high quality.
        const mimeType =
          provider !== "elevenlabs" && settings.audioQuality === "high"
            ? ("audio/wav" as const)
            : ("audio/mpeg" as const);
        return Stream.fromIterable(sentences.map((_, index) => index)).pipe(
          Stream.mapEffect(
            (index) =>
              synthesizeSentence(settings, sentences, index).pipe(
                Effect.map((audio) => ({
                  index,
                  text: sentences[index]!,
                  audioContent: audio.toString("base64"),
                  mimeType,
                })),
              ),
            { concurrency: SERVICE_CONCURRENCY[provider] },
          ),
        );
      }),
    ).pipe(Stream.withSpan("ReadAloud.synthesize"));

  const listVoices = Effect.fn("ReadAloud.listVoices")(function* (
    provider: ReadAloudProvider,
    languageCode: string,
  ) {
    const settings = yield* readSettings(provider);
    if (provider === "openai") {
      return { languageCodes: [], voices: openAiVoiceList(settings.openaiModel) };
    }
    if (provider === "elevenlabs") {
      const response = yield* send(
        "elevenlabs",
        HttpClientRequest.get(`${ELEVENLABS_API_URL}/v2/voices?page_size=100`).pipe(
          HttpClientRequest.setHeader("xi-api-key", settings.elevenlabsApiKey),
        ),
      );
      const body = yield* response.json.pipe(
        Effect.mapError(unreadable("elevenlabs", "an unreadable voice list")),
      );
      const decoded = decodeElevenLabsVoices(body);
      if (decoded._tag === "None")
        return yield* unreadable("elevenlabs", "an unreadable voice list")();
      return { languageCodes: [], voices: elevenLabsVoiceList(decoded.value.voices) };
    }
    const response = yield* send(
      "google",
      HttpClientRequest.get(VOICES_URL).pipe(
        HttpClientRequest.setHeader("X-Goog-Api-Key", settings.googleApiKey),
      ),
    );
    const decoded = yield* response.json.pipe(
      Effect.flatMap(decodeVoicesResponse),
      Effect.mapError(unreadable("google", "an unreadable voice list")),
    );
    return voiceListForLanguage(decoded.voices, languageCode || DEFAULT_LANGUAGE_CODE);
  });

  return { synthesize, listVoices } satisfies ReadAloud["Service"];
});

export const layer = Layer.effect(ReadAloud, make);
