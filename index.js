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

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set in environment variables");
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
  apiKey: process.env["ANTHROPIC_API_KEY"]
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
  res.render(__dirname + "/public/handwave.ejs");
});

// ElevenLabs Text-to-Speech endpoint
app.get("/api/tts", async (req, res) => {
  const { text, voiceId } = req.query;
  
  // Validate required parameters
  if (!text || !voiceId) {
    return res.status(400).json({ error: 'Missing text or voiceId parameter' });
  }

  if (text.trim().length === 0) {
    return res.status(400).json({ error: 'Text cannot be empty' });
  }

  try {
    // Generate audio stream from ElevenLabs
    const audioStream = await elevenlabs.textToSpeech.stream(voiceId, {
      text: text,
      modelId: 'eleven_multilingual_v2',
      voiceSettings: {
        speed: 1.05, // Slightly faster than normal speech
      },
      flush: true
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
    console.error('TTS error details:', {
      message: error.message,
      details: error.stack,
      voiceId,
      text: text.substring(0, 100) + '...', // Log first 100 chars of text
      apiKey: process.env.ELEVENLABS_API_KEY ? 'Set' : 'Not set',
      textLength: text.length
    });
    
    // Check for specific ElevenLabs error types
    if (error.message.includes('401')) {
      res.status(401).json({ 
        error: 'ElevenLabs API key invalid or expired',
        details: error.message 
      });
    } else if (error.message.includes('429')) {
      res.status(429).json({ 
        error: 'ElevenLabs API rate limit exceeded',
        details: error.message 
      });
    } else if (error.message.includes('404')) {
      res.status(404).json({ 
        error: 'ElevenLabs voice ID not found',
        details: error.message 
      });
    } else {
      res.status(500).json({ 
        error: 'Failed to generate speech',
        details: error.message 
      });
    }
  }
});

// Add error handling for WebSocket server
if (wss) {
  wss.on('error', (error) => {
    console.error('WebSocket server error:', error.message);
  });

  wss.on('connection', (ws) => {
    // WebSocket message handler for continuation requests
    ws.on('message', async (message) => {
        try {
          const { transcription, style } = JSON.parse(message);
          
          // Construct prompt for AI continuation
          const prompt = `You are a helpful co-presenter, and are jumping in to continue a speech once the current speaker starts handwaving.
          Please give a direct continuation of this fragment of a speech in a ${style} style otherwise continuous with the style of the speaker.
          DO NOT include any stage directions, commentary, or preamble, and exclude the fragment itself: 
          "${transcription}"`;

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
        console.info('WebSocket connection closed');
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
      startServer(port + 1);
    } else {
      console.error('Server error:', error);
    }
  }
};

// Handle graceful shutdown on SIGTERM (production environments)
process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});

// Handle graceful shutdown on SIGINT (development environments)
process.on('SIGINT', () => {
  server.close(() => {
    process.exit(0);
  });
});

// Start the server
startServer(port);

export default app;
