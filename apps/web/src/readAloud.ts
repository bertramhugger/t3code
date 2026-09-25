import { markdownToSpeechText } from "@t3tools/client-runtime/speech-text";
import { runAtomCommand, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";

import { toastManager } from "./components/ui/toast";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { serverEnvironment } from "./state/server";

interface ReadAloudState {
  /** The assistant message being fetched or spoken, if any. */
  readonly messageId: string | null;
  readonly status: "idle" | "loading" | "playing";
}

const IDLE: ReadAloudState = { messageId: null, status: "idle" };

/** One message speaks at a time across the whole client. */
export const useReadAloudStore = create<ReadAloudState>(() => IDLE);

let player: { readonly audio: HTMLAudioElement; readonly url: string } | null = null;
// Bumped on every start and stop so a synthesis that resolves late is dropped.
let generation = 0;

function releasePlayer(): void {
  if (!player) return;
  player.audio.pause();
  URL.revokeObjectURL(player.url);
  player = null;
}

export function stopReadingAloud(): void {
  generation += 1;
  releasePlayer();
  useReadAloudStore.setState(IDLE);
}

function mp3Url(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
}

function failureMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "Could not read the response aloud.";
}

/**
 * Speaks an assistant message through the environment's Google Text-to-Speech
 * key, replacing whatever was playing. `quiet` suppresses error toasts for
 * automatic reads, which the user did not ask for at that moment.
 */
export async function readAloud(input: {
  readonly environmentId: EnvironmentId;
  readonly messageId: string;
  readonly markdown: string;
  readonly quiet?: boolean;
}): Promise<void> {
  stopReadingAloud();
  const text = markdownToSpeechText(input.markdown);
  if (text.length === 0) return;
  const request = generation;
  useReadAloudStore.setState({ messageId: input.messageId, status: "loading" });

  const result = await runAtomCommand(
    appAtomRegistry,
    serverEnvironment.synthesizeSpeech,
    { environmentId: input.environmentId, input: { text } },
    { reportFailure: false },
  );
  if (request !== generation) return;
  if (result._tag === "Failure") {
    stopReadingAloud();
    if (!input.quiet) {
      toastManager.add({
        type: "error",
        title: "Read aloud failed",
        description: failureMessage(squashAtomCommandFailure(result)),
      });
    }
    return;
  }

  const url = mp3Url(result.value.audioContent);
  const audio = new Audio(url);
  const current = { audio, url };
  player = current;
  audio.addEventListener("ended", () => {
    if (player === current) stopReadingAloud();
  });
  useReadAloudStore.setState({ messageId: input.messageId, status: "playing" });
  try {
    await audio.play();
  } catch {
    // Autoplay without a recent user gesture is blocked by the browser.
    if (player === current) stopReadingAloud();
  }
}
