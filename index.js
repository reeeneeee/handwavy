import bodyParser from "body-parser";
import { dirname } from "path";
import { fileURLToPath } from "url";
import morgan from "morgan";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(morgan("tiny"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");
app.set("views", __dirname + "/public");

dotenv.config();
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set in environment variables");
  process.exit(1);
}
const anthropic = new Anthropic({
  apiKey: process.env["ANTHROPIC_API_KEY"]
});

app.get("/", (req, res) => {
  res.render(__dirname + "/public/handwave.ejs", {
    apiKey: process.env["ANTHROPIC_API_KEY"]
  });
});

// Add API route handler for local development
app.get("/api/handwave", async (req, res) => {
  const headers = {
    'Content-Type': 'text/event-stream',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache'
  };
  res.writeHead(200, headers);
  console.log('in api/handwave')
  const transcription = req.query.transcription;
  const style = req.query.style;
  try {
    const message = `You are a helpful co-presenter, and are jumping in to continue
    a speech once the current speaker starts handwaving.
    Please give a direct continuation of this fragment of a speech in a ${style} style.
    DO NOT include any stage directions, commentary, or preamble, and exclude the fragment itself: "${transcription}"`;
    console.log('sending Anthropic message:', message);

    let startTime = performance.now();
    let firstChunkReceived = false;
    const stream = anthropic.messages
    .stream({
      model: 'claude-3-haiku-20240307',
      //model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: message,
        },
      ],
    })
    .on('text', (text) => {
      console.log('received text:', text)
      if (!firstChunkReceived) {
        firstChunkReceived = true;
        console.log(`First chunk received in ${performance.now() - startTime}ms`);
      }

      const data = `data: ${JSON.stringify(text)}\n\n`;
      res.write(data);

      //res.write(`${JSON.stringify(text)}\n\n`);
    });
  
    // console.log(`sending local llm message ${message}`)
    // const response = await fetch('http://localhost:11435/api/generate', {
    //   method: 'POST',
    //   headers: {
    //     'Content-Type': 'application/json',
    //   },  
    //   body: JSON.stringify(
    //     {             
    //       "model": "smollm2:135m",              
    //       // "model": "llama3.2:1b", // slow
    //       // "model": "deepseek-r1:1.5b", //slowest
          
    //       "prompt": message, 
    //       "stream": false
    //     }
    // )
    // });
    // const data = await response.json();
    // const msg = data.response;
    
    // console.log("LLM response:", msg); // Debug log
    // res.json({ continuation: msg });
    
  } catch (error) {
    console.error("Detailed error:", error); // Debug log
    res.status(500).json({ 
      error: error.message,
      details: error.stack 
    });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});

export default app;