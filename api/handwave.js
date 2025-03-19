import Anthropic from "@anthropic-ai/sdk";
import dotenv from 'dotenv';

dotenv.config();

export default async function handler(req, res) {
  console.log('API route hit:', req.method, req.url);
  
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
    console.log('Handling OPTIONS request');
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    console.log('Method not allowed:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check for API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set');
    return res.status(500).json({ 
      error: 'Server configuration error',
      details: 'ANTHROPIC_API_KEY environment variable is not set'
    });
  }

  console.log('Request body:', req.body);
  const {transcription, style } = req.body;

  try {
    const message = `Please directly continue this fragment of a speech
    in a ${style} style. PLEASE do not include
    any commentary or preamble, and exclude the fragment itself: "${transcription}"`;
    
    console.log('Creating Anthropic client');
    const anthropic = new Anthropic({
      apiKey: apiKey
    });

    console.log('Sending message to Anthropic');
    const msg = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      messages: [{ role: "user", content: message}],
    });
    
    console.log('Got response from Anthropic');
    return res.status(200).json({ continuation: msg.content[0].text });
  } catch (error) {
    console.error("Detailed error:", error);
    return res.status(500).json({ 
      error: error.message,
      details: error.stack 
    });
  }
} 