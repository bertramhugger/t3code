# Read aloud

T3 Code can read assistant responses aloud with Google Cloud Text-to-Speech. It reads the prose of
a response, including headings, lists, and link text, and skips code blocks and images.

## Setting it up

1. In the [Google Cloud console](https://console.cloud.google.com/), enable the **Cloud
   Text-to-Speech API** for a project with billing, then create an API key under **APIs & Services
   → Credentials**. Restricting the key to the Text-to-Speech API is a good idea.
2. Open **Settings** > **General** > **Read aloud** and paste the key.

The key is stored on the server, not in your browser, so every web and desktop client connected to
that environment can use it, including remote browsers. Clear the field to remove it. The mobile app
does not read aloud yet.

## Using it

Finished responses get a speaker button next to **Copy message**. Press it again to stop. Starting
another response, or switching threads, stops the current one.

Turn on **Read responses aloud automatically** to hear each response when a turn finishes in the
thread you are viewing. This preference is per device. Browsers may block the first automatic
playback until you have clicked or typed in the page.

**Voice** takes any
[Google voice name](https://cloud.google.com/text-to-speech/docs/list-voices-and-types), such as
`en-GB-Neural2-A`; the language comes from the name. Leave it empty for Google's default US English
voice.

Google bills per character read. Very long responses are cut off after 20,000 characters.
