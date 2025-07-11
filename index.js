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

dotenv.config();

if (!process.env.VERCEL_ANTHROPIC_API_KEY) {
  console.error("VERCEL_ANTHROPIC_API_KEY is not set in environment variables");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// Express app setup
const app = express();
const server = http.createServer(app);

// Middleware configuration
app.use(morgan("tiny"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// View engine configuration
app.set("view engine", "ejs");
app.set("views", __dirname + "/public"); // Set the EJS views directory


// Initialize Anthropic client for text continuation
const anthropic = new Anthropic({
  apiKey: process.env["VERCEL_ANTHROPIC_API_KEY"]
});

// Initialize ElevenLabs client for TTS
const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY
});

// Create WebSocket server
const wss = new WebSocketServer({ 
  server,
  path: '/ws',
  perMessageDeflate: false
});

// =============================================================================
// ROUTES
// =============================================================================

// Main application route
app.get("/", (req, res) => {
  res.render(__dirname + "/public/handwave.ejs", {
    apiKey: process.env["VERCEL_ANTHROPIC_API_KEY"]
  });
});

// ElevenLabs Text-to-Speech endpoint
app.get("/api/tts", async (req, res) => {
  const { text, voiceId } = req.query;
  
  console.log('TTS request received:', { text, voiceId });
  
  // Validate required parameters
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
    
    // Generate audio stream from ElevenLabs
    const audioStream = await elevenlabs.textToSpeech.stream(voiceId, {
      text: text,
      modelId: 'eleven_multilingual_v2',
      voiceSettings: {
        speed: 1.05, // Slightly faster than normal speech
      }
    });

    // Set appropriate headers for audio streaming
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    // Stream audio chunks to the client
    for await (const chunk of audioStream) {
      res.write(chunk);
    }
    res.end();
  } catch (error) {
    console.error('ElevenLabs API error:', error);
    res.status(500).json({ error: 'Failed to generate speech' });
  }
});


// Add error handling for WebSocket server
if (wss) {
  wss.on('error', (error) => {
    console.error('WebSocket server error:', error);
  });

  wss.on('connection', (ws) => {
    console.log('New WebSocket connection established');

  // WebSocket message handler for continuation requests
  ws.on('message', async (message) => {
      try {
        const { transcription, style } = JSON.parse(message);
        console.log('Received handwave request:', { transcription, style });
        
        // Construct prompt for AI continuation
        const prompt = `You are a helpful co-presenter, and are jumping in to continue
        a speech once the current speaker starts handwaving.
        Please give a direct continuation of this fragment of a speech in a ${style} style otherwise continuous with the previous speaker.
        DO NOT include any stage directions, commentary, or preamble, and exclude the fragment itself: 
        "${transcription}"`;

        console.log('prompt: ', prompt);

        // Stream AI response chunks to client
        const stream = anthropic.messages
          .stream({
            model: 'claude-sonnet-4-20250514',
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
        
        // Signal completion
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

// Handle graceful shutdown on SIGTERM (production environments)
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

// Handle graceful shutdown on SIGINT (development environments)
process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

// Start the server
startServer(port);

export default app;
