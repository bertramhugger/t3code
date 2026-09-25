import { DraftInput } from "../ui/draft-input";
import { Switch } from "../ui/switch";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export function ReadAloudSettings() {
  const googleApiKey = useScopedSettings((settings) => settings.textToSpeech.googleApiKey);
  const voice = useScopedSettings((settings) => settings.textToSpeech.voice);
  const autoplay = useScopedSettings((settings) => settings.readAloudAutoplay);
  const updateSettings = useUpdateScopedSettings();
  const configured = googleApiKey.length > 0;

  return (
    <SettingsSection id="read-aloud" title="Read aloud">
      <SettingsRow
        serverScoped
        settingKeys={["textToSpeech"]}
        {...searchableSetting("read-aloud-google-api-key")}
        description="A Google Cloud API key with the Cloud Text-to-Speech API enabled. Saved on the server; responses get a read aloud button once it is set. Clear the field to remove it."
        control={
          <DraftInput
            size="sm"
            type="password"
            autoComplete="off"
            className="w-full sm:w-56"
            placeholder="Not set"
            aria-label="Google Cloud API key"
            value={googleApiKey}
            onCommit={(next) => updateSettings({ textToSpeech: { googleApiKey: next.trim() } })}
          />
        }
      />
      <SettingsRow
        serverScoped
        settingKeys={["textToSpeech"]}
        {...searchableSetting("read-aloud-voice")}
        description="A Google voice name, such as en-US-Neural2-F or en-GB-Wavenet-B. Leave empty for Google's default US English voice."
        control={
          <DraftInput
            size="sm"
            className="w-full sm:w-56"
            placeholder="Default"
            aria-label="Read aloud voice"
            value={voice}
            onCommit={(next) => updateSettings({ textToSpeech: { voice: next.trim() } })}
          />
        }
      />
      <SettingsRow
        {...searchableSetting("read-aloud-autoplay")}
        description={
          configured
            ? "Read each response aloud when a turn finishes in the thread you are viewing. Applies to this device."
            : "Add a Google Cloud API key to read responses aloud automatically."
        }
        control={
          <Switch
            checked={autoplay}
            disabled={!configured}
            onCheckedChange={(checked) => updateSettings({ readAloudAutoplay: checked })}
            aria-label="Read responses aloud automatically"
          />
        }
      />
    </SettingsSection>
  );
}
