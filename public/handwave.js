import { GestureRecognizer, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.js';

window.speechSynthesis.cancel();

const video = document.getElementById("video");
let canvas;
let transcriptEnabled = false; // Start with transcription disabled


// Function: start webcam
function startWebcam() {
  navigator.mediaDevices
    .getUserMedia({
      video: true,
      audio: false,
    })
    .then((stream) => {
      video.srcObject = stream;
    })
    .catch((error) => {
      console.error(error);
    });
}

// Function: update transcription status
function updateTranscriptionStatus(enabled) {
  // update transcription status
  transcriptEnabled = enabled;
  console.log("Transcription status updated to:", enabled);

  // update transcription status UI
  const indicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('transcription-status-text');
 
  if (enabled) {
    indicator.classList.add('active');
    statusText.textContent = 'Transcription enabled';

    // clear transcript and ui
    finalTranscript = '';
    gestureText.textContent = '';
    transcriptionDiv.innerHTML = `<p style="color: #000;"></p>`;

    video.style.filter = 'blur(3px)'; // Remove grayscale filter
    
    // Ensure recognition is running when transcription is enabled
    try {
      recognition.start();
    } catch (error) {
      // Ignore "already started" errors
      if (error.name !== 'InvalidStateError') {
        console.error('Error starting recognition when enabling transcription:', error);
      }
    }
  } else {
    indicator.classList.remove('active');
    video.style.filter = 'blur(3px) grayscale(100%)'; // Apply grayscale filter
    
    // Stop recognition when transcription is disabled
    try {
      recognition.stop();
    } catch (error) {
      // Ignore errors when stopping
      console.log('Note: Recognition was already stopped');
    }
  }
}

// Function: speak text
function say(text) {
  console.log("saying " + text + " and disabling transcription");

  updateTranscriptionStatus(false); //disable transcription while speaking

  // Clear UI
  gestureText.textContent = '';

  // Set speech synthesis properties
  msg.rate = 1.5;
  msg.pitch = 1;
  msg.text = text;
  
  // Make sure we have the onend handler set before speaking
  msg.onend = function() {
    console.log("Speech synthesis ended, re-enabling transcription");
    updateTranscriptionStatus(true);
    
    // Restart recognition if it's not running
    try {
      recognition.start();
    } catch (error) {
      // Ignore "already started" errors
      if (error.name !== 'InvalidStateError') {
        console.error('Error restarting recognition after speech:', error);
      }
    }
  };
  
  window.speechSynthesis.cancel();

  // Speak text
  window.speechSynthesis.speak(msg);
}

// Set voice to AVA
var msg = new SpeechSynthesisUtterance();

const allVoicesObtained = new Promise(function (resolve, reject) {
  let voices = window.speechSynthesis.getVoices();
  if (voices.length !== 0) {
    resolve(voices);
  } else {
    window.speechSynthesis.addEventListener("voiceschanged", function () {
      voices = window.speechSynthesis.getVoices();
      resolve(voices);
    });
  }
});

allVoicesObtained.then((voices) => (msg.voice = voices[0]));

// Initialize gesture recognizer
let gestureRecognizer, handwaveRecognizer;
let runningMode = "VIDEO";
async function createHandwaveRecognizer() {
  const vision = await FilesetResolver.forVisionTasks(
    "./wasm"
  );
  handwaveRecognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "./models/handwave_recognizer.task"
    },
    runningMode: "VIDEO",
    numHands: 2
  });
}
async function createGestureRecognizer() {
  const vision = await FilesetResolver.forVisionTasks(
    "./wasm"
  );
  gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "./models/gesture_recognizer.task"
    },
    runningMode: "VIDEO",
    numHands: 2
  });
}

import { Anthropic } from 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.10.2/+esm';

let anthropic;

if (!API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set in environment variables");
} else {
  anthropic = new Anthropic({
    apiKey: window.API_KEY
  });
}

let lastApiCallTime = 0;
const API_CALL_COOLDOWN = 5000; // 5 seconds between API calls

