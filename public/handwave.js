// Imports
import { GestureRecognizer, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.js';

// DOM elements
let video, canvas;

// URL parameters for customization
const urlParams = new URLSearchParams(window.location.search);

// Application state management
const AppState = {
  // DOM elements state
  dom: {
    video: null,
    canvas: null,
    gestureText: null,
    transcriptionDiv: null,
    continuationDiv: null,
    startButton: null,
    statusIndicator: null,
    transcriptionStatusText: null
  },
  
  // Transcription state
  transcription: {
    enabled: false,
    finalTranscript: '',
    initialized: false
  },
  
  // Speech/Audio state
  speech: {
    queue: [],
    speakableChunks: [],
    currentChunk: '',
    lastBit: '',
    currentAudio: null,
    audioQueue: [],
    isSpeaking: false
  },
  
  // Gesture detection state
  gestures: {
    lastGesture: '',
    lastHandwave: '',
    lastHandwaveTime: 0,
    lastApiCallTime: 0
  },
  
  // WebSocket state
  websocket: {
    currentConnection: null
  },
  
  // Configuration
  config: {
    apiCallCooldown: 5000,
    style: urlParams.get('style') || "funny and whimsical",
    voiceId: urlParams.get('voiceId')
  }
};

// State management helper functions
const StateManager = {
  // Initialize DOM elements
  initDOM() {
    AppState.dom.video = document.getElementById("video");
    AppState.dom.canvas = null; // Will be set later when canvas is created
    AppState.dom.gestureText = document.getElementById("gesture");
    AppState.dom.transcriptionDiv = document.getElementById('transcription');
    AppState.dom.continuationDiv = document.getElementById('continuation');
    AppState.dom.startButton = document.getElementById('startButton');
    AppState.dom.statusIndicator = document.getElementById('status-indicator');
    AppState.dom.transcriptionStatusText = document.getElementById('transcription-status-text');

    video = AppState.dom.video;
    canvas = AppState.dom.canvas;
  },
  
  // Set canvas reference when it's created
  setCanvas(canvasElement) {
    AppState.dom.canvas = canvasElement;
    canvas = canvasElement;
  },
  
  // Check if DOM elements are initialized
  isDOMInitialized() {
    return AppState.dom.video !== null;
  },
  
  // Ensure DOM is initialized before use
  ensureDOMInitialized() {
    if (!this.isDOMInitialized()) {
      console.warn('DOM not initialized, initializing now...');
      this.initDOM();
    }
  },
  
  // Reset all state to initial values
  reset() {
    AppState.transcription.enabled = false;
    AppState.transcription.finalTranscript = '';
    
    AppState.speech.isSpeaking = false;
    AppState.speech.queue = [];
    AppState.speech.speakableChunks = [];
    AppState.speech.currentChunk = '';
    AppState.speech.lastBit = '';
    AppState.speech.currentAudio = null;
    AppState.speech.audioQueue = [];
    
    AppState.gestures.lastGesture = '';
    AppState.gestures.lastHandwave = '';
    AppState.gestures.lastHandwaveTime = 0;
    AppState.gestures.lastApiCallTime = 0;
    
    if (AppState.websocket.currentConnection) {
      AppState.websocket.currentConnection.close();
      AppState.websocket.currentConnection = null;
    }
  },
  
  // Reset only speech-related state
  resetSpeech() {
    AppState.speech.queue = [];
    AppState.speech.currentChunk = '';
    AppState.speech.lastBit = '';
    
    // Stop and clear current audio
    if (AppState.speech.currentAudio) {
      AppState.speech.currentAudio.pause();
      AppState.speech.currentAudio.currentTime = 0;
      AppState.speech.currentAudio = null;
    }
    
    // Clear all audio in the queue
    AppState.speech.audioQueue.forEach(audio => {
      audio.pause();
      audio.currentTime = 0;
    });
    AppState.speech.audioQueue = [];
  },
  
  // Check if any audio is currently playing or queued
  isAudioActive() {
    return AppState.speech.queue.length > 0 || 
           AppState.speech.audioQueue.length > 0 || 
           AppState.speech.currentAudio !== null || 
           window.speechSynthesis.speaking;
  },

  updateTranscriptionStatus(isEnabled) {
    // console.info('Updating transcription status to:', isEnabled);
    AppState.transcription.enabled = isEnabled;
    
    // Ensure DOM is initialized
    StateManager.ensureDOMInitialized();
  
    // Update UI indicators
    const indicator = AppState.dom.statusIndicator;
    const statusText = AppState.dom.transcriptionStatusText;
   
    if (isEnabled) {
      if (indicator) indicator.classList.add('active');
      if (statusText) statusText.textContent = 'Transcription enabled';
  
      // Clear transcript and UI
      if (AppState.dom.gestureText) AppState.dom.gestureText.textContent = '';
  
      if (AppState.dom.video) AppState.dom.video.style.filter = 'blur(3px)'; // Remove grayscale filter
      
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
      if (indicator) indicator.classList.remove('active');
      if (AppState.dom.video) AppState.dom.video.style.filter = 'blur(3px) grayscale(100%)'; // Apply grayscale filter
      
      // Stop recognition when transcription is disabled
      try {
        recognition.stop();
      } catch (error) {
        console.warn('Error stopping recognition:', error.message);
      }
    }
  },
  
  // Get current state for debugging
  getState() {
    return JSON.parse(JSON.stringify(AppState));
  }
};

const synth = window.speechSynthesis;

// Initialize gesture recognizers
let gestureRecognizer, handwaveRecognizer;

// Load handwave recognizer
async function createHandwaveRecognizer() {
  const vision = await FilesetResolver.forVisionTasks("./wasm");
  handwaveRecognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "./models/handwave_recognizer.task"
    },
    runningMode: "VIDEO",
    numHands: 2
  });
}

