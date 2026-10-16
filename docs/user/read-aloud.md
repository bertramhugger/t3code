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

Leave **Voice** empty for Google's default US English voice, or enter any
[Google voice name](https://cloud.google.com/text-to-speech/docs/voices), such as
`en-US-Neural2-F` or `da-DK-Wavenet-A`. The language comes from the start of the name.

## What gets read

Code blocks, images, and markdown formatting are skipped, and link text is read without the
address. Google bills by character, so long messages cost more.
