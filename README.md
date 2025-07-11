# Handwavy 🫴

An AI-powered presentation assistant that automatically continues your speech when you gesturally handwave. 
Perfect for nervous and ill-prepared public speakers, or anyone who wants seamless speech continuation powered by generative AI.


## How It Works

- **Begin Speaking**: Begin your presentation or speech naturally
- **Handwave**: Whenever you want the AI to take over, simply begin waving your hands
- **(optional) Style customization**: The default style of the continuation is "funny and whimsical", but this can be overridden with any natural language description using the `style` URL parameter
- **AI Continuation**: Once the system detects your handwaving gesture, it transmits the transcript so far and asks Claude to continue your speech in the same style
- **Voice Synthesis**: Listen as the generated continuation is vocalized (using Web Speech API by default, and an ElevenLabs voice if the `voiceId` URL param is provided)
- **(optional) Stop generating**: To interrupt text-to-speech generation, simply hold up your palm ✋

## Tech Stack

- **Backend**: Node.js, Express.js
- **AI**: Anthropic Claude API, ElevenLabs API
- **Computer Vision**: MediaPipe Tasks Vision
- **Frontend**: EJS, JavaScript
- **Real-time Communication**: WebSocket
