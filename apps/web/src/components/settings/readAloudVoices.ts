import { type ReadAloudVoice, speechVoiceFamily } from "@t3tools/contracts";

const KIND_LABELS: Record<string, string> = {
  "Chirp3-HD": "Chirp 3 HD",
  "Chirp-HD": "Chirp HD",
  Wavenet: "WaveNet",
};
// Most expressive first: Gemini takes style prompts, Chirp sounds the most natural.
const KIND_ORDER = [
  "Gemini",
  "Chirp 3 HD",
  "Chirp HD",
  "Studio",
  "Neural2",
  "WaveNet",
  "News",
  "Casual",
  "Polyglot",
  "Standard",
];

export interface VoiceOption {
  readonly name: string;
  readonly label: string;
  /** Voice family plus gender, shown beside the label. */
  readonly detail: string;
  readonly kind: string;
}

/** `en-US-Chirp3-HD-Kore` reads as "Kore" (Chirp 3 HD); `en-US-Neural2-F` as "Neural2 F". */
export function describeVoice(voice: Pick<ReadAloudVoice, "name"> & Partial<ReadAloudVoice>) {
  let label = voice.name;
  let kind = "Other";
  if (speechVoiceFamily(voice.name) === "gemini") {
    kind = "Gemini";
  } else {
    const match = /^[a-z]{2,3}-[a-z]{2,3}-(.+)-([^-]+)$/i.exec(voice.name);
    if (match) {
      kind = KIND_LABELS[match[1]!] ?? match[1]!;
      label = /^[A-Z0-9]{1,2}$/.test(match[2]!) ? `${kind} ${match[2]}` : match[2]!;
    }
  }
  const detail = voice.gender ? `${kind} · ${voice.gender}` : kind;
  return { name: voice.name, label, detail, kind } satisfies VoiceOption;
}

export function voiceOptions(voices: readonly ReadAloudVoice[]): VoiceOption[] {
  const rank = (kind: string) => {
    const index = KIND_ORDER.indexOf(kind);
    return index === -1 ? KIND_ORDER.length : index;
  };
  return voices
    .map(describeVoice)
    .toSorted(
      (left, right) =>
        rank(left.kind) - rank(right.kind) ||
        left.label.localeCompare(right.label, undefined, { numeric: true }),
    );
}

let languageNames: Intl.DisplayNames | null | undefined;

/** "da-DK" reads as "Danish (Denmark)" in the viewer's own language. */
export function languageLabel(code: string): string {
  if (languageNames === undefined) {
    try {
      languageNames = new Intl.DisplayNames(undefined, { type: "language" });
    } catch {
      languageNames = null;
    }
  }
  try {
    return languageNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The language a voice speaks: its name prefix, else the chosen language, else en-US. */
export function effectiveLanguage(voice: string, languageCode: string): string {
  if (speechVoiceFamily(voice) !== "gemini") {
    const prefix = /^([a-z]{2,3}-[a-z]{2,3})-/i.exec(voice)?.[1];
    if (prefix) return prefix;
  }
  return languageCode || "en-US";
}
