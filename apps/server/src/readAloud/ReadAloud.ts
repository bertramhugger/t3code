/**
 * ReadAloud — turns an assistant message into speech with Google Cloud
 * Text-to-Speech, using the API key stored in `settings.readAloud`.
 *
 * The key never leaves the server: clients send the message text and get MP3
 * audio back, and ask the server for the voice catalog, so a phone or a remote
 * browser can read aloud without holding the credential. Markdown is reduced
 * to plain prose first, then each sentence is synthesized on its own and the
 * pieces are joined into one file, with the time each sentence starts so
 * clients can highlight it while it is read.
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
// Google caps `input.text` at 5000 bytes; a sentence longer than this is split on words.
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

/**
 * Joins the WAV files Google returns per chunk into one: the first file's
 * format, every file's samples, and sizes rewritten to match.
 */
export function joinWavChunks(files: readonly Buffer[]): Buffer {
  let format: Buffer | null = null;
  const samples: Buffer[] = [];
  for (const file of files) {
    // RIFF header (12 bytes), then chunks of: 4-byte id, 4-byte little-endian size, body.
    let offset = 12;
    while (offset + 8 <= file.length) {
      const id = file.toString("ascii", offset, offset + 4);
      const size = file.readUInt32LE(offset + 4);
      const body = file.subarray(offset + 8, Math.min(offset + 8 + size, file.length));
      if (id === "fmt ") format ??= body;
      if (id === "data") samples.push(body);
      offset += 8 + size + (size % 2);
    }
  }
  if (format === null) return Buffer.alloc(0);
  const data = Buffer.concat(samples);
  const header = Buffer.alloc(20);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(4 + 8 + format.length + 8 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(format.length, 16);
  const dataHeader = Buffer.alloc(8);
  dataHeader.write("data", 0, "ascii");
  dataHeader.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, format, dataHeader, data]);
}

// Layer III bitrates (kbps) by bitrate index, for MPEG-1 and for MPEG-2/2.5.
const MP3_BITRATES = {
  mpeg1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  mpeg2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
// Sample rates by version bits: 3 is MPEG-1, 2 is MPEG-2, 0 is MPEG-2.5.
const MP3_SAMPLE_RATES: Record<number, readonly number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

/** Seconds of audio in an MP3, by walking its frame headers. */
export function mp3Duration(file: Buffer): number {
  let offset = 0;
  if (file.toString("ascii", 0, 3) === "ID3" && file.length >= 10) {
    // The ID3v2 size is four 7-bit bytes after the 6-byte header.
    offset = 10 + ((file[6]! << 21) | (file[7]! << 14) | (file[8]! << 7) | file[9]!);
  }
  let seconds = 0;
  while (offset + 4 <= file.length) {
    const header = file.readUInt32BE(offset);
    const version = (header >>> 19) & 3;
    const sampleRate = MP3_SAMPLE_RATES[version]?.[(header >>> 10) & 3];
    const bitrate = (version === 3 ? MP3_BITRATES.mpeg1 : MP3_BITRATES.mpeg2)[(header >>> 12) & 15];
    const isLayer3Frame = header >>> 21 === 0x7ff && ((header >>> 17) & 3) === 1;
    if (!isLayer3Frame || !sampleRate || !bitrate) {
      offset += 1;
      continue;
    }
    const samples = version === 3 ? 1152 : 576;
    seconds += samples / sampleRate;
    offset += Math.floor((samples / 8) * ((bitrate * 1000) / sampleRate)) + ((header >>> 9) & 1);
  }
  return seconds;
}

/** Seconds of audio in a PCM WAV. */
export function wavDuration(file: Buffer): number {
  let byteRate = 0;
  let dataBytes = 0;
  let offset = 12;
  while (offset + 8 <= file.length) {
    const id = file.toString("ascii", offset, offset + 4);
    const size = file.readUInt32LE(offset + 4);
    if (id === "fmt ") byteRate = file.readUInt32LE(offset + 16);
    if (id === "data") dataBytes += Math.min(size, file.length - offset - 8);
    offset += 8 + size + (size % 2);
  }
  return byteRate > 0 ? dataBytes / byteRate : 0;
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
    const sentences = speechSentences(speechTextFromMarkdown(text));
    if (sentences.length === 0) {
      return yield* new ReadAloudError({ detail: "This message has nothing to read aloud." });
    }
    // One sentence per request: parallel requests finish sooner than one long one, and
    // each piece's length says when its sentence starts, for highlighting.
    const audio = yield* Effect.forEach(
      sentences,
      (sentence) => synthesizeChunk(settings, sentence),
      { concurrency: 8 },
    );
    const wav = settings.audioQuality === "high";
    const duration = wav ? wavDuration : mp3Duration;
    let start = 0;
    const segments = sentences.map((sentence, index) => {
      const segment = { text: sentence, start };
      start += duration(audio[index]!);
      return segment;
    });
    return {
      // MP3 frames are self-delimiting, so per-sentence MP3s join into one playable stream.
      audioContent: (wav ? joinWavChunks(audio) : Buffer.concat(audio)).toString("base64"),
      mimeType: wav ? ("audio/wav" as const) : ("audio/mpeg" as const),
      segments,
    };
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
