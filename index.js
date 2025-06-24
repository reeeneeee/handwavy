import bodyParser from "body-parser";
import { dirname } from "path";
import { fileURLToPath } from "url";
import morgan from "morgan";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from 'dotenv';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { WebSocketServer } from 'ws';
import http from 'http';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);

// Create WebSocket server for all environments
const wss = new WebSocketServer({ 
  server,
  path: '/ws',
  perMessageDeflate: false
});

app.use(morgan("tiny"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");
app.set("views", __dirname + "/public");

dotenv.config();
if (!process.env.VERCEL_ANTHROPIC_API_KEY) {
  console.error("VERCEL_ANTHROPIC_API_KEY is not set in environment variables");
  process.exit(1);
}
const anthropic = new Anthropic({
  apiKey: process.env["VERCEL_ANTHROPIC_API_KEY"]
});

// Initialize ElevenLabs client
const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY
});

app.get("/", (req, res) => {
  res.render(__dirname + "/public/handwave.ejs", {
    apiKey: process.env["VERCEL_ANTHROPIC_API_KEY"]
  });
});

// Add error handling for WebSocket server
if (wss) {
  wss.on('error', (error) => {
    console.error('WebSocket server error:', error);
  });

  wss.on('connection', (ws) => {
    console.log('New WebSocket connection established');

    ws.on('message', async (message) => {
      try {
        const { transcription, style } = JSON.parse(message);
        console.log('Received handwave request:', { transcription, style });

        let styleText = style === '' ? 'humorous and whimsical style' : `${style} style`;
        styleText += ' otherwise continuous with the previous speaker';
        
        const prompt = `You are a helpful co-presenter, and are jumping in to continue
        a speech once the current speaker starts handwaving.
        Please give a direct continuation of this fragment of a speech in a ${styleText}.
        DO NOT include any stage directions, commentary, or preamble, and exclude the fragment itself: 
        "${transcription}"`;

        console.log('prompt: ', prompt);

        let startTime = performance.now();
        const stream = anthropic.messages
          .stream({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 1024,
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
          })
          .on('text', (text) => {
            console.log('received chunk:', text);
            ws.send(JSON.stringify({ type: 'chunk', text: text }));
          });
        ws.send(JSON.stringify({ type: 'complete' }));

      } catch (error) {
        console.error("Error processing handwave:", error);
        ws.send(JSON.stringify({ 
          type: 'error',
          error: error.message,
          details: error.stack 
        }));
      }
    });

    ws.on('close', () => {
      console.log('WebSocket connection closed');
    });
  });
}

// Add ElevenLabs endpoint
app.get("/api/tts", async (req, res) => {
  const { text, voiceId } = req.query;
  
  console.log('TTS request received:', { text, voiceId });
  
  if (!text || !voiceId) {
    console.log('Missing parameters:', { text, voiceId });
    return res.status(400).json({ error: 'Missing text or voiceId parameter' });
  }

  if (text.trim().length === 0) {
    console.log('Empty text received');
    return res.status(400).json({ error: 'Text cannot be empty' });
  }

  try {
    console.log('Calling ElevenLabs API with text:', text);
    const audioStream = await elevenlabs.textToSpeech.stream(voiceId, {
      text: text,
      modelId: 'eleven_multilingual_v2',
      voiceSettings: {
        speed: 1.05,
      }
    });

    // Set appropriate headers for audio streaming
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    // Pipe the audio stream to the response
    for await (const chunk of audioStream) {
      res.write(chunk);
    }
    res.end();
  } catch (error) {
    console.error('ElevenLabs API error:', error);
    res.status(500).json({ error: 'Failed to generate speech' });
  }
});

const port = process.env.PORT || 3000;

const startServer = async (port) => {
  try {
    server.listen(port, '0.0.0.0', () => {
      console.log(`Server listening on port ${port}`);
    });
  } catch (error) {
    if (error.code === 'EADDRINUSE') {
      console.log(`Port ${port} is busy, trying ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', error);
    }
  }
};

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

startServer(port);

export default app;
