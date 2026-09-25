import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Upper bound on text sent for one read-aloud request. Google bills per
 * character, so a runaway response should not become a runaway bill; the
 * server synthesizes the first this-many characters.
 */
export const TEXT_TO_SPEECH_MAX_CHARS = 20_000;

export const TextToSpeechSynthesizeInput = Schema.Struct({
  text: TrimmedNonEmptyString,
});
export type TextToSpeechSynthesizeInput = typeof TextToSpeechSynthesizeInput.Type;

export const TextToSpeechSynthesizeResult = Schema.Struct({
  /** Base64-encoded MP3. */
  audioContent: Schema.String,
});
export type TextToSpeechSynthesizeResult = typeof TextToSpeechSynthesizeResult.Type;

export class TextToSpeechError extends Schema.TaggedError<TextToSpeechError>()(
  "TextToSpeechError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}
