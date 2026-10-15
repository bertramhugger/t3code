import type { EnvironmentId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { SquareIcon, Volume2Icon } from "lucide-react";
import { memo, useState, useSyncExternalStore } from "react";

import { cn } from "~/lib/utils";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

// One voice at a time across the whole app: starting a message stops the last one.
let playing: {
  readonly key: string;
  readonly audio: HTMLAudioElement;
  readonly url: string;
} | null = null;
const listeners = new Set<() => void>();

function setPlaying(next: typeof playing) {
  if (playing) {
    playing.audio.pause();
    URL.revokeObjectURL(playing.url);
  }
  playing = next;
  for (const listener of listeners) listener();
}

// A blob URL, not a data URL: the desktop app's CSP allows `blob:` media only.
function audioUrl(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Speaks an assistant message through the environment's Google Text-to-Speech key. */
export const MessageReadAloudButton = memo(function MessageReadAloudButton({
  environmentId,
  messageKey,
  text,
}: {
  environmentId: EnvironmentId;
  /** Identifies the message so its button can show that it is the one playing. */
  messageKey: string;
  text: string;
}) {
  const synthesize = useAtomCommand(serverEnvironment.synthesizeSpeech, { reportFailure: false });
  const [loading, setLoading] = useState(false);
  const isPlaying = useSyncExternalStore(subscribe, () => playing?.key === messageKey);
  const label = isPlaying ? "Stop reading" : "Read aloud";

  const start = async () => {
    setLoading(true);
    try {
      const result = await synthesize({ environmentId, input: { text } });
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Couldn't read the message aloud",
          description: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      const url = audioUrl(result.value.audioContent);
      const audio = new Audio(url);
      audio.addEventListener("ended", () => {
        if (playing?.audio === audio) setPlaying(null);
      });
      setPlaying({ key: messageKey, audio, url });
      await audio.play().catch((error: unknown) => {
        if (playing?.audio === audio) setPlaying(null);
        toastManager.add({
          type: "error",
          title: "Couldn't play the audio",
          description: error instanceof Error ? error.message : String(error),
        });
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost-muted"
            disabled={loading}
            aria-label={label}
            aria-pressed={isPlaying}
            onClick={() => (isPlaying ? setPlaying(null) : void start())}
          />
        }
      >
        {isPlaying ? (
          <SquareIcon className="size-3 text-primary" />
        ) : (
          <Volume2Icon className={cn("size-3", loading && "animate-pulse")} />
        )}
      </TooltipTrigger>
      <TooltipPopup side="top">{loading ? "Preparing audio…" : label}</TooltipPopup>
    </Tooltip>
  );
});
