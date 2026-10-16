import * as Schema from "effect/Schema";

/** Assistant messages longer than this are refused rather than billed as one huge request. */
export const READ_ALOUD_MAX_TEXT_LENGTH = 50_000;
/**
 * `standard` is the 32 kbps MP3 Google sends for most voices. `high` is the
 * uncompressed WAV the voice is rendered at, about 12 times larger.
 */
export const ReadAloudAudioQuality = Schema.Literals(["standard", "high"]);
export type ReadAloudAudioQuality = typeof ReadAloudAudioQuality.Type;

export const READ_ALOUD_SPEAKING_RATE = { min: 0.25, max: 4, default: 1 } as const;
export const READ_ALOUD_PITCH = { min: -20, max: 20, default: 0 } as const;

const VOICE_LANGUAGE = /^([a-z]{2,3}-[a-z]{2,3})-/i;

/**
 * The language a voice name speaks (`da-DK-Wavenet-F` → `da-DK`), or null for a
 * name without one. Google's Gemini voices (`Kore`) are unnamed this way and
 * need OAuth credentials rather than an API key, so read aloud does not use them.
 */
export function speechVoiceLanguage(voice: string): string | null {
  return VOICE_LANGUAGE.exec(voice)?.[1] ?? null;
}

/**
 * What a voice accepts besides text. Chirp voices reject pitch; the rest take
 * both. Google picks the default voice per request, so it only promises speed.
 */
export function speechVoiceOptions(voice: string) {
  const known = speechVoiceLanguage(voice) !== null;
  return { speakingRate: true, pitch: known && !/-Chirp/.test(voice) };
}

export const ReadAloudSynthesizeInput = Schema.Struct({
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(READ_ALOUD_MAX_TEXT_LENGTH)),
});
export type ReadAloudSynthesizeInput = typeof ReadAloudSynthesizeInput.Type;

export const ReadAloudSynthesizeResult = Schema.Struct({
  /** Base64 audio in `mimeType`. */
  audioContent: Schema.String,
  mimeType: Schema.Literals(["audio/mpeg", "audio/wav"]),
});
export type ReadAloudSynthesizeResult = typeof ReadAloudSynthesizeResult.Type;

export const ReadAloudVoiceGender = Schema.Literals(["female", "male", "neutral"]);

export const ReadAloudVoice = Schema.Struct({
  name: Schema.String,
  gender: Schema.NullOr(ReadAloudVoiceGender),
});
export type ReadAloudVoice = typeof ReadAloudVoice.Type;

export const ReadAloudListVoicesInput = Schema.Struct({
  /** BCP-47 code such as `da-DK`; only that language's voices come back. */
  languageCode: Schema.String,
});

export const ReadAloudVoiceList = Schema.Struct({
  /** Every language Google offers voices for, so the client can switch. */
  languageCodes: Schema.Array(Schema.String),
  /** Voices for the requested language. */
  voices: Schema.Array(ReadAloudVoice),
});
export type ReadAloudVoiceList = typeof ReadAloudVoiceList.Type;

export class ReadAloudError extends Schema.TaggedError<ReadAloudError>()("ReadAloudError", {
  detail: Schema.String,
  /** A page that fixes the problem, such as Google's switch for a disabled API. */
  actionUrl: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return this.detail;
  }
}
