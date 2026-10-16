/**
 * Request bodies, error messages, and voice lists for the speech services
 * other than Google: OpenAI and ElevenLabs. Pure, so each can be tested
 * without the network; ReadAloud sends them.
 *
 * @module readAloud/speechServices
 */
import {
  READ_ALOUD_ELEVENLABS_DEFAULT_VOICE,
  READ_ALOUD_OPENAI_TTS1_VOICE_COUNT,
  READ_ALOUD_OPENAI_VOICES,
  READ_ALOUD_SPEED_RANGE,
  READ_ALOUD_SPEAKING_RATE,
  type ReadAloudProvider,
  ReadAloudError,
  type ReadAloudSettings,
  type ReadAloudVoice,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";
export const ELEVENLABS_API_URL = "https://api.elevenlabs.io";

export const SERVICE_NAMES: Record<ReadAloudProvider, string> = {
  google: "Google Text-to-Speech",
  openai: "OpenAI",
  elevenlabs: "ElevenLabs",
};

export const SERVICE_KEY_LABELS: Record<ReadAloudProvider, string> = {
  google: "a Google Cloud API key",
  openai: "an OpenAI API key",
  elevenlabs: "an ElevenLabs API key",
};

/**
 * Requests in flight at once. ElevenLabs refuses more than its plan allows
 * (two on the free plan); the others take more.
 */
export const SERVICE_CONCURRENCY: Record<ReadAloudProvider, number> = {
  google: 8,
  openai: 4,
  elevenlabs: 2,
};

/** Longest sentence sent in one request; OpenAI caps input at 4096 characters. */
export const SERVICE_MAX_SENTENCE_BYTES: Record<ReadAloudProvider, number> = {
  google: 4_500,
  openai: 4_000,
  elevenlabs: 4_500,
};

/** The shared speed setting, clamped to what `provider` accepts. Undefined at normal speed. */
export function serviceSpeed(settings: ReadAloudSettings, provider: ReadAloudProvider) {
  if (settings.speakingRate === READ_ALOUD_SPEAKING_RATE.default) return undefined;
  const { min, max } = READ_ALOUD_SPEED_RANGE[provider];
  return Math.min(max, Math.max(min, settings.speakingRate));
}

/** The voices an OpenAI model offers; the tts-1 models have fewer. */
export function openAiVoices(model: ReadAloudSettings["openaiModel"]): readonly string[] {
  return model === "gpt-4o-mini-tts"
    ? READ_ALOUD_OPENAI_VOICES
    : READ_ALOUD_OPENAI_VOICES.slice(0, READ_ALOUD_OPENAI_TTS1_VOICE_COUNT);
}

export function openAiSpeechBody(settings: ReadAloudSettings, text: string) {
  const voices = openAiVoices(settings.openaiModel);
  const speed = serviceSpeed(settings, "openai");
  const instructions =
    settings.openaiModel === "gpt-4o-mini-tts" ? settings.openaiInstructions : "";
  return {
    model: settings.openaiModel,
    input: text,
    // A voice saved for gpt-4o-mini-tts may not exist on tts-1.
    voice: voices.includes(settings.openaiVoice) ? settings.openaiVoice : "coral",
    response_format: settings.audioQuality === "high" ? "wav" : "mp3",
    ...(speed === undefined ? {} : { speed }),
    ...(instructions.length > 0 ? { instructions } : {}),
  };
}

export function openAiVoiceList(model: ReadAloudSettings["openaiModel"]): ReadAloudVoice[] {
  return openAiVoices(model).map((voice) => ({
    name: voice,
    label: voice.charAt(0).toUpperCase() + voice.slice(1),
    gender: null,
  }));
}

/**
 * The URL and body for one ElevenLabs sentence. The neighbouring sentences go
 * along so the voice keeps its intonation across requests; v3 does not take them.
 */
export function elevenLabsSpeechRequest(
  settings: ReadAloudSettings,
  sentences: readonly string[],
  index: number,
) {
  const voice = settings.elevenlabsVoiceId || READ_ALOUD_ELEVENLABS_DEFAULT_VOICE;
  const speed = serviceSpeed(settings, "elevenlabs");
  const context = settings.elevenlabsModel !== "eleven_v3";
  const previous = context ? sentences[index - 1] : undefined;
  const next = context ? sentences[index + 1] : undefined;
  return {
    url: `${ELEVENLABS_API_URL}/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
    body: {
      text: sentences[index]!,
      model_id: settings.elevenlabsModel,
      ...(speed === undefined ? {} : { voice_settings: { speed } }),
      ...(previous === undefined ? {} : { previous_text: previous }),
      ...(next === undefined ? {} : { next_text: next }),
    },
  };
}

const ElevenLabsVoices = Schema.Struct({
  voices: Schema.Array(
    Schema.Struct({
      voice_id: Schema.String,
      name: Schema.optional(Schema.NullOr(Schema.String)),
      category: Schema.optional(Schema.NullOr(Schema.String)),
      labels: Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.String))),
    }),
  ),
});
export const decodeElevenLabsVoices = Schema.decodeUnknownOption(ElevenLabsVoices);

const GENDERS = new Set(["female", "male", "neutral"]);

export function elevenLabsVoiceList(voices: typeof ElevenLabsVoices.Type.voices): ReadAloudVoice[] {
  return voices
    .map((voice) => {
      const labels = voice.labels ?? {};
      const gender = labels.gender?.toLowerCase();
      const description = [labels.accent, labels.descriptive ?? labels.description, labels.use_case]
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join(", ");
      return {
        name: voice.voice_id,
        label: voice.name ?? voice.voice_id,
        gender: gender && GENDERS.has(gender) ? (gender as "female" | "male" | "neutral") : null,
        ...(description ? { description } : {}),
      };
    })
    .toSorted((left, right) => left.label.localeCompare(right.label));
}

const OpenAiError = Schema.Struct({ error: Schema.Struct({ message: Schema.String }) });
const ElevenLabsError = Schema.Struct({
  detail: Schema.Union([
    Schema.String,
    Schema.Struct({
      message: Schema.optional(Schema.String),
      status: Schema.optional(Schema.String),
    }),
    Schema.Array(Schema.Struct({ msg: Schema.String })),
  ]),
});
const decodeOpenAiError = Schema.decodeUnknownOption(OpenAiError);
const decodeElevenLabsError = Schema.decodeUnknownOption(ElevenLabsError);

// `Array.isArray` does not narrow read-only arrays.
const isValidationList = (
  detail: typeof ElevenLabsError.Type.detail,
): detail is ReadonlyArray<{ readonly msg: string }> => Array.isArray(detail);

/** The service's own explanation of a failed request, or its status when it gave none. */
export function serviceError(
  provider: "openai" | "elevenlabs",
  body: unknown,
  status: number,
): ReadAloudError {
  const name = SERVICE_NAMES[provider];
  let message: string | undefined;
  if (provider === "openai") {
    const decoded = decodeOpenAiError(body);
    if (decoded._tag === "Some") message = decoded.value.error.message;
  } else {
    const decoded = decodeElevenLabsError(body);
    if (decoded._tag === "Some") {
      const { detail } = decoded.value;
      message =
        typeof detail === "string"
          ? detail
          : isValidationList(detail)
            ? detail.map((item) => item.msg).join("; ")
            : (detail.message ?? detail.status);
    }
  }
  return new ReadAloudError({
    detail: message ? `${name}: ${message}` : `${name} failed with status ${status}.`,
  });
}
