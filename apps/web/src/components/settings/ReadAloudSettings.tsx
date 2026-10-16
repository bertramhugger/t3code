import {
  type EnvironmentId,
  READ_ALOUD_PITCH,
  READ_ALOUD_SPEAKING_RATE,
  speechVoiceLanguage,
  speechVoiceOptions,
} from "@t3tools/contracts";
import { CheckIcon, ExternalLinkIcon, PlayIcon, SquareIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { serverEnvironment } from "~/state/server";
import { useEnvironmentQuery } from "~/state/query";
import { useReadAloudPhase, useToggleReadAloud } from "../chat/readAloudPlayback";
import { Button, InlineButton } from "../ui/button";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../ui/combobox";
import { NumberField, NumberFieldGroup, NumberFieldInput } from "../ui/number-field";
import { SelectButton } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SecretInput } from "./SecretInput";
import { effectiveLanguage, languageLabel, voiceOptions } from "./readAloudVoices";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

const PREVIEW_KEY = "settings:read-aloud-preview";
const PREVIEW_TEXT = "Hi! This is how your agent's messages will sound when they're read aloud.";
// Speed and pitch are exact numbers; grouping or rounding would misreport them.
const DECIMAL_FORMAT: Intl.NumberFormatOptions = { maximumFractionDigits: 2 };

function apiLink(href: string, children: ReactNode) {
  return (
    <InlineButton render={<a href={href} target="_blank" rel="noreferrer noopener" />}>
      {children}
      <ExternalLinkIcon aria-hidden className="size-3" />
    </InlineButton>
  );
}

/**
 * Google Cloud Text-to-Speech for the read-aloud button on assistant messages.
 * The key lives in the server's secret store; clients only learn that one is set.
 * Pitch only shows for voices that accept it; Chirp voices reject it.
 */
export function ReadAloudSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const readAloud = settings.readAloud;
  const configured = readAloud.googleApiKey.length > 0;

  return (
    <SettingsSection id="read-aloud" title="Read aloud">
      <SettingsRow
        {...searchableSetting("read-aloud-google-api-key")}
        description={
          <>
            Adds a read-aloud button to agent messages, spoken by Google Cloud Text-to-Speech. The
            key stays on this server.{" "}
            {apiLink(
              "https://console.cloud.google.com/apis/library/texttospeech.googleapis.com",
              "Enable the API",
            )}
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
      {configured ? <VoiceSettings /> : null}
    </SettingsSection>
  );
}

function VoiceSettings() {
  const { target } = useSettingsScope();
  const environmentId = target?.environmentId ?? null;
  const readAloud = useScopedSettings().readAloud;
  const updateSettings = useUpdateScopedSettings();
  const language = effectiveLanguage(readAloud.voice, readAloud.languageCode);
  const options = speechVoiceOptions(readAloud.voice);
  // A name without a language (an old Gemini choice) plays Google's default voice.
  const voice = speechVoiceLanguage(readAloud.voice) === null ? "" : readAloud.voice;
  const catalog = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.speechVoices({ environmentId, input: { languageCode: language } }),
  );

  const languages = useMemo(
    () =>
      (catalog.data?.languageCodes ?? [language])
        .map((code) => ({ value: code, label: languageLabel(code), detail: code }))
        .toSorted((left, right) => left.label.localeCompare(right.label)),
    [catalog.data, language],
  );
  const voices = useMemo(() => {
    const listed = voiceOptions(catalog.data?.voices ?? []).map((voice) => ({
      value: voice.name,
      label: voice.label,
      detail: voice.detail,
    }));
    const current =
      voice.length > 0 && !listed.some((option) => option.value === voice)
        ? [{ value: voice, label: voice, detail: "" }]
        : [];
    return [{ value: "", label: "Google default", detail: "" }, ...current, ...listed];
  }, [catalog.data, voice]);

  return (
    <>
      <SettingsRow
        {...searchableSetting("read-aloud-language")}
        description="The language voices speak. Voices named for a language always speak it."
        serverScoped
        settingKeys={["readAloud"]}
        control={
          <SearchPicker
            ariaLabel="Read-aloud language"
            searchPlaceholder="Search languages"
            items={languages}
            value={language}
            onChange={(languageCode) =>
              // A voice named for another language would ignore the switch.
              updateSettings({ readAloud: { languageCode, voice: "" } })
            }
          />
        }
      />
      <SettingsRow
        {...searchableSetting("read-aloud-voice")}
        description={catalog.error ?? "Chirp 3 HD voices sound the most natural."}
        serverScoped
        settingKeys={["readAloud"]}
        resetAction={
          readAloud.voice ? (
            <SettingResetButton
              label="voice"
              onClick={() => updateSettings({ readAloud: { voice: "" } })}
            />
          ) : null
        }
        control={
          <div className="flex items-center gap-1.5">
            <SearchPicker
              ariaLabel="Read-aloud voice"
              searchPlaceholder={catalog.isPending ? "Loading voices…" : "Search voices"}
              items={voices}
              value={voice}
              onChange={(next) => updateSettings({ readAloud: { voice: next } })}
            />
            {environmentId === null ? null : <PreviewButton environmentId={environmentId} />}
          </div>
        }
      />
      <SettingsRow
        {...searchableSetting("read-aloud-speed")}
        description="1 is normal speed. Google accepts 0.25 to 4."
        serverScoped
        settingKeys={["readAloud"]}
        resetAction={
          readAloud.speakingRate !== READ_ALOUD_SPEAKING_RATE.default ? (
            <SettingResetButton
              label="speed"
              onClick={() =>
                updateSettings({
                  readAloud: { speakingRate: READ_ALOUD_SPEAKING_RATE.default },
                })
              }
            />
          ) : null
        }
        control={
          <NumberField
            aria-label="Speed"
            value={readAloud.speakingRate}
            min={READ_ALOUD_SPEAKING_RATE.min}
            max={READ_ALOUD_SPEAKING_RATE.max}
            step={0.05}
            format={DECIMAL_FORMAT}
            size="sm"
            className="w-24"
            onValueCommitted={(speakingRate) => {
              if (speakingRate !== null && speakingRate !== readAloud.speakingRate)
                updateSettings({ readAloud: { speakingRate } });
            }}
          >
            <NumberFieldGroup>
              <NumberFieldInput />
            </NumberFieldGroup>
          </NumberField>
        }
      />
      {options.pitch ? (
        <SettingsRow
          {...searchableSetting("read-aloud-pitch")}
          description="Semitones up or down, from -20 to 20. 0 is the voice's natural pitch."
          serverScoped
          settingKeys={["readAloud"]}
          resetAction={
            readAloud.pitch !== READ_ALOUD_PITCH.default ? (
              <SettingResetButton
                label="pitch"
                onClick={() => updateSettings({ readAloud: { pitch: READ_ALOUD_PITCH.default } })}
              />
            ) : null
          }
          control={
            <NumberField
              aria-label="Pitch"
              value={readAloud.pitch}
              min={READ_ALOUD_PITCH.min}
              max={READ_ALOUD_PITCH.max}
              step={0.5}
              format={DECIMAL_FORMAT}
              size="sm"
              className="w-24"
              onValueCommitted={(pitch) => {
                if (pitch !== null && pitch !== readAloud.pitch)
                  updateSettings({ readAloud: { pitch } });
              }}
            >
              <NumberFieldGroup>
                <NumberFieldInput />
              </NumberFieldGroup>
            </NumberField>
          }
        />
      ) : null}
    </>
  );
}

