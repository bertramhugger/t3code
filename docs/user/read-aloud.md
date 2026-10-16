# Read messages aloud

Agent messages can be read aloud by Google Cloud Text-to-Speech. The read-aloud button sits next
to the copy button on each finished agent message. Click it to listen, and click it again to stop.
Starting another message stops the one playing.

To hear the latest agent message without reaching for the mouse, press `mod+alt+r`
(**Cmd+Option+R** on macOS, **Ctrl+Alt+R** elsewhere) or run **Read latest message aloud** from
the command palette. Press it again to stop. You can change the shortcut under
[**Settings → Keybindings**](./keybindings.md).

## Set it up

1. In the Google Cloud console, enable the
   [Cloud Text-to-Speech API](https://console.cloud.google.com/apis/library/texttospeech.googleapis.com)
   for a project with billing, then create an API key under **APIs & Services → Credentials**.
   Restricting the key to the Text-to-Speech API is a good idea.
2. Paste the key under **Settings → Integrations → Read aloud**.

The key is stored on the environment, not on your device, so the desktop app and every browser
connected to that environment get the button, remote ones included. Clients never see the key.
Without a key the button does not appear. The mobile app does not read messages aloud yet.

## Voices

Once a key is set, **Settings → Integrations → Read aloud** lists every voice Google offers.
Pick a **Language**, then a **Voice** from the searchable list, and press the play button next to
it to hear a sample. The options below the voice change with the voice you pick:

- **Gemini** voices (such as Kore or Puck) speak any language and follow a **Reading style** you
  describe in your own words, for example "calm and warm, a little faster than normal". Choose
  the Gemini model under **Gemini voice model**. Gemini voices also need the
  [Agent Platform API](https://console.cloud.google.com/apis/library/aiplatform.googleapis.com)
  enabled in the same Google Cloud project; if your key is restricted to certain APIs, allow that
  one too.
- **Chirp 3 HD** and **Chirp HD** voices sound the most natural. They have a **Speed** setting.
- **Studio**, **Neural2**, **WaveNet**, **Standard**, and the other voices have **Speed** and
  **Pitch** settings.

Voices named for a language, such as `da-DK-Wavenet-F`, always speak that language.

## What gets read

Code blocks, images, and markdown formatting are skipped, and link text is read without the
address. Google bills by character, so long messages cost more.
