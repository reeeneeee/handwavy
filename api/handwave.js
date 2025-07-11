// Imports
import Anthropic from "@anthropic-ai/sdk";
import dotenv from 'dotenv';

// Configuration

// Load environment variables
dotenv.config();

// Configure CORS headers
function configureCORS(res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );
}

// Main serverless function handler for AI speech continuation
export default async function handler(req, res) {
  // Configure CORS headers
  configureCORS(res);

  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow GET requests for speech continuation
  if (req.method === 'GET') {
    await handleSpeechContinuation(req, res);
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}

// Speech continuation logic
async function handleSpeechContinuation(req, res) {
  // SSE headers for streaming
  const headers = {
    'Content-Type': 'text/event-stream',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache'
  };
  res.writeHead(200, headers);

  // Get parameters from query string
  const transcription = req.query.transcription;
  const style = req.query.style;
  
  try {
    // Construct LLM prompt for speech continuation
    const message = `You are a helpful co-presenter, and are jumping in to continue
    a speech once the current speaker starts handwaving.
    Please give a direct continuation of this fragment of a speech in a ${style} style otherwise continuous with the previous speaker.
    DO NOT include any stage directions, commentary, or preamble, and exclude the fragment itself: "${transcription}"`;
    
    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: process.env.VERCEL_ANTHROPIC_API_KEY
    });

    // Stream AI response chunks to client
    const stream = await anthropic.messages
      .stream({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: message,
          },
        ],
      })
      .on('text', (text) => {
        // Send each text chunk as an SSE
        const data = `data: ${JSON.stringify(text)}\n\n`;
        res.write(data);
      });
    
  } catch (error) {
    console.error("Detailed error:", error);
    res.status(500).json({ 
      error: error.message,
      details: error.stack 
    });
  }
} 