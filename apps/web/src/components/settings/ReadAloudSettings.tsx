import {
  type EnvironmentId,
  READ_ALOUD_ELEVENLABS_DEFAULT_VOICE,
  READ_ALOUD_ELEVENLABS_MODELS,
  READ_ALOUD_OPENAI_MODELS,
  READ_ALOUD_PITCH,
  READ_ALOUD_SPEAKING_RATE,
  READ_ALOUD_SPEED_RANGE,
  READ_ALOUD_STYLE_PROMPT_MAX_LENGTH,
  type ReadAloudAudioQuality,
  type ReadAloudProvider,
  type ReadAloudSettings as ReadAloudSettingsValue,
  type ReadAloudVoiceList,
  readAloudApiKey,
  speechVoiceLanguage,
  speechVoiceOptions,
} from "@t3tools/contracts";
import { CheckIcon, ExternalLinkIcon, PlayIcon, SquareIcon } from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";

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
import {
  Select,
  SelectButton,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Textarea } from "../ui/textarea";
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

const PROVIDERS: Record<
  ReadAloudProvider,
  {
    label: string;
    keyField: "googleApiKey" | "openaiApiKey" | "elevenlabsApiKey";
    keySetting:
      | "read-aloud-google-api-key"
      | "read-aloud-openai-api-key"
      | "read-aloud-elevenlabs-api-key";
    keyDescription: string;
    keyLink: { href: string; label: string };
  }
> = {
  google: {
    label: "Google Cloud",
    keyField: "googleApiKey",
    keySetting: "read-aloud-google-api-key",
    keyDescription: "A Google Cloud API key with the Text-to-Speech API enabled.",
    keyLink: {
      href: "https://console.cloud.google.com/apis/library/texttospeech.googleapis.com",
      label: "Enable the API",
    },
  },
  openai: {
    label: "OpenAI",
    keyField: "openaiApiKey",
    keySetting: "read-aloud-openai-api-key",
    keyDescription: "An OpenAI API key. Speech is billed to that OpenAI account.",
    keyLink: { href: "https://platform.openai.com/api-keys", label: "Create a key" },
  },
  elevenlabs: {
    label: "ElevenLabs",
    keyField: "elevenlabsApiKey",
    keySetting: "read-aloud-elevenlabs-api-key",
    keyDescription:
      "An ElevenLabs API key with Text to Speech and Voices access. The free plan works.",
    keyLink: { href: "https://elevenlabs.io/app/settings/api-keys", label: "Create a key" },
  },
};

const OPENAI_MODEL_LABELS: Record<(typeof READ_ALOUD_OPENAI_MODELS)[number], string> = {
  "gpt-4o-mini-tts": "GPT-4o mini TTS",
  "tts-1-hd": "TTS-1 HD",
  "tts-1": "TTS-1",
};
const ELEVENLABS_MODEL_LABELS: Record<(typeof READ_ALOUD_ELEVENLABS_MODELS)[number], string> = {
  eleven_multilingual_v2: "Multilingual v2",
  eleven_v3: "Eleven v3",
  eleven_flash_v2_5: "Flash v2.5",
  eleven_turbo_v2_5: "Turbo v2.5",
};
const AUDIO_QUALITY_LABELS: Record<ReadAloudAudioQuality, string> = {
  standard: "Standard",
  high: "High",
};

function apiLink(href: string, children: ReactNode) {
  return (
    <InlineButton render={<a href={href} target="_blank" rel="noreferrer noopener" />}>
      {children}
      <ExternalLinkIcon aria-hidden className="size-3" />
    </InlineButton>
  );
}

/**
 * The speech service and voice for the read-aloud button on assistant messages.
 * Keys live in the server's secret store; clients only learn that one is set.
 * Each service keeps its own key and voice, so switching back loses nothing.
 */
