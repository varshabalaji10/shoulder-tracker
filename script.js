// 1) DOM refs & sizing
const videoElement   = document.getElementById('video');
const canvasElement  = document.getElementById('output');
const ctx            = canvasElement.getContext('2d');

const repsInput      = document.getElementById('repsPerSet');
const setsInput      = document.getElementById('totalSets');
const restInput      = document.getElementById('restSeconds');

const startBtn       = document.getElementById('start');
const pauseBtn       = document.getElementById('pause');
const stopBtn        = document.getElementById('stop');
const setCounterDisp = document.getElementById('set-counter');

canvasElement.width  = 640;
canvasElement.height = 480;
videoElement.width   = 640;
videoElement.height  = 480;

// 2) Session & rep state
let currentSet    = 0;
let repsInSet     = 0;
let isRunning     = false;
let isPaused      = false;
let inRest        = false;
let restEndTime   = 0;
let lastWrongArmSpeakTime = 0;


// 3) Rep‐state machine
let stage         = 'down';  // down → up → hold → down
let raiseTime     = 0;

// 4) Hand toggle
let hand = 'right';
document.querySelectorAll('input[name="hand"]').forEach(radio => {
  radio.addEventListener('change', e => {
    hand = e.target.value;
    stage = 'down';
  });
});

// 5) Thresholds & timing constants
const UP_THRESH         = 0.1;    // normalized above shoulder
const DOWN_THRESH       = 0.05;   // normalized below shoulder
const STAND_THRESH      = 0.65;   // normalized shoulder.y > this → crouch
const ELBOW_ANGLE_MIN   = 160;    // degrees
const HOLD_TIME         = 1000;   // ms at full raise

// 6) Audio & Voice helpers
function playSound(url){ new Audio(url).play(); }
function speak(text){ 
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.1;
  speechSynthesis.speak(u);
}

// 7) Utils
function formatTime(sec) {
  const m = Math.floor(sec/60).toString().padStart(2,'0');
  const s = (sec%60).toString().padStart(2,'0');
  return `${m}:${s}`;
}
function updateSetDisplay() {
  setCounterDisp.innerText =
    `Set ${currentSet}/${setsInput.value} • Rep ${repsInSet}/${repsInput.value}`;
}
function angleBetween(a,b,c) {
  const v0={x:a.x-b.x,y:a.y-b.y}, v1={x:c.x-b.x,y:c.y-b.y};
  const dot = v0.x*v1.x + v0.y*v1.y;
  const m0 = Math.hypot(v0.x,v0.y), m1=Math.hypot(v1.x,v1.y);
  return Math.acos(dot/(m0*m1))*(180/Math.PI);
}

// 8) Start rest: set restEndTime
function startRest() {
  inRest = true;
  const restSec = parseInt(restInput.value,10);
  restEndTime = performance.now() + restSec * 1000;
  playSound('https://actions.google.com/sounds/v1/cartoon/metal_twang.ogg');
  speak(`Set ${currentSet} complete. Rest for ${restSec} seconds.`);
}

// 9) Record a rep & advance sets
function recordRep() {
  repsInSet++;
  // Speak the rep count itself
  speak(repsInSet.toString());
  playSound('https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg');
  updateSetDisplay();

  const totalReps = parseInt(repsInput.value, 10);
  const totalSets = parseInt(setsInput.value, 10);

  // If we’ve finished the reps for this set:
  if (repsInSet >= totalReps) {
    // Announce this set’s completion
    if (currentSet < totalSets) {
      startRest(currentSet);
      // Prepare for next set
      currentSet++;
      repsInSet = 0;
      updateSetDisplay();
    } else {
      // Last set done: finish session, no more rest
      speak('Session complete. Great job!');
      isRunning = false;
      // leave camera running so video doesn’t “stick”
    }
  }
}



