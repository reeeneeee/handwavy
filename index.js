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
app.post("/api/handwave", express.json(), async (req, res) => {
  const {transcription, style } = req.body;
  try {
    const message = `You are a helpful co-presenter, and are jumping in to continue
    a speech once the current speaker starts handwaving.
    Please give a direct continuation of this fragment of a speech in a ${style} style.
    DO NOT include any commentary or preamble, and exclude the fragment itself: "${transcription}"`;
    console.log('sending Anthropic message:', message);
    const msg = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      messages: [{ role: "user", content: message}],
    });

    res.json({ continuation: msg.content[0].text });

    // console.log(`sending llama3.2 message ${message}`)
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