export function ReadAloudSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const readAloud = settings.readAloud;
  const provider = PROVIDERS[readAloud.provider];
  const configured = readAloudApiKey(readAloud).length > 0;

  return (
    <SettingsSection id="read-aloud" title="Read aloud">
      <SettingsRow
        {...searchableSetting("read-aloud-provider")}
        description="Adds a read-aloud button to agent messages. Pick the service that speaks them."
        serverScoped
        settingKeys={["readAloud"]}
        control={
          <Select
            value={readAloud.provider}
            onValueChange={(next) => {
              if (next) updateSettings({ readAloud: { provider: next } });
            }}
          >
            <SelectTrigger size="sm" aria-label="Voice service">
              <SelectValue>{(value: ReadAloudProvider) => PROVIDERS[value].label}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {(["google", "openai", "elevenlabs"] as const).map((value) => (
                <SelectItem key={value} value={value}>
                  {PROVIDERS[value].label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
      <SettingsRow
        key={readAloud.provider}
        {...searchableSetting(provider.keySetting)}
        description={
          <>
            {provider.keyDescription} The key stays on this server.{" "}
            {apiLink(provider.keyLink.href, provider.keyLink.label)}
          </>
        }
        serverScoped
        settingKeys={["readAloud"]}
        resetAction={
          configured ? (
            <SettingResetButton
              label={`${provider.label} API key`}
              onClick={() => updateSettings({ readAloud: { [provider.keyField]: "" } })}
            />
          ) : null
        }
        control={
          <SecretInput
            aria-label={`${provider.label} API key`}
            size="sm"
            className="w-full sm:w-56"
            configured={configured}
            value=""
            onCommit={(next) => {
              if (next.trim()) updateSettings({ readAloud: { [provider.keyField]: next.trim() } });
            }}
          />
        }
      />
      {configured ? <VoiceSettings readAloud={readAloud} /> : null}
    </SettingsSection>
  );
}

function VoiceSettings({ readAloud }: { readAloud: ReadAloudSettingsValue }) {
  const { target } = useSettingsScope();
  const environmentId = target?.environmentId ?? null;
  const updateSettings = useUpdateScopedSettings();
  const { provider } = readAloud;
  const language = effectiveLanguage(readAloud.voice, readAloud.languageCode);
  const catalog = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.speechVoices({
          environmentId,
          input: { provider, languageCode: language },
        }),
  );
  const preview = environmentId === null ? null : <PreviewButton environmentId={environmentId} />;

  return (
    <>
      {provider === "google" ? (
        <GoogleVoiceRows readAloud={readAloud} catalog={catalog} preview={preview} />
      ) : provider === "openai" ? (
        <>
          <ModelRow
            value={readAloud.openaiModel}
            labels={OPENAI_MODEL_LABELS}
            description="GPT-4o mini TTS sounds the most natural and follows a reading style. TTS-1 is faster; TTS-1 HD is clearer."
            onChange={(openaiModel) => updateSettings({ readAloud: { openaiModel } })}
          />
          <VoiceRow
            catalog={catalog}
            value={readAloud.openaiVoice}
            defaultLabel={null}
            description={catalog.error ?? "Marin and Cedar sound the most natural."}
            preview={preview}
            onChange={(openaiVoice) => updateSettings({ readAloud: { openaiVoice } })}
          />
          {readAloud.openaiModel === "gpt-4o-mini-tts" ? (
            <StyleRow
              value={readAloud.openaiInstructions}
              onChange={(openaiInstructions) =>
                updateSettings({ readAloud: { openaiInstructions } })
              }
            />
          ) : null}
        </>
      ) : (
        <>
          <ModelRow
            value={readAloud.elevenlabsModel}
            labels={ELEVENLABS_MODEL_LABELS}
            description="Multilingual v2 is the most consistent. v3 is the most expressive. Flash and Turbo are faster and cost less."
            onChange={(elevenlabsModel) => updateSettings({ readAloud: { elevenlabsModel } })}
          />
          <VoiceRow
            catalog={catalog}
            value={readAloud.elevenlabsVoiceId || READ_ALOUD_ELEVENLABS_DEFAULT_VOICE}
            defaultLabel={null}
            description={
              catalog.error ??
              "The voices in your ElevenLabs library. Add more from the Voice Library on elevenlabs.io."
            }
            preview={preview}
            onChange={(elevenlabsVoiceId) => updateSettings({ readAloud: { elevenlabsVoiceId } })}
          />
        </>
      )}
      <SpeedRow readAloud={readAloud} />
      {provider === "elevenlabs" ? null : <AudioQualityRow readAloud={readAloud} />}
      {provider === "google" && speechVoiceOptions(readAloud.voice).pitch ? (
        <PitchRow readAloud={readAloud} />
      ) : null}
    </>
  );
}

type VoiceCatalog = ReturnType<typeof useEnvironmentQuery<ReadAloudVoiceList, unknown>>;

function GoogleVoiceRows({
  readAloud,
  catalog,
  preview,
}: {
  readAloud: ReadAloudSettingsValue;
  catalog: VoiceCatalog;
  preview: ReactNode;
}) {
  const updateSettings = useUpdateScopedSettings();
  const language = effectiveLanguage(readAloud.voice, readAloud.languageCode);
  // A name without a language (an old Gemini choice) plays Google's default voice.
  const voice = speechVoiceLanguage(readAloud.voice) === null ? "" : readAloud.voice;
  const languages = useMemo(
    () =>
      (catalog.data?.languageCodes ?? [language])
        .map((code) => ({ value: code, label: languageLabel(code), detail: code }))
        .toSorted((left, right) => left.label.localeCompare(right.label)),
    [catalog.data, language],
  );

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
      <VoiceRow
        google
        catalog={catalog}
        value={voice}
        defaultLabel="Google default"
        description={catalog.error ?? "Chirp 3 HD voices sound the most natural."}
        preview={preview}
        onChange={(next) => updateSettings({ readAloud: { voice: next } })}
        onReset={readAloud.voice ? () => updateSettings({ readAloud: { voice: "" } }) : undefined}
      />
    </>
  );
}

/** A searchable voice list from the server, with a sample button. */
function VoiceRow({
  google = false,
  catalog,
  value,
  defaultLabel,
  description,
  preview,
  onChange,
  onReset,
}: {
  google?: boolean;
  catalog: VoiceCatalog;
  value: string;
  /** Offered first as the empty value, for services with a default voice. */
  defaultLabel: string | null;
  description: string;
  preview: ReactNode;
  onChange: (voice: string) => void;
  onReset?: (() => void) | undefined;
}) {
  const voices = useMemo(() => {
    // Google names voices by family; the other services give a display name.
    const listed = google
      ? voiceOptions(catalog.data?.voices ?? []).map((voice) => ({
          value: voice.name,
          label: voice.label,
          detail: voice.detail,
        }))
      : (catalog.data?.voices ?? []).map((voice) => ({
          value: voice.name,
          label: voice.label ?? voice.name,
          detail: [voice.description, voice.gender].filter(Boolean).join(" · "),
        }));
    const current =
      value.length > 0 && !listed.some((option) => option.value === value)
        ? [{ value, label: value, detail: "" }]
        : [];
    const fallback = defaultLabel === null ? [] : [{ value: "", label: defaultLabel, detail: "" }];
    return [...fallback, ...current, ...listed];
  }, [catalog.data, defaultLabel, google, value]);

  return (
    <SettingsRow
      {...searchableSetting("read-aloud-voice")}
      description={description}
      serverScoped
      settingKeys={["readAloud"]}
      resetAction={onReset ? <SettingResetButton label="voice" onClick={onReset} /> : null}
      control={
        <div className="flex items-center gap-1.5">
          <SearchPicker
            ariaLabel="Read-aloud voice"
            searchPlaceholder={catalog.isPending ? "Loading voices…" : "Search voices"}
            items={voices}
            value={value}
            onChange={onChange}
          />
          {preview}
        </div>
      }
    />
  );
}

function ModelRow<Model extends string>({
  value,
  labels,
  description,
  onChange,
}: {
  value: Model;
  labels: Record<Model, string>;
  description: string;
  onChange: (model: Model) => void;
}) {
  return (
    <SettingsRow
      {...searchableSetting("read-aloud-model")}
      description={description}
      serverScoped
      settingKeys={["readAloud"]}
      control={
        <Select
          value={value}
          onValueChange={(next) => {
            if (next) onChange(next);
          }}
        >
          <SelectTrigger size="sm" aria-label="Speech model">
            <SelectValue>{(model: Model) => labels[model]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {(Object.keys(labels) as Model[]).map((model) => (
              <SelectItem key={model} value={model}>
                {labels[model]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

function StyleRow({ value, onChange }: { value: string; onChange: (style: string) => void }) {
  const edited = useRef(false);
  return (
    <SettingsRow
      {...searchableSetting("read-aloud-style")}
      description="Describe how the voice should read: tone, pace, accent, or character. Leave empty for a neutral read."
      serverScoped
      settingKeys={["readAloud"]}
      resetAction={
        value ? <SettingResetButton label="reading style" onClick={() => onChange("")} /> : null
      }
    >
      <div className="mt-3 max-w-2xl pb-3.5">
        <Textarea
          key={value}
          aria-label="Reading style"
          rows={3}
          maxLength={READ_ALOUD_STYLE_PROMPT_MAX_LENGTH}
          defaultValue={value}
          placeholder="Read in a calm, warm voice, a little faster than normal, like a friendly podcast host."
          onChange={() => {
            edited.current = true;
          }}
          onBlur={(event) => {
            const next = event.target.value.trim();
            if (edited.current && next !== value) onChange(next);
            edited.current = false;
          }}
        />
      </div>
    </SettingsRow>
  );
}

function SpeedRow({ readAloud }: { readAloud: ReadAloudSettingsValue }) {
  const updateSettings = useUpdateScopedSettings();
  const range = READ_ALOUD_SPEED_RANGE[readAloud.provider];
  return (
    <SettingsRow
      {...searchableSetting("read-aloud-speed")}
      description={`1 is normal speed. ${PROVIDERS[readAloud.provider].label} accepts ${range.min} to ${range.max}.`}
      serverScoped
      settingKeys={["readAloud"]}
      resetAction={
        readAloud.speakingRate !== READ_ALOUD_SPEAKING_RATE.default ? (
          <SettingResetButton
            label="speed"
            onClick={() =>
              updateSettings({ readAloud: { speakingRate: READ_ALOUD_SPEAKING_RATE.default } })
            }
          />
        ) : null
      }
      control={
        <NumberField
          aria-label="Speed"
          value={Math.min(range.max, Math.max(range.min, readAloud.speakingRate))}
          min={range.min}
          max={range.max}
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
  );
}

function AudioQualityRow({ readAloud }: { readAloud: ReadAloudSettingsValue }) {
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("read-aloud-audio-quality")}
      description="Standard is compressed MP3. High is uncompressed and sounds clearer, but each message is about 12 times larger, which matters on slow remote connections."
      serverScoped
      settingKeys={["readAloud"]}
      resetAction={
        readAloud.audioQuality !== "standard" ? (
          <SettingResetButton
            label="audio quality"
            onClick={() => updateSettings({ readAloud: { audioQuality: "standard" } })}
          />
        ) : null
      }
      control={
        <Select
          value={readAloud.audioQuality}
          onValueChange={(audioQuality) => {
            if (audioQuality) updateSettings({ readAloud: { audioQuality } });
          }}
        >
          <SelectTrigger size="sm" aria-label="Audio quality">
            <SelectValue>
              {(value: ReadAloudAudioQuality) => AUDIO_QUALITY_LABELS[value]}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {(["standard", "high"] as const).map((quality) => (
              <SelectItem key={quality} value={quality}>
                {AUDIO_QUALITY_LABELS[quality]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

function PitchRow({ readAloud }: { readAloud: ReadAloudSettingsValue }) {
  const updateSettings = useUpdateScopedSettings();
  return (
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
      <ComboboxPopup align="end" className="w-80">
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
                <span className="max-w-40 shrink-0 truncate text-xs text-muted-foreground">
                  {item.detail}
                </span>
              ) : null}
              {item.value === value ? <CheckIcon className="size-3.5" /> : null}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
