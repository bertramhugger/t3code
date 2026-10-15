import { ExternalLinkIcon } from "lucide-react";
import { useRef } from "react";

import { InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { SecretInput } from "./SecretInput";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

/**
 * Google Cloud Text-to-Speech for the read-aloud button on assistant messages.
 * The key lives in the server's secret store; clients only learn that one is set.
 */
export function ReadAloudSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const configured = settings.readAloud.googleApiKey.length > 0;
  const voiceEdited = useRef(false);

  return (
    <SettingsSection id="read-aloud" title="Read aloud">
      <SettingsRow
        {...searchableSetting("read-aloud-google-api-key")}
        description={
          <>
            Adds a read-aloud button to agent messages, spoken by Google Cloud Text-to-Speech. The
            key stays on this server.{" "}
            <InlineButton
              render={
                <a
                  href="https://console.cloud.google.com/apis/library/texttospeech.googleapis.com"
                  target="_blank"
                  rel="noreferrer noopener"
                />
              }
            >
              Enable the API
              <ExternalLinkIcon aria-hidden className="size-3" />
            </InlineButton>
          </>
        }
        serverScoped
        settingKeys={["readAloud"]}
        resetAction={
          configured ? (
            <SettingResetButton
              label="Google Cloud API key"
              onClick={() => updateSettings({ readAloud: { googleApiKey: "" } })}
            />
          ) : null
        }
        control={
          <SecretInput
            aria-label="Google Cloud API key"
            size="sm"
            className="w-full sm:w-56"
            configured={configured}
            value=""
            onCommit={(next) => {
              if (next.trim()) updateSettings({ readAloud: { googleApiKey: next.trim() } });
            }}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("read-aloud-voice")}
        description="A Google voice name, such as en-US-Neural2-F or da-DK-Wavenet-A. The language comes from the name. Leave empty for the default US English voice."
        serverScoped
        settingKeys={["readAloud"]}
        resetAction={
          settings.readAloud.voice ? (
            <SettingResetButton
              label="voice"
              onClick={() => updateSettings({ readAloud: { voice: "" } })}
            />
          ) : null
        }
        control={
          <Input
            key={settings.readAloud.voice}
            aria-label="Voice"
            size="sm"
            className="w-full sm:w-56"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Default"
            defaultValue={settings.readAloud.voice}
            onChange={() => {
              voiceEdited.current = true;
            }}
            onBlur={(event) => {
              const voice = event.target.value.trim();
              if (voiceEdited.current && voice !== settings.readAloud.voice)
                updateSettings({ readAloud: { voice } });
              voiceEdited.current = false;
            }}
          />
        }
      />
    </SettingsSection>
  );
}
