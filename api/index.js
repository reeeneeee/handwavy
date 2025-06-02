import express from 'express';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import ejs from 'ejs';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config();

const app = express();
app.set('view engine', 'ejs');
app.set('views', __dirname + '/../public');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Read the EJS template
    const templatePath = __dirname + '/../public/handwave.ejs';
    const template = fs.readFileSync(templatePath, 'utf-8');
    
    // Render the template
    const html = ejs.render(template, {
      apiKey: process.env.VERCEL_ANTHROPIC_API_KEY
    });

    // Set the content type and send the response
    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  } catch (error) {
    console.error('Error rendering template:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message,
      stack: error.stack
    });
  }
} 