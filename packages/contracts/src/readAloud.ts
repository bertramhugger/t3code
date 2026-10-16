import * as Schema from "effect/Schema";

/** Assistant messages longer than this are refused rather than billed as one huge request. */
export const READ_ALOUD_MAX_TEXT_LENGTH = 50_000;
/** The speech service that reads messages aloud. Each has its own API key. */
export const ReadAloudProvider = Schema.Literals(["google", "openai", "elevenlabs"]);
export type ReadAloudProvider = typeof ReadAloudProvider.Type;

export const READ_ALOUD_OPENAI_MODELS = ["gpt-4o-mini-tts", "tts-1-hd", "tts-1"] as const;
export const ReadAloudOpenAiModel = Schema.Literals(READ_ALOUD_OPENAI_MODELS);
export type ReadAloudOpenAiModel = typeof ReadAloudOpenAiModel.Type;

/** OpenAI has no voice list endpoint. The tts-1 models offer only the first nine. */
export const READ_ALOUD_OPENAI_VOICES = [
  "alloy",
  "ash",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "ballad",
  "verse",
  "marin",
  "cedar",
] as const;
export const READ_ALOUD_OPENAI_TTS1_VOICE_COUNT = 9;

export const READ_ALOUD_ELEVENLABS_MODELS = [
  "eleven_multilingual_v2",
  "eleven_v3",
  "eleven_flash_v2_5",
  "eleven_turbo_v2_5",
] as const;
export const ReadAloudElevenLabsModel = Schema.Literals(READ_ALOUD_ELEVENLABS_MODELS);
export type ReadAloudElevenLabsModel = typeof ReadAloudElevenLabsModel.Type;
/** ElevenLabs' "George", used until a voice is picked; every account has it. */
export const READ_ALOUD_ELEVENLABS_DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb";

/** How OpenAI's gpt-4o-mini-tts should read, e.g. "calm and warm". */
export const READ_ALOUD_STYLE_PROMPT_MAX_LENGTH = 1_000;

/** Speed each service accepts; the shared setting is clamped to it. */
export const READ_ALOUD_SPEED_RANGE: Record<ReadAloudProvider, { min: number; max: number }> = {
  google: { min: 0.25, max: 4 },
  openai: { min: 0.25, max: 4 },
  elevenlabs: { min: 0.7, max: 1.2 },
};

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

/**
 * One sentence of a message, streamed in reading order as soon as it is
 * synthesized, so playback starts after the first instead of the whole message.
 */
export const ReadAloudSentenceAudio = Schema.Struct({
  index: Schema.Number,
  /** The spoken text, without markdown. Clients find it in the rendered message to highlight it. */
  text: Schema.String,
  /** Base64 audio in `mimeType`: one complete file per sentence. */
  audioContent: Schema.String,
  mimeType: Schema.Literals(["audio/mpeg", "audio/wav"]),
});
export type ReadAloudSentenceAudio = typeof ReadAloudSentenceAudio.Type;

export const ReadAloudVoiceGender = Schema.Literals(["female", "male", "neutral"]);

export const ReadAloudVoice = Schema.Struct({
  /** What the setting stores: a Google voice name or an ElevenLabs voice ID. */
  name: Schema.String,
  gender: Schema.NullOr(ReadAloudVoiceGender),
  /** Display name when `name` is an ID. */
  label: Schema.optional(Schema.String),
  /** Accent, style, or other notes the service gives. */
  description: Schema.optional(Schema.String),
});
export type ReadAloudVoice = typeof ReadAloudVoice.Type;

export const ReadAloudListVoicesInput = Schema.Struct({
  provider: ReadAloudProvider,
  /** BCP-47 code such as `da-DK`; Google returns only that language's voices. */
  languageCode: Schema.String,
});

export const ReadAloudVoiceList = Schema.Struct({
  /** Every language Google offers voices for, so the client can switch. Empty for multilingual services. */
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