// Add function to draw hand landmarks
function drawHandLandmarks(ctx, landmarks) {
  if (!landmarks) return;
  
  // Draw connections
  ctx.strokeStyle = '#00FF00';
  ctx.lineWidth = 2;
  
  // Draw palm connections
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(landmarks[i].x * ctx.canvas.width, landmarks[i].y * ctx.canvas.height);
    ctx.lineTo(landmarks[i + 1].x * ctx.canvas.width, landmarks[i + 1].y * ctx.canvas.height);
    ctx.stroke();
  }
  
  // Draw finger connections
  for (let finger = 0; finger < 5; finger++) {
    const baseIndex = finger * 4 + 1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(landmarks[baseIndex + i].x * ctx.canvas.width, landmarks[baseIndex + i].y * ctx.canvas.height);
      ctx.lineTo(landmarks[baseIndex + i + 1].x * ctx.canvas.width, landmarks[baseIndex + i + 1].y * ctx.canvas.height);
      ctx.stroke();
    }
  }
  
  // Draw joints
  ctx.fillStyle = '#FF0000';
  for (const landmark of landmarks) {
    ctx.beginPath();
    ctx.arc(landmark.x * ctx.canvas.width, landmark.y * ctx.canvas.height, 3, 0, 2 * Math.PI);
    ctx.fill();
  }
}

const gestureText = document.getElementById("gesture");
// Add a flag to track if we're currently processing a handwave
let isProcessingHandwave = false;

// Function to detect gestures
async function detectGestures() {
  if (finalTranscript === "") {
    return;
  }

  if (!gestureRecognizer || !handwaveRecognizer) {
    console.log("Gesture recognizers not initialized");
    return;
  }
  if (!canvas) {
    console.log("Canvas not initialized");
    return;
  }

  const startTimeMs = performance.now();
  const gestureResults = gestureRecognizer.recognizeForVideo(video, startTimeMs);
  const handwaveResults = handwaveRecognizer.recognizeForVideo(video, startTimeMs);

  if (gestureResults && gestureResults.gestures && gestureResults.gestures.length > 0 &&
    handwaveResults && handwaveResults.gestures && handwaveResults.gestures.length > 0) {
    const gesture = gestureResults.gestures[0][0];
    const handwave = handwaveResults.gestures[0][0];
    
    // Only log when gesture changes to reduce console spam
    if (gesture.categoryName !== lastGesture || handwave.categoryName !== lastHandwave) {
      console.log("Detected gesture: ", gesture.categoryName, " | ", handwave.categoryName);
      lastGesture = gesture.categoryName;
      lastHandwave = handwave.categoryName;
    }

    if (gesture.categoryName === "None" && handwave.categoryName === "handwave") {   
        gestureText.textContent = "handwave detected";
        
        // Check if we're not already processing a handwave and cooldown has passed
        if (!isProcessingHandwave && startTimeMs - lastApiCallTime > API_CALL_COOLDOWN) {
          isProcessingHandwave = true;
          lastApiCallTime = startTimeMs;
          console.log("commencing handwaving!");           
          
          try {
            await window.submitToHandwave();
          } finally {
            // Reset the flag when processing is complete
            isProcessingHandwave = false;
          }
        }
    } else {
      gestureText.textContent = "";
    }
  }

  // Draw hand landmarks if available
  if (gestureResults && gestureResults.landmarks) {
    const ctx = canvas.getContext('2d');
    for (const handLandmarks of gestureResults.landmarks) {
      drawHandLandmarks(ctx, handLandmarks);
    }
  }
}

// Add at the top with other variables
let speechSynthesisInitialized = false;

// Initialize speech synthesis
function initializeSpeechSynthesis() {
  if (speechSynthesisInitialized) return;
  
  const startButton = document.getElementById('startButton');
  if (!startButton) {
    console.log("Start button not found, initializing speech synthesis automatically");
    speechSynthesisInitialized = true;
    return;
  }
  startButton.addEventListener('click', async () => {
    console.log("Initializing speech synthesis");
    
    // Request microphone access first
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop()); // Stop the stream after getting permission
      console.log("Microphone access granted");
    } catch (error) {
      console.error("Error accessing microphone:", error);
      alert("Please allow microphone access to use speech recognition");
      return;
    }

    speechSynthesisInitialized = true;
    startButton.disabled = true;
    startButton.textContent = 'Speech Synthesis Ready';
  });
}

// Initialization
Promise.all([
  createGestureRecognizer(),
  createHandwaveRecognizer()
]).then(() => {
  startWebcam();
  initializeSpeechSynthesis();
});

// Speech recognition setup
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;
const SpeechGrammarList =
  window.SpeechGrammarList || window.webkitSpeechGrammarList;
const SpeechRecognitionEvent =
  window.SpeechRecognitionEvent || window.webkitSpeechRecognitionEvent;
const recognition = new SpeechRecognition();
const speechRecognitionList = new SpeechGrammarList();
recognition.grammars = speechRecognitionList;
recognition.continuous = true;
recognition.lang = "en-US";
recognition.interimResults = true;
recognition.maxAlternatives = 1;