// Load default gesture recognizer
async function createGestureRecognizer() {
  const vision = await FilesetResolver.forVisionTasks("./wasm");
  gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "./models/gesture_recognizer.task"
    },
    runningMode: "VIDEO",
    numHands: 2
  });
}

// Start webcam for video input
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
      console.error('Error accessing webcam:', error);
    });
}

// Process speech queue for TTS and speech synthesis
async function maybeProcessSpeechQueue() {
  if (AppState.speech.isSpeaking || AppState.speech.queue.length === 0) return;
  
  AppState.speech.isSpeaking = true;
  StateManager.updateTranscriptionStatus(false);
  
  while (AppState.speech.queue.length > 0) {
    const chunk = AppState.speech.queue.shift();
    if (!chunk || chunk.trim().length === 0) continue;

    if (AppState.config.voiceId) {
      // Use ElevenLabs TTS
      await processWithElevenLabs(chunk);
    } else {
      // Use browser speech synthesis
      await processWithSpeechSynthesis(chunk);
    }
  }
  
  AppState.speech.isSpeaking = false;
  // Reset transcription status if no audio is playing and all queues are empty
  if (!AppState.speech.currentAudio && !window.speechSynthesis.speaking && AppState.speech.audioQueue.length === 0) {
    StateManager.updateTranscriptionStatus(true);
  }
}