// 10) onResults — draws video, overlays, and runs rep logic
function onResults(results) {
  // Always draw the live video
  ctx.clearRect(0,0,640,480);
  ctx.drawImage(results.image,0,0,640,480);

  // Overlay rest timer if inRest
  if (inRest) {
    const remaining = Math.ceil((restEndTime - performance.now()) / 1000);
    if (remaining > 0) {
      ctx.font='48px Arial'; ctx.fillStyle='yellow';
      ctx.fillText(formatTime(remaining), 240, 250);
      return;
    } else {
      inRest = false;
      playSound('https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg');
      speak(`Rest over. Starting set ${currentSet}`);
    }
  }

  // Overlay “Session Complete” if finished
  if (!isRunning && !inRest) {
    ctx.font='36px Arial'; ctx.fillStyle='lightgreen';
    ctx.fillText('Session Complete', 180, 250);
    return;
  }

  // Overlay “Paused” if paused
  if (isPaused) {
    ctx.font='36px Arial'; ctx.fillStyle='yellow';
    ctx.fillText('Paused', 280, 250);
    return;
  }

  if (!results.poseLandmarks) return;

  // Draw skeleton
  // Only draw the wrist landmark (and elbow if you like)
const handLandmarkIndices = hand === 'right'
  ? [14, 16]    // right elbow + right wrist
  : [13, 15];   // left  elbow + left  wrist

// grab just those landmarks
const handLandmarks = handLandmarkIndices
  .map(i => results.poseLandmarks[i]);

// draw big dots on them
drawLandmarks(ctx, handLandmarks, {
  color: 'cyan',
  lineWidth: 6,
});

  // ←—— INSERT THE WRONG-ARM CHECK HERE ———→
  // WRONG-ARM CHECK (with voice)
{
  const oppShoulderIdx = hand === 'right' ? 11 : 12;
  const oppWristIdx    = hand === 'right' ? 15 : 16;

  const oppShoulderY = results.poseLandmarks[oppShoulderIdx].y;
  const oppWristY    = results.poseLandmarks[oppWristIdx].y;

  if (oppWristY < oppShoulderY - UP_THRESH) {
    const message = `Please lift your ${hand} arm`;
    // draw text
    ctx.font      = '20px Arial';
    ctx.fillStyle = 'yellow';
    ctx.fillText(message, 10, 30);

    // throttle speaking to once every 2s
    const now = performance.now();
    if (now - lastWrongArmSpeakTime > 2000) {
      speak(message);
      lastWrongArmSpeakTime = now;
    }
    return;
  }
}

  // ←—————— END WRONG-ARM CHECK ——————→


  // Stance check
  const sIdx = hand==='right'?12:11;
  const shoulderY = results.poseLandmarks[sIdx].y;
  if (shoulderY > STAND_THRESH) {
    ctx.font='20px Arial'; ctx.fillStyle='yellow';
    ctx.fillText('Please stand up straight', 10, 30);
    return;
  }

  // Elbow‐extension check
  const eIdx = hand==='right'?14:13;
  const wIdx = hand==='right'?16:15;
  const angle = angleBetween(
    results.poseLandmarks[sIdx],
    results.poseLandmarks[eIdx],
    results.poseLandmarks[wIdx]
  );
  if (angle < ELBOW_ANGLE_MIN) {
    const lineY = shoulderY * 480;
    ctx.beginPath();
    ctx.moveTo(0, lineY); ctx.lineTo(640, lineY);
    ctx.strokeStyle='red'; ctx.lineWidth=2; ctx.stroke();
    ctx.font='20px Arial'; ctx.fillStyle='yellow';
    ctx.fillText('Extend your arm fully', 10, 30);
    return;
  }

  // Draw shoulder line
  const lineY = shoulderY * 480;
  ctx.beginPath();
  ctx.moveTo(0, lineY); ctx.lineTo(640, lineY);
  ctx.strokeStyle='red'; ctx.lineWidth=2; ctx.stroke();

  // Rep state machine with hold‐time
  const wY = results.poseLandmarks[wIdx].y;
  const now = performance.now();
  let feedback = '';

  if (stage === 'down') {
    if (wY < shoulderY - UP_THRESH) {
      stage = 'up';
      raiseTime = now;
      feedback = 'Hold at top...';
    } else {
      feedback = 'Raise your arm higher';
    }
  } else if (stage === 'up') {
    if (now - raiseTime >= HOLD_TIME) {
      stage = 'hold';
      recordRep();
      feedback = 'Lower your arm slowly';
    } else {
      feedback = 'Hold at top...';
    }
  } else { // hold
    if (wY > shoulderY + DOWN_THRESH) {
      stage = 'down';
      feedback = 'Ready for next rep';
    } else {
      feedback = 'Lower fully';
    }
  }

  // Draw feedback text
  ctx.font='20px Arial'; ctx.fillStyle='yellow';
  ctx.fillText(feedback, 10, 30);
}

// 11) MediaPipe initialization
const pose = new Pose({
  locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}`
});
pose.setOptions({
  modelComplexity:        1,
  smoothLandmarks:        true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence:  0.5
});
pose.onResults(onResults);

// 12) Camera helper (front‐facing camera)
const camera = new Camera(videoElement, {
  onFrame: async () => await pose.send({ image: videoElement }),
  width: 640,
  height: 480,
  facingMode: 'user'
});

// 13) Button handlers
startBtn.onclick = () => {
  if (!isRunning) {
    currentSet = 1;
    repsInSet  = 0;
    inRest     = false;
    stage      = 'down';
    updateSetDisplay();
    camera.start().then(() => {
      isRunning = true;
      speak(`Starting session: ${setsInput.value} sets of ${repsInput.value} reps`);
    });
  }
};
pauseBtn.onclick = () => {
  if (!isRunning) return;
  isPaused = !isPaused;
  speak(isPaused ? 'Paused' : 'Resumed');
  pauseBtn.innerText = isPaused ? 'Resume' : 'Pause';
};
stopBtn.onclick = () => {
  camera.stop();
  isRunning = isPaused = inRest = false;
  currentSet = repsInSet = 0;
  stage      = 'down';
  updateSetDisplay();
  ctx.clearRect(0, 0, 640, 480);
  speak('Session stopped');
};