// Get the transcription display element
const transcriptionDiv = document.getElementById('transcription');
let finalTranscript = '';

// Handle speech recognition results
recognition.onresult = (event) => {
  if (!transcriptEnabled) {
    console.log("Skipping transcription");
    return;
  }
  
  const results = event.results;
  let interimTranscript = '';

  for (let i = event.resultIndex; i < results.length; i++) {
    const transcript = results[i][0].transcript;
    if (results[i].isFinal) {
      finalTranscript += transcript + ' ';
    } else {
      interimTranscript += transcript;
    }
  }

  // Update the transcription display
  if (interimTranscript) {
    transcriptionDiv.innerHTML = `<p style="color: #000;">${interimTranscript}</p>`;
  }
  if (finalTranscript) {
    transcriptionDiv.innerHTML = `<p style="color: #000;">${finalTranscript}</p>`;
  }
};

// Handle errors
recognition.onerror = (event) => {
  console.error('Speech recognition error:', event.error);
  // transcriptionDiv.innerHTML += `<p style="color: red;">Error: ${event.error}</p>`;
  
  // If the error is fatal, try to restart recognition
  if (event.error === 'network' || event.error === 'service-not-allowed') {
    setTimeout(() => {
      try {
        recognition.start();
      } catch (error) {
        console.error('Error restarting recognition after error:', error);
      }
    }, 1000);
  }
};

// Add handler for when recognition ends unexpectedly
recognition.onend = () => {
  if (transcriptEnabled) {
    console.log("Recognition ended, attempting to restart");
    try {
      recognition.start();
    } catch (error) {
      console.error('Error restarting recognition:', error);
    }
  }
};

// listen for user input to enable speech synthesis and transcription
function listenForUserInput() {
  const events = ["click", "touchstart", "keydown"];
  events.forEach(eventType => {
    document.addEventListener(eventType, () => {
      console.log(`Event ${eventType} triggered, enabling transcription`);
      updateTranscriptionStatus(true);
      msg.rate = 1;
    }, { once: true }); // Use once: true to prevent multiple bindings
  });
}

// Call setupEventListeners when the document is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', listenForUserInput);
} else {
  listenForUserInput();
}


// Draw video and canvas
video.addEventListener("play", async () => {
      // Initialize speech synthesis
      window.speechSynthesis.cancel();
      
      if (!transcriptEnabled) {
        msg.text = "Please type any key to enable transcription.";
        // say(msg.text)
        updateTranscriptionStatus(true);
      }

  canvas = faceapi.createCanvasFromMedia(video);

  // Create a container for the video and canvas
  const container = document.createElement('div');
  container.style.position = 'relative';
  container.style.width = '800px';
  container.style.height = '600px';
  container.style.margin = '0 auto';
  
  // Move the video into the container
  video.parentNode.insertBefore(container, video);
  container.appendChild(video);
  container.appendChild(canvas);

  // Start speech recognition
  try {
    await recognition.start();
  } catch (error) {
    console.error('Error starting speech recognition:', error);
  }

  faceapi.matchDimensions(canvas, { height: video.height, width: video.width });

  // draw detections every 100ms
  setInterval(async () => {
    if (!transcriptEnabled) {
      return;
    }

    // Clear the canvas
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);

    // Gesture detection and hand landmarks
    await detectGestures();
  }, 100);
});

window.submitToHandwave = async function() {
  const transcription = document.getElementById('transcription').textContent;

  // Update UI
  gestureText.textContent = 'thinking...';

  // Set continuation style
  const urlParams = new URLSearchParams(window.location.search);
  const styleOverride = urlParams.get('style');
  let style = styleOverride || "funny and whimsical";
  
  console.log('Submitting to handwave:', {
    transcription,
    style,
    url: '/api/handwave'
  });

  try {
    const response = await fetch('/api/handwave', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transcription: transcription,
        style: style
      })
    });
    
    console.log('Response status:', response.status);
    const responseText = await response.text();
    console.log('Response text:', responseText);
    
    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.status} ${responseText}`);
    }
    
    const result = JSON.parse(responseText);
    
    // Speak continuation and update UI
    if (result.continuation) {
      const continuationDiv = document.getElementById('continuation');
      continuationDiv.textContent = result.continuation;

      say(result.continuation);
    }
  } catch (error) {
    console.error('Error:', error);
    const continuationDiv = document.getElementById('continuation');
    continuationDiv.textContent = `Error: ${error.message}`;
  }
};

// Add these variables at the top with other variables
let lastGesture = "";
let lastHandwave = "";