// Process speech with ElevenLabs TTS
async function processWithElevenLabs(chunk) {
  let stopCharMatch = chunk.match(new RegExp('[\\.\\!\\?]+'));

  const fullText = AppState.speech.lastBit + chunk;
  const speakableChunk = fullText.match(/^.*[a-zA-Z]+.*[.!?;:,-]/)

  if (speakableChunk != null) {
    // Only include lastBit if it's not empty
    let chunkToSpeak = speakableChunk[0];
    AppState.speech.lastBit = fullText.slice(chunkToSpeak.length);
    console.info('chunkToSpeak:', chunkToSpeak);
    console.info('Updated lastBit:', AppState.speech.lastBit);
    StateManager.updateTranscriptionStatus(false);

    // Make API call immediately and add to audio queue
    try {
      const response = await fetch(`/api/tts?text=${encodeURIComponent(chunkToSpeak.trim())}&voiceId=${AppState.config.voiceId}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const audio = new Audio();
      audio.src = URL.createObjectURL(await response.blob());

      audio.onended = () => {
        let nextAudio = AppState.speech.audioQueue.shift();
        if (nextAudio) {
          nextAudio.play();
        } else {
          AppState.speech.currentAudio = null;
        }
        console.info('Audio ended, audioQueue length:', AppState.speech.audioQueue.length);
      }

      audio.onplay = () => {
        AppState.speech.currentAudio = audio;
      }

      if (AppState.speech.currentAudio == null) {
        audio.play();
             } else {
         AppState.speech.audioQueue.push(audio);
       }
    } catch (error) {
      console.error('Error preparing audio:', error);
    }
  } else {
    console.warn('no speakable chunk, appending to lastBit:', chunk);
    AppState.speech.lastBit = fullText;
  }
}

// Process speech with browser speech synthesis
async function processWithSpeechSynthesis(chunk) {
  const messageTextRaw = AppState.speech.lastBit + chunk;
  const messageText = ' ' + messageTextRaw.split(' ').slice(0, -1).join(' ');
  AppState.speech.lastBit = messageTextRaw.split(' ').slice(-1)[0];
  AppState.speech.currentChunk += messageText;
  
  if (!window.speechSynthesis.speaking && AppState.speech.currentChunk.length > 0) {
    // If nothing is speaking, start speaking immediately
    let currentUtterance = new SpeechSynthesisUtterance(AppState.speech.currentChunk);
    currentUtterance.rate = 1.5;
    currentUtterance.pitch = 1;
    window.speechSynthesis.speak(currentUtterance);
    
    // Set up onend handler before speaking
    currentUtterance.onend = () => {
      console.info('Utterance finished');
      // If we've accumulated more text while speaking, speak it now
      if (AppState.speech.currentChunk.length || AppState.speech.lastBit) {
        const textToSpeak = AppState.speech.currentChunk + ' ' + AppState.speech.lastBit;  // Include lastBit
        const nextUtterance = new SpeechSynthesisUtterance(textToSpeak);
        nextUtterance.rate = 1.5;
        nextUtterance.pitch = 1;
        nextUtterance.onend = currentUtterance.onend; // Preserve the onend handler
        currentUtterance = nextUtterance;
        console.info('speaking accumulated chunk:', currentUtterance);
        AppState.speech.currentChunk = ''; // Clear the chunk before speaking
        AppState.speech.lastBit = '';
        window.speechSynthesis.speak(currentUtterance);
      }
      AppState.speech.currentChunk = ''; // Clear the chunk before speaking
    }
  }
}

// Unified chunking logic for both TTS methods
function processChunk(chunk) {
  console.error('processing chunk:', chunk);

  // Combine lastBit with current chunk, find speakable part of the text
  const fullText = AppState.speech.lastBit + chunk;
  const speakableChunk = fullText.match(/^.*[a-zA-Z]+.*[.!?;:,-]/)

  // Continue accumulating chunks if non speakable part found
  if (speakableChunk == null) {
    console.warn('No speakable chunk found, waiting for next: ', fullText);
    AppState.speech.lastBit = fullText;
  } else {
    const chunkToSpeak = speakableChunk[0];
    AppState.speech.lastBit = fullText.slice(chunkToSpeak.length);
    
    AppState.speech.speakableChunks.push(chunkToSpeak);
    console.info('chunkToSpeak pushed to speech queue:', chunkToSpeak);
    console.info('lastBit is:', AppState.speech.lastBit);
  }
}

// Display hand landmarks on canvas
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

const gestureText = AppState.dom.gestureText;

// Main gesture detection function
async function detectGestures() {
  if (!gestureRecognizer || !handwaveRecognizer) {
    console.warn("Gesture recognizers not initialized");
    return;
  }
  if (!canvas) {
    console.warn("Canvas not initialized");
    return;
  }

  // Check if video has valid dimensions
  if (!video.videoWidth || !video.videoHeight || video.videoWidth === 0 || video.videoHeight === 0) {
    console.warn("Video dimensions not ready:", { width: video.videoWidth, height: video.videoHeight });
    return;
  }

  // Check if canvas has valid dimensions
  if (!canvas.width || !canvas.height || canvas.width === 0 || canvas.height === 0) {
    console.warn("Canvas dimensions not ready:", { width: canvas.width, height: canvas.height });
    return;
  }

  // Check if video is playing and has data
  if (video.readyState < video.HAVE_ENOUGH_DATA) {
    console.warn("Video not ready, state:", video.readyState);
    return;
  }

  const startTimeMs = performance.now();
  let gestureResults, handwaveResults;
  
  try {
    gestureResults = gestureRecognizer.recognizeForVideo(video, startTimeMs);
    handwaveResults = handwaveRecognizer.recognizeForVideo(video, startTimeMs);

    if (gestureResults && gestureResults.gestures && gestureResults.gestures.length > 0 &&
      handwaveResults && handwaveResults.gestures && handwaveResults.gestures.length > 0) {
      const gesture = gestureResults.gestures[0][0];
      const handwave = handwaveResults.gestures[0][0];

      if (gesture.categoryName !== AppState.gestures.lastGesture || handwave.categoryName !== AppState.gestures.lastHandwave) {
        console.info("Detected gesture: ", gesture.categoryName, " | ", handwave.categoryName);
        AppState.gestures.lastGesture = gesture.categoryName;
        AppState.gestures.lastHandwave = handwave.categoryName;

        if (gesture.categoryName === "None" && handwave.categoryName === "handwave") {  
          AppState.gestures.lastHandwaveTime = startTimeMs;
        }
      }
      
      // Handle handwave detection - START GENERATING
      if (gesture.categoryName === "None" && handwave.categoryName === "handwave" && !StateManager.isAudioActive()) {   
        AppState.dom.gestureText.textContent = "🫴 detected";

        const timeSinceLastCall = startTimeMs - AppState.gestures.lastApiCallTime;
        // Allow if it's the first handwave or if cooldown has passed
        if ((AppState.gestures.lastApiCallTime === 0 || timeSinceLastCall > AppState.config.apiCallCooldown)) {
          AppState.gestures.lastApiCallTime = startTimeMs;
          console.info("requesting continuation!");           
          
          try {
            await window.generateContinuation();
          } catch (error) {
            console.error("Error in handwave processing:", error);
            // Reset the flag on error
            AppState.gestures.lastApiCallTime = 0; // Reset the cooldown timer on error
          }
        } else {
          console.warn('Skipping continuation: time since last api call', startTimeMs - AppState.gestures.lastHandwaveTime);
        }
      } else if (gesture.categoryName === "Open_Palm") {   // STOP SPEAKING
        AppState.dom.gestureText.textContent = "✋ detected";
        console.info("open palm detected, stopping current audio and restarting transcription");

        // Clear UI
        AppState.dom.transcriptionDiv.innerHTML = '';
        AppState.dom.continuationDiv.innerHTML = '';
        AppState.transcription.finalTranscript = '';
        
        // Close any active WebSocket connection
        if (AppState.websocket.currentConnection) {
          AppState.websocket.currentConnection.close();
          AppState.websocket.currentConnection = null;
        }
        
        // COMPLETELY KILL ALL QUEUES AND RESET STATE
        window.speechSynthesis.cancel();
        StateManager.resetSpeech();

        // Restart transcription
        console.info('open palm detected, enabling transcription');
        StateManager.updateTranscriptionStatus(true);
      } else {
        AppState.gestures.lastHandwaveTime = Infinity;
        AppState.dom.gestureText.textContent = "";
      }
    }
  } catch (error) {
    console.error("Error in gesture detection:", error);
    // Don't throw the error, just log it and continue
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
  if (AppState.transcription.initialized) return;
  
  const startButton = AppState.dom.startButton;
  if (!startButton) {
    console.info("Start button not found, initializing speech synthesis automatically");
    AppState.transcription.initialized = true;
    return;
  }
  
  startButton.addEventListener('click', async () => {
    console.info("Initializing speech synthesis");
    
    // Request microphone access first
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop()); // Stop the stream after getting permission
      console.info("Microphone access granted");
    } catch (error) {
      console.error("Error accessing microphone:", error);
      alert("Please allow microphone access to use speech recognition");
      return;
    }

    AppState.transcription.initialized = true;
    startButton.disabled = true;
    startButton.textContent = 'Speech Synthesis Ready';
  });
}

// Initialize speech recognition
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const SpeechGrammarList = window.SpeechGrammarList || window.webkitSpeechGrammarList;
const SpeechRecognitionEvent = window.SpeechRecognitionEvent || window.webkitSpeechRecognitionEvent;
const recognition = new SpeechRecognition();
const speechRecognitionList = new SpeechGrammarList();

recognition.grammars = speechRecognitionList;
recognition.continuous = true;
recognition.lang = "en-US";
recognition.interimResults = true;
recognition.maxAlternatives = 1;

// Get the transcription display element
const transcriptionDiv = AppState.dom.transcriptionDiv;

// Handle transcription increments
recognition.onresult = (event) => {
  if (!AppState.transcription.enabled) {
    console.warn("speech recognized but transcription is disabled");
    return;
  }

  if (AppState.transcription.finalTranscript === '') {
    AppState.dom.transcriptionDiv.innerHTML = `<p style="color: #000;"></p>`;
  }

  const results = event.results;
  AppState.transcription.interimTranscript = '';

  for (let i = event.resultIndex; i < results.length; i++) {
    const transcript = results[i][0].transcript;
    if (results[i].isFinal) {
      AppState.transcription.finalTranscript += transcript;
    } else {
      AppState.transcription.interimTranscript += transcript;
    }
  }

  console.info('interimTranscript:', AppState.transcription.interimTranscript);
  console.info('finalTranscript:', AppState.transcription.finalTranscript);

  // Update the transcription display
  if (AppState.transcription.interimTranscript) {
    AppState.dom.transcriptionDiv.innerHTML = `<p style="color: #000;">${AppState.transcription.interimTranscript}</p>`;
  } else if (AppState.transcription.finalTranscript) {
    AppState.dom.transcriptionDiv.innerHTML = `<p style="color: #000;">${AppState.transcription.finalTranscript}</p>`;
  } else {
    AppState.dom.transcriptionDiv.innerHTML = `<p style="color: #000;"></p>`;
  }
};

// Handle speech recognition errors
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

// Handle speech recognition end events
recognition.onend = () => {
  if (AppState.transcription.enabled) {
    try {
      console.info("Recognition ended, restarting");
      recognition.start();
    } catch (error) {
      console.error('Error restarting recognition:', error);
    }
  }
};

// Listen for user input to enable speech synthesis and transcription (required on mobile)
function listenForUserInput() {
  // Initialize DOM elements first
  StateManager.ensureDOMInitialized();
  
  const events = ["click", "touchstart", "keydown"];
  events.forEach(eventType => {
    document.addEventListener(eventType, () => {
      console.info(`Event ${eventType} triggered, enabling transcription`);
      StateManager.updateTranscriptionStatus(true);
    }, { once: true }); // Use once: true to prevent multiple bindings
  });
}

// Set up video and canvas when video starts playing
// Ensure DOM is initialized first
StateManager.ensureDOMInitialized();

video.addEventListener("play", async () => {
  console.info('Video started playing, enabling transcription');
  StateManager.updateTranscriptionStatus(true);

  // Wait for video to have dimensions before creating canvas
  await new Promise((resolve) => {
    if (video.videoWidth && video.videoHeight) {
      resolve();
    } else {
      video.addEventListener('loadedmetadata', resolve, { once: true });
    }
  });

  canvas = faceapi.createCanvasFromMedia(video);
  StateManager.setCanvas(canvas);

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

  // Ensure canvas dimensions match video
  faceapi.matchDimensions(canvas, { height: video.videoHeight, width: video.videoWidth });

  // Wait a bit for video to be fully ready before starting gesture detection
  setTimeout(() => {
    // draw detections every 100ms
    setInterval(async () => {
      // Reset transcription status if no audio is playing and all queues are empty
      if (!window.speechSynthesis.speaking && AppState.speech.audioQueue.length === 0 && AppState.speech.currentAudio === null) {
        StateManager.updateTranscriptionStatus(true);
      }
      // Clear the canvas
      canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);

      // Gesture detection and hand landmarks
      await detectGestures();

      // Process speech queue if nonempty
      maybeProcessSpeechQueue();
    }, 100);
  }, 1000); // Wait 1 second for video to be ready
});

// Generate AI continuation of speech via WebSocket
window.generateContinuation = async function() {
  // Clear out continuation text
  AppState.dom.continuationDiv.innerHTML = `<p style="color: #000;"></p>`;

  // Update UI
  AppState.dom.gestureText.textContent = 'thinking...';
  
  // Close existing WebSocket connection if it exists
  if (AppState.websocket.currentConnection) {
    AppState.websocket.currentConnection.close();
  }

  const transcription = AppState.dom.transcriptionDiv.textContent;
  console.info('Requesting continuation for:', {
    transcription: AppState.transcription.finalTranscript + AppState.transcription.interimTranscript,
    style: AppState.config.style
  });

  // Create WebSocket connection with correct protocol
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
  AppState.websocket.currentConnection = ws;

  let continuationDiv = AppState.dom.continuationDiv;
  continuationDiv.innerHTML = `<p style="color: #000;"></p>`;

  ws.onopen = () => {
    console.info('WebSocket connection established. Starting with an empty audio queue');
    AppState.speech.audioQueue = []; // Queue to store audio elements
    // Send the continuation request
    ws.send(JSON.stringify({ transcription: AppState.transcription.finalTranscript + AppState.transcription.interimTranscript, style: AppState.config.style }));
    
    // Clear transcripts after making WebSocket request
    AppState.transcription.finalTranscript = '';
    AppState.dom.transcriptionDiv.innerHTML = `<p style="color: #000;"></p>`;
  };

  ws.onmessage = async function(event) {
    // Check if this WebSocket is still the current connection
    if (AppState.websocket.currentConnection !== ws) {
      console.warn('Ignoring message from closed WebSocket connection');
      return;
    }
    
    StateManager.updateTranscriptionStatus(false);
    
    const data = JSON.parse(event.data);
    
    if (data.type === 'error') {
      console.error('Error from server:', data.error);
      return;
    }
    
    // Get the new text and update the display
    const newText = data.text;
    if (newText) {
      continuationDiv.textContent = (continuationDiv.textContent || '') + newText;
    }
    console.info('adding new text to speech queue: ', newText);
    AppState.speech.queue.push(newText);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  ws.onclose = () => {
    console.info('WebSocket connection closed');
  };
};

// Once gesture recognizers are loaded, start webcam and initialize speech synthesis
Promise.all([
  createGestureRecognizer(),
  createHandwaveRecognizer()
]).then(() => {
  startWebcam();
  initializeSpeechSynthesis();
});

// Start listening for user input when the document is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    StateManager.initDOM(); // Initialize DOM elements when document is ready
    listenForUserInput();
  });
} else {
  StateManager.initDOM(); // Initialize DOM elements immediately if document is already loaded
  listenForUserInput();
}

// Initialize speech synthesis when the page loads
document.addEventListener('DOMContentLoaded', () => {
  // // Ensure DOM is initialized
  // StateManager.ensureDOMInitialized();
  
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