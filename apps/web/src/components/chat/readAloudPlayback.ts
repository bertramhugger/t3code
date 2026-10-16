import {
  type EnvironmentId,
  ReadAloudError,
  type ReadAloudSentenceAudio,
} from "@t3tools/contracts";
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
  segmentAtSpeechKey,
} from "./readAloudHighlight";

const isReadAloudError = Schema.is(ReadAloudError);

export type ReadAloudPhase = "idle" | "loading" | "playing";

// Room for the first sentence to be scheduled before its start time passes.
const SCHEDULE_LEAD_SECONDS = 0.05;

/**
 * One message being read. Sentences arrive one by one; each is decoded and
 * scheduled right after the previous on a Web Audio clock, so playback starts
 * with the first sentence and runs gapless while the rest are still on the way.
 */
interface Session {
  readonly key: string;
  phase: "loading" | "playing";
  /** Stops audio and the stream, which also stops the server's remaining requests. */
  readonly stop: () => void;
  /** Jumps to the sentence at a click's position in the message's text. */
  readonly seek: (speechKey: number) => void;
}

// One voice at a time across the whole app: starting a message stops the last one.
// The message button, the read-latest shortcut and clicks all drive this, so each
// button shows a message's state no matter which started it.
let current: Session | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function setCurrent(next: Session | null) {
  current?.stop();
  current = next;
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function decodeBase64(base64: string): ArrayBuffer {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)).buffer;
}

function showError(title: string, error: unknown) {
  const actionUrl = isReadAloudError(error) ? error.actionUrl : undefined;
  toastManager.add({
    type: "error",
    title,
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
}

function startSession(key: string, startAtSpeechKey: number | undefined) {
  // Made synchronously in the click or key press, so autoplay rules allow it to sound.
  const context = new AudioContext();
  void context.resume();
  const abort = new AbortController();
  const sentences: string[] = [];
  const buffers: AudioBuffer[] = [];
  const sources = new Set<AudioBufferSourceNode>();
  const timers = new Set<number>();
  // Where playback starts: unknown until the clicked sentence arrives.
  let startIndex: number | null = startAtSpeechKey === undefined ? 0 : null;
  let nextIndex = 0;
  let nextStart = 0;
  let streamDone = false;
  let stopped = false;

  const finishIfDone = () => {
    if (streamDone && sources.size === 0 && nextIndex >= buffers.length && current === session) {
      setCurrent(null);
    }
  };

  /** Schedules every decoded sentence from `nextIndex` on, each after the last. */
  const schedule = () => {
    if (stopped || startIndex === null) return;
    while (nextIndex < buffers.length) {
      const index = nextIndex++;
      const buffer = buffers[index]!;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      const at = Math.max(nextStart, context.currentTime + SCHEDULE_LEAD_SECONDS);
      source.start(at);
      nextStart = at + buffer.duration;
      sources.add(source);
      source.addEventListener("ended", () => {
        if (!sources.delete(source)) return;
        finishIfDone();
      });
      const timer = window.setTimeout(
        () => {
          timers.delete(timer);
          highlightSpokenSegment(key, sentences, index);
        },
        Math.max(0, (at - context.currentTime) * 1000),
      );
      timers.add(timer);
    }
    if (session.phase === "loading" && sources.size > 0) {
      session.phase = "playing";
      if (current === session) notify();
    }
  };

  const clearScheduled = () => {
    // Emptying the set first keeps the stopped sources' `ended` from finishing the session.
    const stopping = [...sources];
    sources.clear();
    for (const source of stopping) source.stop();
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
  };

  const startAt = (index: number) => {
    clearScheduled();
    startIndex = index;
    nextIndex = index;
    nextStart = 0;
    schedule();
  };

  // Decoding is chained so sentences land in order even if a later one decodes faster.
  let decoding = Promise.resolve();
  const onSentence = (sentence: ReadAloudSentenceAudio) => {
    sentences[sentence.index] = sentence.text;
    decoding = decoding.then(async () => {
      if (stopped) return;
      buffers[sentence.index] = await context.decodeAudioData(decodeBase64(sentence.audioContent));
      if (startIndex === null && startAtSpeechKey !== undefined) {
        const clicked = segmentAtSpeechKey(key, sentences, startAtSpeechKey);
        if (clicked !== null) startAt(clicked);
        return;
      }
      schedule();
    });
  };

  const session: Session = {
    key,
    phase: "loading",
    stop: () => {
      if (stopped) return;
      stopped = true;
      abort.abort();
      clearScheduled();
      void context.close();
      clearSpokenHighlight();
    },
    seek: (speechKey) => {
      const index = segmentAtSpeechKey(key, sentences, speechKey);
      if (index !== null && index < buffers.length) startAt(index);
    },
  };

  /** Called once the server has sent every sentence, or failed. */
  const finish = async (failure: unknown) => {
    await decoding.catch((error: unknown) => {
      failure ??= error;
    });
    if (stopped) return;
    if (failure !== undefined) {
      const started = sources.size > 0;
      if (current === session) setCurrent(null);
      showError(started ? "Read aloud stopped" : "Couldn't read the message aloud", failure);
      return;
    }
    streamDone = true;
    // A click on text that no later sentence follows reads from the top.
    if (startIndex === null) startAt(0);
    finishIfDone();
  };

  return { session, signal: abort.signal, onSentence, finish };
}

/** The phase of `key` outside React, for click handlers. */
export function readAloudPhaseOf(key: string): ReadAloudPhase {
  return current?.key === key ? current.phase : "idle";
}

/**
 * Jumps the playing message to the sentence at `speechKey`, a click's position
 * in the message's text (see `speechKeyIndexAtPoint`).
 */
export function seekReadAloud(key: string, speechKey: number): void {
  if (current?.key === key && current.phase === "playing") current.seek(speechKey);
}

/** What the message identified by `key` is doing right now. */
export function useReadAloudPhase(key: string): ReadAloudPhase {
  return useSyncExternalStore(subscribe, () => (current?.key === key ? current.phase : "idle"));
}

/**
 * Starts reading a message, or stops it if it is already loading or playing.
 * Audio comes from the environment's speech service.
 */
export function useToggleReadAloud() {
  const synthesize = useAtomCommand(serverEnvironment.synthesizeSpeech, { reportFailure: false });

  return useCallback(
    async (input: {
      environmentId: EnvironmentId;
      key: string;
      text: string;
      /** Start at the sentence holding this position in the message's text, from a click. */
      startAtSpeechKey?: number;
    }) => {
      if (current?.key === input.key) {
        setCurrent(null);
        return;
      }
      const { session, signal, onSentence, finish } = startSession(
        input.key,
        input.startAtSpeechKey,
      );
      setCurrent(session);
      const result = await synthesize({
        environmentId: input.environmentId,
        input: { text: input.text, signal, onSentence },
      });
      await finish(
        result._tag === "Failure" && !isAtomCommandInterrupted(result)
          ? squashAtomCommandFailure(result)
          : undefined,
      );
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
