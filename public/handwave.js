import { GestureRecognizer, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.js';

const video = document.getElementById("video");
let canvas;

let transcriptEnabled = false; // Start with transcription disabled
let lastGesture = "";
let lastHandwave = "";
let isSpeaking = false;
let speechQueue = [];
let currentChunk = '';
let lastBit = '';
let currentAudio = null; // Add this with other variables at the top
let audioQueue;
const synth = window.speechSynthesis;

// Set continuation style
const urlParams = new URLSearchParams(window.location.search);
const styleOverride = urlParams.get('style');
let style = styleOverride || "funny and whimsical";
const voiceId = urlParams.get('voiceId');

// Add at the top with other variables
let speechSynthesisInitialized = false;

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

// Function to play audio from our TTS endpoint
async function playAudio(text) {
  // Don't try to play empty text
  if (!text || text.trim().length === 0) {
    console.log('Skipping empty text');
    return;
  }

  try {
    console.log('Playing text:', text); // Debug log
    const response = await fetch(`/api/tts?text=${encodeURIComponent(text.trim())}&voiceId=${voiceId}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    // Create an audio element and play the stream
    const audio = new Audio();
    currentAudio = audio; // Store reference to current audio
    audio.src = URL.createObjectURL(await response.blob());
    
    // Return a promise that resolves when the audio finishes playing
    return new Promise((resolve) => {
      audio.onended = () => {
        currentAudio = null; // Clear reference when audio ends
        resolve();
      };
      audio.play();
    });
  } catch (error) {
    console.error('Error playing audio:', error);
  }
}

// Function to process the speech queue
async function processSpeechQueue() {
  if (isSpeaking || speechQueue.length === 0) return;
  
  isSpeaking = true;
  updateTranscriptionStatus(false);
  
  
  
  while (speechQueue.length > 0) {
    const chunk = speechQueue.shift();
    if (!chunk || chunk.trim().length === 0) continue;

    if (voiceId) {
      let stopCharMatch = chunk.match(new RegExp('[\\.\\!\\?]+'));
      if (stopCharMatch != null) {
        console.log('stop chars found, speaking', chunk);
        // Only include lastBit if it's not empty
        let chunkToSpeak = (lastBit ? lastBit + ' ' : '') + chunk.slice(0, stopCharMatch.index + 1) + stopCharMatch[0];
        lastBit = chunk.slice(stopCharMatch.index + stopCharMatch[0].length, chunk.length);

        console.log('chunkToSpeak is:', chunkToSpeak);
        console.log('reset lastBit to:', lastBit);
        updateTranscriptionStatus(false);

        // Make API call immediately and add to audio queue
        try {
          console.log('adding audio for chunk to queue: ', chunkToSpeak);
            const response = await fetch(`/api/tts?text=${encodeURIComponent(chunkToSpeak.trim())}&voiceId=${voiceId}`);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const audio = new Audio();
            audio.src = URL.createObjectURL(await response.blob());

            audio.onended = () => {
              currentAudio = null;
              let nextAudio = audioQueue.shift();
              if (nextAudio) {
                nextAudio.play();
              }
            }

            audio.onplay = () => {
              currentAudio = audio;
            }

            if (currentAudio == null) {
              audio.play();
            } else {
              audioQueue.push(audio);
            }

            console.warn('audioQueue:', audioQueue);
        } catch (error) {
            console.error('Error preparing audio:', error);
        }
      } else {
        console.log('no period, adding to lastBit:', chunk);
        lastBit += chunk;
      }
    } else {
      console.log('processing with speechsynthesis default')
      const messageTextRaw = lastBit + chunk;
      const messageText = ' ' + messageTextRaw.split(' ').slice(0, -1).join(' ');
      lastBit = messageTextRaw.split(' ').slice(-1)[0];

      currentChunk += messageText;
      if (!synth.speaking && currentChunk.length > 0) {
        console.log('synth is not speaking and chunk is not empty:', currentChunk);
        // If nothing is speaking, start speaking immediately
        let currentUtterance = new SpeechSynthesisUtterance(currentChunk);
        currentUtterance.rate = 1.5;
        currentUtterance.pitch = 1;
        synth.speak(currentUtterance);
        // Set up onend handler before speaking
        currentUtterance.onend = () => {
          console.log('Utterance finished');
          // If we've accumulated more text while speaking, speak it now
          if (currentChunk || lastBit) {  // Check for either accumulated text OR lastBit
            console.log('speaking accumulated chunk:', currentChunk);
            const textToSpeak = currentChunk + ' ' + lastBit;  // Include lastBit
            const nextUtterance = new SpeechSynthesisUtterance(textToSpeak);
            nextUtterance.rate = 1.5;
            nextUtterance.pitch = 1;
            nextUtterance.onend = currentUtterance.onend; // Preserve the onend handler
            currentUtterance = nextUtterance;
            console.log('speaking accumulated chunk:', textToSpeak);
            currentChunk = ''; // Clear the chunk before speaking
            lastBit = '';
            synth.speak(currentUtterance);
          }
          currentChunk = ''; // Clear the chunk before speaking
          
       }
      }
    }
  }
  
  isSpeaking = false;
  // Reset transcription status if no audio is playing and queue is empty
  if (!currentAudio && !window.speechSynthesis.speaking && speechQueue.length === 0) {
    updateTranscriptionStatus(true);
  }
}

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
let lastHandwaveTime = 0;

// Function to detect gestures
async function detectGestures() {
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

    if (gesture.categoryName !== lastGesture || handwave.categoryName !== lastHandwave) {
      console.log("Detected gesture: ", gesture.categoryName, " | ", handwave.categoryName);
      lastGesture = gesture.categoryName;
      lastHandwave = handwave.categoryName;

      if (gesture.categoryName === "None" && handwave.categoryName === "handwave") {  
        lastHandwaveTime = startTimeMs;
      }
    }
    
    // START GENERATING
    if (gesture.categoryName === "None" && handwave.categoryName === "handwave") {   
      gestureText.textContent = "🫴 detected";

      // Check if we're not already processing a handwave and cooldown has passed
      if (!isProcessingHandwave
      ) {
        // Set the flag immediately to prevent multiple calls
        isProcessingHandwave = true;
        lastApiCallTime = startTimeMs;
        console.log("commencing handwaving!");           
        
        try {
          await window.generateContinuation();
        } catch (error) {
          console.error("Error in handwave processing:", error);
          // Reset the flag on error
          isProcessingHandwave = false;
          lastApiCallTime = 0; // Reset the cooldown timer on error
        } finally {
          // Reset the flag when processing is complete
          isProcessingHandwave = false;
        }
      } else {
        const timeSinceLastCall = startTimeMs - lastApiCallTime;
        console.log(`Skipping handwave - ${isProcessingHandwave ? 'already processing' : `cooldown active (${Math.round(timeSinceLastCall/1000)}s remaining)`}`);
        console.log('time since handwave started', startTimeMs - lastHandwaveTime);
      }
    } else if (gesture.categoryName === "Open_Palm") {   // STOP SPEAKING
      gestureText.textContent = "✋ detected";
      console.log("open palm detected, stopping current audio and restarting transcription");
      
      // reset last handwave time
      lastHandwaveTime = Infinity;

      // Cancel any ongoing speech synthesis or audio
      window.speechSynthesis.cancel();
      if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
      }
      isSpeaking = false;
      // Clear the speech queue
      speechQueue = [];

      // Reset flags
      isProcessingHandwave = false;
      lastApiCallTime = 0; // Reset the cooldown timer on error
      document.getElementById('transcription').innerHTML = '';
      document.getElementById('continuation').innerHTML = '';
      updateTranscriptionStatus(true);
    } else {
      lastHandwaveTime = Infinity;

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
let interimTranscript = '';
let finalTranscript = '';

// Handle speech recognition results
recognition.onresult = (event) => {
  if (!transcriptEnabled) {
    console.log("Skipping transcription");
    return;
  }

  if (finalTranscript === '') {
    document.getElementById('transcription').innerHTML = `<p style="color: #000;"></p>`;
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
  } else if (finalTranscript) {
    transcriptionDiv.innerHTML = `<p style="color: #000;">${finalTranscript}</p>`;
  } else {
    transcriptionDiv.innerHTML = `<p style="color: #000;"></p>`;
  }
};

// Handle errors
recognition.onerror = (event) => {
  console.error('Speech recognition error:', event.error);

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
      if (!transcriptEnabled) {
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
    // Reset transcription status if no audio is playing
    if (!currentAudio && !window.speechSynthesis.speaking && speechQueue.length === 0) {
      updateTranscriptionStatus(true);
    }
    // Clear the canvas
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);

    // Gesture detection and hand landmarks
    await detectGestures();
  }, 100);
});

window.generateContinuation = async function() {
  // Clear out continuation text
  document.getElementById('continuation').innerHTML = `<p style="color: #000;"></p>`;

  // Update UI
  gestureText.textContent = 'thinking...';
  
  // Close existing WebSocket connection if it exists
  if (window.currentWebSocket) {
    window.currentWebSocket.close();
  }

  const transcription = document.getElementById('transcription').textContent;
  console.log('Generating continuation for:', {
    transcription,
    style
  });

  // Create WebSocket connection with correct protocol
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
  window.currentWebSocket = ws;

  let continuationDiv = document.getElementById('continuation');
  continuationDiv.innerHTML = `<p style="color: #000;"></p>`;
  let currentChunk = '';
  let firstChunk = true;
  const synth = window.speechSynthesis;

  ws.onopen = () => {
    console.log('WebSocket connection established');
    console.warn('Start with an empty audio queue');
    audioQueue = []; // Queue to store audio elements
    // Send the continuation request
    ws.send(JSON.stringify({ transcription, style }));
  };

  ws.onmessage = async function(event) {
    console.log('Received WebSocket message:', event.data);
    updateTranscriptionStatus(false);
    
    const data = JSON.parse(event.data);
    
    if (data.type === 'error') {
      console.error('Error from server:', data.error);
      return;
    }
    
    if (data.type === 'complete') {
      console.log('Handwave generation complete');
      return;
    }
    
    // Get the new text and update the display
    const newText = data.text;
    if (newText) {
      continuationDiv.textContent = (continuationDiv.textContent || '') + newText;
    }
    console.log('adding new text to speech queue: ', newText);
    speechQueue.push(newText);

    if (!isSpeaking) {
      console.log('processing speech queue');
      processSpeechQueue();
    } 
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  ws.onclose = () => {
    console.log('WebSocket connection closed');
  };
};

// Initialize speech synthesis when the page loads
document.addEventListener('DOMContentLoaded', () => {
  // Chrome requires a user interaction before allowing speech
  const initSpeech = () => {
    // Try to initialize voices
    window.speechSynthesis.getVoices();
    
    // Remove the event listeners once initialized
    document.removeEventListener('click', initSpeech);
    document.removeEventListener('keydown', initSpeech);
    document.removeEventListener('touchstart', initSpeech);
  };

  // Add listeners for user interaction
  document.addEventListener('click', initSpeech);
  document.addEventListener('keydown', initSpeech);
  document.addEventListener('touchstart', initSpeech);
});