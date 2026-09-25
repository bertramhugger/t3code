import type { EnvironmentId } from "@t3tools/contracts";
import { SquareIcon, Volume2Icon } from "lucide-react";
import { memo } from "react";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { readAloud, stopReadingAloud, useReadAloudStore } from "~/readAloud";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Speaks one assistant message; hidden until the environment has a Google TTS key. */
export const ReadAloudButton = memo(function ReadAloudButton({
  environmentId,
  messageId,
  markdown,
}: {
  environmentId: EnvironmentId;
  messageId: string;
  markdown: string;
}) {
  const configured = useEnvironmentSettings(
    environmentId,
    (settings) => settings.textToSpeech.googleApiKey.length > 0,
  );
  const status = useReadAloudStore((state) =>
    state.messageId === messageId ? state.status : "idle",
  );
  if (!configured) return null;

  const active = status !== "idle";
  const label = active ? "Stop reading aloud" : "Read aloud";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={label}
            onClick={() =>
              active ? stopReadingAloud() : void readAloud({ environmentId, messageId, markdown })
            }
            type="button"
            size="xs"
            variant="ghost-muted"
          />
        }
      >
        {status === "loading" ? (
          <Spinner size="xs" />
        ) : status === "playing" ? (
          <SquareIcon className="size-3" />
        ) : (
          <Volume2Icon className="size-3" />
        )}
      </TooltipTrigger>
      <TooltipPopup>
        <p>{label}</p>
      </TooltipPopup>
    </Tooltip>
  );
});
