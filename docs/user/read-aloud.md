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

Once a key is set, **Settings → Integrations → Read aloud** lists the voices Google offers.
Pick a **Language**, then a **Voice** from the searchable list, and press the play button next to
it to hear a sample. Chirp 3 HD voices sound the most natural and are listed first.

Every voice has a **Speed** setting. Most voices also have **Pitch**; Chirp voices don't support
it, so the setting is hidden for them. Voices named for a language, such as `da-DK-Wavenet-F`,
always speak that language.

**Audio quality** is **Standard** by default: compressed MP3, small enough for any connection. **High**
sends the uncompressed audio Google renders, which sounds noticeably clearer but makes each message
about 12 times larger (roughly 1.4 MB for a 30-second message). On a slow remote connection, that
means a longer wait before playback starts.

Google's Gemini voices, which follow a reading style you describe, are not offered: they need a
signed-in Google account rather than an API key.

## What gets read

Code blocks, images, and markdown formatting are skipped, and link text is read without the
address. Google bills by character, so long messages cost more.
