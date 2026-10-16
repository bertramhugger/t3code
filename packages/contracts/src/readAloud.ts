import * as Schema from "effect/Schema";

/** Assistant messages longer than this are refused rather than billed as one huge request. */
export const READ_ALOUD_MAX_TEXT_LENGTH = 50_000;
/** Google caps a Gemini-TTS prompt at 4000 bytes; this leaves room for multi-byte text. */
export const READ_ALOUD_STYLE_PROMPT_MAX_LENGTH = 1_000;

export const READ_ALOUD_GEMINI_MODELS = [
  "gemini-2.5-flash-tts",
  "gemini-2.5-pro-tts",
  "gemini-3.1-flash-tts-preview",
] as const;
export const ReadAloudGeminiModel = Schema.Literals(READ_ALOUD_GEMINI_MODELS);
export type ReadAloudGeminiModel = typeof ReadAloudGeminiModel.Type;

export const READ_ALOUD_SPEAKING_RATE = { min: 0.25, max: 4, default: 1 } as const;
export const READ_ALOUD_PITCH = { min: -20, max: 20, default: 0 } as const;

/**
 * Google voice families differ in what they accept: Gemini voices (bare names
 * such as `Kore`) take a style prompt but no rate or pitch, Chirp voices take a
 * speaking rate but reject pitch, and the rest take both.
 */
export type SpeechVoiceFamily = "gemini" | "chirp" | "classic";

export function speechVoiceFamily(voice: string): SpeechVoiceFamily {
  if (voice.length > 0 && !/^[a-z]{2,3}-[a-z]{2,3}-/i.test(voice)) return "gemini";
  // Google's default voice is chosen per request, so only promise what every family accepts.
  if (voice.length === 0 || /-Chirp/.test(voice)) return "chirp";
  return "classic";
}

export function speechVoiceOptions(voice: string) {
  const family = speechVoiceFamily(voice);
  return {
    stylePrompt: family === "gemini",
    speakingRate: family !== "gemini",
    pitch: family === "classic",
  };
}

export const ReadAloudSynthesizeInput = Schema.Struct({
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(READ_ALOUD_MAX_TEXT_LENGTH)),
});
export type ReadAloudSynthesizeInput = typeof ReadAloudSynthesizeInput.Type;

export const ReadAloudSynthesizeResult = Schema.Struct({
  /** Base64 MP3. */
  audioContent: Schema.String,
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
  /** Voices for the requested language. Gemini voices speak every language. */
  voices: Schema.Array(ReadAloudVoice),
});
export type ReadAloudVoiceList = typeof ReadAloudVoiceList.Type;

export class ReadAloudError extends Schema.TaggedError<ReadAloudError>()("ReadAloudError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}