/** Plays a sample sentence with the saved voice and options, or stops it. */
function PreviewButton({ environmentId }: { environmentId: EnvironmentId }) {
  const toggle = useToggleReadAloud();
  const phase = useReadAloudPhase(PREVIEW_KEY);
  const label =
    phase === "loading" ? "Preparing sample…" : phase === "playing" ? "Stop sample" : "Play sample";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            aria-label={label}
            aria-pressed={phase !== "idle"}
            onClick={() => void toggle({ environmentId, key: PREVIEW_KEY, text: PREVIEW_TEXT })}
          />
        }
      >
        {phase === "playing" ? (
          <SquareIcon />
        ) : (
          <PlayIcon className={phase === "loading" ? "animate-pulse" : undefined} />
        )}
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

interface PickerItem {
  readonly value: string;
  readonly label: string;
  readonly detail: string;
}

/** A searchable dropdown; the search matches labels, details, and raw values. */
function SearchPicker({
  ariaLabel,
  searchPlaceholder,
  items,
  value,
  onChange,
}: {
  ariaLabel: string;
  searchPlaceholder: string;
  items: readonly PickerItem[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      `${item.label} ${item.detail} ${item.value}`.toLowerCase().includes(needle),
    );
  }, [items, query]);
  const selected = items.find((item) => item.value === value) ?? null;

  return (
    <Combobox
      items={items}
      filteredItems={filteredItems}
      autoHighlight
      itemToStringLabel={(item: PickerItem) => item.label}
      isItemEqualToValue={(left: PickerItem, right: PickerItem) => left.value === right.value}
      value={selected}
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
      onValueChange={(item: PickerItem | null) => {
        if (item && item.value !== value) onChange(item.value);
      }}
    >
      <ComboboxTrigger aria-label={ariaLabel} render={<SelectButton size="sm" className="w-48" />}>
        <span className="min-w-0 truncate">{selected?.label ?? value}</span>
      </ComboboxTrigger>
      <ComboboxPopup align="end" className="w-72">
        <ComboboxSearchInput
          aria-label={searchPlaceholder}
          placeholder={searchPlaceholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxEmpty>No matches.</ComboboxEmpty>
        <ComboboxList>
          {(item: PickerItem) => (
            <ComboboxItem key={item.value || "default"} value={item}>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.detail ? (
                <span className="shrink-0 text-xs text-muted-foreground">{item.detail}</span>
              ) : null}
              {item.value === value ? <CheckIcon className="size-3.5" /> : null}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
