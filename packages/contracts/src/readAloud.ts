import * as Schema from "effect/Schema";

/** Assistant messages longer than this are refused rather than billed as one huge request. */
export const READ_ALOUD_MAX_TEXT_LENGTH = 50_000;

export const ReadAloudSynthesizeInput = Schema.Struct({
  text: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(READ_ALOUD_MAX_TEXT_LENGTH)),
});
export type ReadAloudSynthesizeInput = typeof ReadAloudSynthesizeInput.Type;

export const ReadAloudSynthesizeResult = Schema.Struct({
  /** Base64 MP3, ready for a `data:audio/mpeg;base64,` URL. */
  audioContent: Schema.String,
});
export type ReadAloudSynthesizeResult = typeof ReadAloudSynthesizeResult.Type;

export class ReadAloudError extends Schema.TaggedError<ReadAloudError>()("ReadAloudError", {
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}
