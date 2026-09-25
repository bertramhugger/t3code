import { renderCodexDirectivesForCopy } from "@t3tools/client-runtime/codex-markdown-directives";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useRef } from "react";

import { readAloud, stopReadingAloud } from "~/readAloud";
import type { Thread } from "~/types";
import { useClientSettings, useEnvironmentSettings } from "./useSettings";

/**
 * Reads the open thread's final response aloud when a turn completes while
 * the thread is on screen, if the user turned on automatic reading. Opening a
 * thread never reads its existing last response, and leaving the thread stops
 * whatever it was saying.
 */
export function useAutoReadAloud(thread: Thread | null, environmentId: EnvironmentId): void {
  const enabled = useClientSettings((settings) => settings.readAloudAutoplay);
  const configured = useEnvironmentSettings(
    environmentId,
    (settings) => settings.textToSpeech.googleApiKey.length > 0,
  );
  const threadId = thread?.id ?? null;
  const latestTurn = thread?.latestTurn ?? null;
  const completedTurnId = latestTurn?.state === "completed" ? latestTurn.turnId : null;
  const response =
    completedTurnId === null
      ? undefined
      : thread?.messages.findLast(
          (message) => message.role === "assistant" && message.turnId === completedTurnId,
        );
  const responseText = response && !response.streaming ? response.text.trim() : "";
  // The completed turn already accounted for on this thread: the one present
  // when the thread opened, or the last one read.
  const handled = useRef<{ threadId: string; turnId: string | null } | null>(null);

  useEffect(() => stopReadingAloud, []);

  useEffect(() => {
    if (threadId === null) return;
    if (handled.current?.threadId !== threadId) {
      // A different thread is on screen; the previous one should go quiet.
      if (handled.current !== null) stopReadingAloud();
      handled.current = { threadId, turnId: completedTurnId };
      return;
    }
    if (completedTurnId === null || completedTurnId === handled.current.turnId) return;
    // The completion can land before the final message text; wait for it.
    if (!response || responseText.length === 0) return;
    handled.current = { threadId, turnId: completedTurnId };
    if (!enabled || !configured) return;
    void readAloud({
      environmentId,
      messageId: response.id,
      markdown: renderCodexDirectivesForCopy(responseText),
      quiet: true,
    });
  }, [completedTurnId, configured, enabled, environmentId, response, responseText, threadId]);
}
