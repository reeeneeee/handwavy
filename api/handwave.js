import Anthropic from "@anthropic-ai/sdk";
import dotenv from 'dotenv';

dotenv.config();

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle OPTIONS request for CORS
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'GET') {
    const headers = {
      'Content-Type': 'text/event-stream',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache'
    };
    res.writeHead(200, headers);

    const transcription = req.query.transcription;
    const style = req.query.style;
    
    try {
      const message = `You are a helpful co-presenter, and are jumping in to continue
    a speech once the current speaker starts handwaving.
    Please give a direct continuation of this fragment of a speech in a ${style} style.
    DO NOT include any stage directions, commentary, or preamble, and exclude the fragment itself: "${transcription}"`;
      
      let fullMessage = '';
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY
      });

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
        fullMessage += text;
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
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
} 