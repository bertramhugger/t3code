import { type EnvironmentId, ReadAloudError } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import { useCallback, useSyncExternalStore } from "react";

import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { toastManager } from "../ui/toast";
import {
  clearSpokenHighlight,
  highlightSpokenSegment,
  spokenHighlightIsAttached,
} from "./readAloudHighlight";

const isReadAloudError = Schema.is(ReadAloudError);

export type ReadAloudPhase = "idle" | "loading" | "playing";

// One voice at a time across the whole app: starting a message stops the last one.
// Both the message button and the read-latest shortcut drive this, so each
// button shows a message's state no matter which started it.
type Playback =
  | { readonly key: string; readonly phase: "loading" }
  | {
      readonly key: string;
      readonly phase: "playing";
      readonly audio: HTMLAudioElement;
      readonly url: string;
    };

let current: Playback | null = null;
const listeners = new Set<() => void>();

function setCurrent(next: Playback | null) {
  if (current?.phase === "playing") {
    current.audio.pause();
    URL.revokeObjectURL(current.url);
    clearSpokenHighlight();
  }
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// A blob URL, not a data URL: the desktop app's CSP allows `blob:` media only.
function audioUrl(base64: string, mimeType: string): string {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

/** What the message identified by `key` is doing right now. */
export function useReadAloudPhase(key: string): ReadAloudPhase {
  return useSyncExternalStore(subscribe, () => (current?.key === key ? current.phase : "idle"));
}

/**
 * Starts reading a message, or stops it if it is already loading or playing.
 * Audio comes from the environment's Google Text-to-Speech key.
 */
export function useToggleReadAloud() {
  const synthesize = useAtomCommand(serverEnvironment.synthesizeSpeech, { reportFailure: false });

  return useCallback(
    async (input: { environmentId: EnvironmentId; key: string; text: string }) => {
      if (current?.key === input.key) {
        setCurrent(null);
        return;
      }
      const request: Playback = { key: input.key, phase: "loading" };
      setCurrent(request);
      const result = await synthesize({
        environmentId: input.environmentId,
        input: { text: input.text },
      });
      // Stopped, or another message started, while the audio was being made.
      if (current !== request) return;
      if (result._tag === "Failure") {
        setCurrent(null);
        if (isAtomCommandInterrupted(result)) return;
        const error = squashAtomCommandFailure(result);
        const actionUrl = isReadAloudError(error) ? error.actionUrl : undefined;
        toastManager.add({
          type: "error",
          title: "Couldn't read the message aloud",
          description: error instanceof Error ? error.message : String(error),
          ...(actionUrl
            ? {
                actionProps: {
                  children: "Enable API",
                  onClick: () => window.open(actionUrl, "_blank", "noopener,noreferrer"),
                },
              }
            : {}),
        });
        return;
      }
      const url = audioUrl(result.value.audioContent, result.value.mimeType);
      const audio = new Audio(url);
      const isCurrent = () => current?.phase === "playing" && current.audio === audio;
      const { segments } = result.value;
      let spoken = -1;
      // About four times a second; the highlight only repaints when the sentence changes
      // or its row was scrolled away and back.
      audio.addEventListener("timeupdate", () => {
        if (!isCurrent()) return;
        const index = segments.findLastIndex((segment) => segment.start <= audio.currentTime);
        if (index === spoken && spokenHighlightIsAttached()) return;
        spoken = index;
        highlightSpokenSegment(input.key, segments, index);
      });
      audio.addEventListener("ended", () => {
        if (isCurrent()) setCurrent(null);
      });
      setCurrent({ key: input.key, phase: "playing", audio, url });
      await audio.play().catch((error: unknown) => {
        if (isCurrent()) setCurrent(null);
        toastManager.add({
          type: "error",
          title: "Couldn't play the audio",
          description: error instanceof Error ? error.message : String(error),
        });
      });
    },
    [synthesize],
  );
}

const READ_LATEST_MESSAGE_EVENT = "t3:read-latest-message";

/** Asks the open thread to read (or stop reading) its latest agent message. */
export function requestReadLatestMessage(): void {
  window.dispatchEvent(new Event(READ_LATEST_MESSAGE_EVENT));
}

export function subscribeReadLatestMessage(listener: () => void): () => void {
  window.addEventListener(READ_LATEST_MESSAGE_EVENT, listener);
  return () => window.removeEventListener(READ_LATEST_MESSAGE_EVENT, listener);
}
