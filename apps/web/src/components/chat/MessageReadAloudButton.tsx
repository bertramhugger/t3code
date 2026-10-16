import type { EnvironmentId } from "@t3tools/contracts";
import { SquareIcon, Volume2Icon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useReadAloudPhase, useToggleReadAloud } from "./readAloudPlayback";

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
  const toggle = useToggleReadAloud();
  const phase = useReadAloudPhase(messageKey);
  const label =
    phase === "loading" ? "Preparing audio…" : phase === "playing" ? "Stop reading" : "Read aloud";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost-muted"
            aria-label={label}
            aria-pressed={phase !== "idle"}
            onClick={() => void toggle({ environmentId, key: messageKey, text })}
          />
        }
      >
        {phase === "playing" ? (
          <SquareIcon className="size-3 text-primary" />
        ) : (
          <Volume2Icon className={cn("size-3", phase === "loading" && "animate-pulse")} />
        )}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
});
