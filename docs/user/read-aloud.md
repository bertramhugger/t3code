# Read messages aloud

Agent messages can be read aloud by Google Cloud Text-to-Speech, OpenAI, or ElevenLabs. The
read-aloud button sits next to the copy button on each finished agent message. Click it to listen,
and click it again to stop. Starting another message stops the one playing. While a message is
read, the sentence being spoken is highlighted in the message.

To hear the latest agent message without reaching for the mouse, press `mod+alt+r`
(**Cmd+Option+R** on macOS, **Ctrl+Alt+R** elsewhere) or run **Read latest message aloud** from
the command palette. Press it again to stop. You can change the shortcut under
[**Settings → Keybindings**](./keybindings.md).

## Set it up

Under **Settings → Integrations → Read aloud**, choose a **Voice service** and paste its API key:

- **Google Cloud**: in the Google Cloud console, enable the
  [Cloud Text-to-Speech API](https://console.cloud.google.com/apis/library/texttospeech.googleapis.com)
  for a project with billing, then create an API key under **APIs & Services → Credentials**.
  Restricting the key to the Text-to-Speech API is a good idea.
- **OpenAI**: create a key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
  Speech is billed to that OpenAI account.
- **ElevenLabs**: create a key at
  [elevenlabs.io/app/settings/api-keys](https://elevenlabs.io/app/settings/api-keys) with access to
  Text to Speech and Voices. The free plan works.

Each service keeps its own key and voice, so you can switch between them without setting them up
again. Keys are stored on the environment, not on your device, so the desktop app and every browser
connected to that environment get the button, remote ones included. Clients never see the keys.
Without a key for the chosen service, the button does not appear. The mobile app does not read
messages aloud yet.

## Voices

Once a key is set, the settings list that service's voices. Pick one from the searchable list and
press the play button next to it to hear a sample. Every service has a **Speed** setting.

- **Google Cloud**: pick a **Language**, then a **Voice**. Chirp 3 HD voices sound the most natural
  and are listed first. Most voices also have **Pitch**; Chirp voices don't support it, so the
  setting is hidden for them. Voices named for a language, such as `da-DK-Wavenet-F`, always speak
  that language. Google's Gemini voices are not offered: they need a signed-in Google account
  rather than an API key.
- **OpenAI**: pick a **Speech model** and a **Voice**. With GPT-4o mini TTS you can describe how it
  should read under **Reading style**, for example "calm and warm, a little faster than normal".
  Voices speak whatever language the message is in.
- **ElevenLabs**: pick a **Speech model** and one of the voices in your ElevenLabs library. Add more
  voices from the Voice Library on elevenlabs.io and they appear here. ElevenLabs accepts speeds
  from 0.7 to 1.2.

**Audio quality** (Google Cloud and OpenAI) is **Standard** by default: compressed MP3, small enough
for any connection. **High** sends uncompressed audio, which sounds noticeably clearer but makes
each message about 12 times larger (roughly 1.4 MB for a 30-second message). On a slow remote
connection, that means a longer wait before playback starts. ElevenLabs always sends high-quality
MP3.

## What gets read

Code blocks, images, and markdown formatting are skipped, and link text is read without the
address. All three services bill by character, so long messages cost more.
