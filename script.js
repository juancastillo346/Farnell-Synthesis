const brownNoiseButton = document.querySelector("#play-brown-noise");
const brookButton = document.querySelector("#play-brook");
const footstepsButton = document.querySelector("#play-footsteps");
const stopButton = document.querySelector("#stop-audio");
const statusText = document.querySelector("#status");

let audioCtx;
let currentCleanup = null;
let brownNoiseBufferCache = null;
let whiteNoiseBufferCache = null;

async function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }

  if (audioCtx.state === "suspended") {
    await audioCtx.resume();
  }
}

function createBrownNoiseSource(context) {
  if (!brownNoiseBufferCache || brownNoiseBufferCache.sampleRate !== context.sampleRate) {
    const bufferSize = 10 * context.sampleRate;
    brownNoiseBufferCache = context.createBuffer(1, bufferSize, context.sampleRate);
    const output = brownNoiseBufferCache.getChannelData(0);

    let lastOut = 0;

    for (let i = 0; i < bufferSize; i += 1) {
      const brown = Math.random() * 2 - 1;
      output[i] = (lastOut + 0.02 * brown) / 1.02;
      lastOut = output[i];
      output[i] *= 3.5;
    }
  }

  const source = context.createBufferSource();
  source.buffer = brownNoiseBufferCache;
  source.loop = true;
  return source;
}

function createWhiteNoiseSource(context) {
  if (!whiteNoiseBufferCache || whiteNoiseBufferCache.sampleRate !== context.sampleRate) {
    const bufferSize = Math.floor(0.25 * context.sampleRate);
    whiteNoiseBufferCache = context.createBuffer(1, bufferSize, context.sampleRate);
    const output = whiteNoiseBufferCache.getChannelData(0);

    for (let i = 0; i < bufferSize; i += 1) {
      output[i] = Math.random() * 2 - 1;
    }
  }

  const source = context.createBufferSource();
  source.buffer = whiteNoiseBufferCache;
  source.loop = true;
  return source;
}

function createOnePole(context, coefficient) {
  // This smooths the noise a little before it hits the filter.
  const feedforward = [1 - Math.abs(coefficient)];
  const feedback = [1, -coefficient];
  return new IIRFilterNode(context, { feedforward, feedback });
}

function stopCurrentScene() {
  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }
}

function playBrownNoise() {
  stopCurrentScene();

  const source = createBrownNoiseSource(audioCtx);
  const gain = audioCtx.createGain();

  gain.gain.value = 0.08;

  source.connect(gain);
  gain.connect(audioCtx.destination);
  source.start();

  currentCleanup = () => {
    source.stop();
    source.disconnect();
    gain.disconnect();
  };
}

function createBrookLayer({
  controlFrequency,
  controlScale,
  controlOffset,
  rq,
  outputLevel,
}) {
  // Main sound:
  // BrownNoise -> OnePole -> highpass filter -> gain
  const sourceNoise = createBrownNoiseSource(audioCtx);
  const onePole = createOnePole(audioCtx, 0.99);
  const rhpf = audioCtx.createBiquadFilter();
  const outputGain = audioCtx.createGain();

  // Control sound:
  // BrownNoise -> lowpass filter -> scale -> offset -> filter cutoff
  const controlNoise = createBrownNoiseSource(audioCtx);
  const controlLowpass = audioCtx.createBiquadFilter();
  const controlScaleGain = audioCtx.createGain();
  const controlOffsetSource = audioCtx.createConstantSource();

  rhpf.type = "highpass";
  rhpf.frequency.value = 0;
  // Smaller rq means a sharper filter, so we convert it into Q here.
  rhpf.Q.value = 1 / rq;

  // This is the final volume for this layer.
  outputGain.gain.value = outputLevel;

  controlLowpass.type = "lowpass";
  // This makes the cutoff move slowly instead of jumping around fast.
  controlLowpass.frequency.value = controlFrequency;
  controlLowpass.Q.value = 0.0001;

  // These match the "* number + number" part of the SuperCollider patch.
  controlScaleGain.gain.value = controlScale;
  controlOffsetSource.offset.value = controlOffset;

  sourceNoise.connect(onePole);
  onePole.connect(rhpf);
  rhpf.connect(outputGain);

  controlNoise.connect(controlLowpass);
  controlLowpass.connect(controlScaleGain);
  controlScaleGain.connect(rhpf.frequency);
  controlOffsetSource.connect(rhpf.frequency);

  sourceNoise.start();
  controlNoise.start();
  controlOffsetSource.start();

  return {
    output: outputGain,
    stop() {
      sourceNoise.stop();
      controlNoise.stop();
      controlOffsetSource.stop();

      sourceNoise.disconnect();
      onePole.disconnect();
      rhpf.disconnect();
      outputGain.disconnect();
      controlNoise.disconnect();
      controlLowpass.disconnect();
      controlScaleGain.disconnect();
      controlOffsetSource.disconnect();
    },
  };
}

function playBabblingBrook() {
  stopCurrentScene();

  const masterGain = audioCtx.createGain();
  masterGain.gain.value = 1.0;

  // First bubbling layer.
  const layerOne = createBrookLayer({
    controlFrequency: 14,
    controlScale: 400,
    controlOffset: 500,
    rq: 0.03,
    outputLevel: 0.003,
  });

  // Second bubbling layer, brighter and stronger than the first one.
  const layerTwo = createBrookLayer({
    controlFrequency: 20,
    controlScale: 800,
    controlOffset: 1000,
    rq: 0.03,
    outputLevel: 0.02,
  });

  layerOne.output.connect(masterGain);
  layerTwo.output.connect(masterGain);
  masterGain.connect(audioCtx.destination);

  currentCleanup = () => {
    layerOne.stop();
    layerTwo.stop();
    masterGain.disconnect();
  };
}

function registerTimedSource(activeEvents, source, nodes) {
  const entry = { source, nodes };
  activeEvents.add(entry);

  source.onended = () => {
    nodes.forEach((node) => node.disconnect());
    activeEvents.delete(entry);
  };
}

function spawnFilteredNoiseBurst(activeEvents, {
  when,
  duration,
  peakGain,
  highpassFrequency,
  lowpassFrequency,
  pan,
  destination,
}) {
  const source = createWhiteNoiseSource(audioCtx);
  const highpass = audioCtx.createBiquadFilter();
  const lowpass = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();
  const panner = audioCtx.createStereoPanner();

  highpass.type = "highpass";
  highpass.frequency.value = highpassFrequency;
  lowpass.type = "lowpass";
  lowpass.frequency.value = lowpassFrequency;
  panner.pan.value = pan;

  const attackTime = Math.min(0.02, duration * 0.35);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.linearRampToValueAtTime(peakGain, when + attackTime);
  gain.gain.linearRampToValueAtTime(0.0001, when + duration);

  source.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(gain);
  gain.connect(panner);
  panner.connect(destination);

  registerTimedSource(activeEvents, source, [source, highpass, lowpass, gain, panner]);
  source.start(when);
  source.stop(when + duration + 0.03);
}

function spawnCrunchCluster(activeEvents, {
  when,
  bursts,
  spread,
  baseDuration,
  peakGain,
  highpassFrequency,
  lowpassFrequency,
  pan,
  destination,
}) {
  for (let burstIndex = 0; burstIndex < bursts; burstIndex += 1) {
    spawnFilteredNoiseBurst(activeEvents, {
      when: when + burstIndex * spread + Math.random() * 0.004,
      duration: baseDuration + Math.random() * 0.015,
      peakGain: peakGain * (0.85 + Math.random() * 0.35),
      highpassFrequency: highpassFrequency * (0.9 + Math.random() * 0.2),
      lowpassFrequency: lowpassFrequency * (0.9 + Math.random() * 0.18),
      pan,
      destination,
    });
  }
}

function spawnThump(activeEvents, {
  when,
  duration,
  peakGain,
  startFrequency,
  endFrequency,
  pan,
  destination,
}) {
  const oscillator = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const panner = audioCtx.createStereoPanner();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(startFrequency, when);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, when + duration);
  panner.pan.value = pan;

  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.linearRampToValueAtTime(peakGain, when + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

  oscillator.connect(gain);
  gain.connect(panner);
  panner.connect(destination);

  registerTimedSource(activeEvents, oscillator, [oscillator, gain, panner]);
  oscillator.start(when);
  oscillator.stop(when + duration + 0.03);
}

function spawnFootstep(activeEvents, {
  when,
  side,
  destination,
}) {
  const pan = side === "left" ? -0.28 : 0.28;
  const heelTime = when + Math.random() * 0.006;
  const edgeTime = heelTime + 0.055 + Math.random() * 0.012;
  const ballTime = edgeTime + 0.075 + Math.random() * 0.012;

  // Heel hit: low thump plus a short gravel crunch.
  spawnThump(activeEvents, {
    when: heelTime,
    duration: 0.09,
    peakGain: 0.07,
    startFrequency: 105 + Math.random() * 12,
    endFrequency: 52,
    pan,
    destination,
  });

  spawnCrunchCluster(activeEvents, {
    when: heelTime,
    bursts: 2,
    spread: 0.024,
    baseDuration: 0.075,
    peakGain: 0.025,
    highpassFrequency: 350,
    lowpassFrequency: 1800,
    pan,
    destination,
  });

  // Edge roll: keep this subtle so it reads as weight transfer, not a squeak.
  spawnFilteredNoiseBurst(activeEvents, {
    when: edgeTime,
    duration: 0.11,
    peakGain: 0.012,
    highpassFrequency: 480,
    lowpassFrequency: 1900,
    pan,
    destination,
  });

  // Ball push-off: a smaller thump with a brighter crunch at the end.
  spawnThump(activeEvents, {
    when: ballTime,
    duration: 0.07,
    peakGain: 0.035,
    startFrequency: 88,
    endFrequency: 46,
    pan,
    destination,
  });

  spawnCrunchCluster(activeEvents, {
    when: ballTime,
    bursts: 2,
    spread: 0.018,
    baseDuration: 0.055,
    peakGain: 0.018,
    highpassFrequency: 650,
    lowpassFrequency: 2400,
    pan,
    destination,
  });
}

function playFootsteps() {
  stopCurrentScene();

  const masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.82;
  masterGain.connect(audioCtx.destination);

  const activeEvents = new Set();
  let nextSide = "left";

  const scheduleStep = () => {
    spawnFootstep(activeEvents, {
      when: audioCtx.currentTime + 0.03,
      side: nextSide,
      destination: masterGain,
    });

    nextSide = nextSide === "left" ? "right" : "left";
  };

  scheduleStep();
  const stepTimer = window.setInterval(scheduleStep, 720);

  currentCleanup = () => {
    window.clearInterval(stepTimer);

    activeEvents.forEach((entry) => {
      entry.source.onended = null;
      try {
        entry.source.stop();
      } catch (_error) {
        // Ignore sources that already ended.
      }
      entry.nodes.forEach((node) => node.disconnect());
    });

    activeEvents.clear();
    masterGain.disconnect();
  };
}

brownNoiseButton.addEventListener("click", async () => {
  await ensureAudioContext();
  playBrownNoise();
  statusText.textContent =
    "Brown Noise is playing. This is the raw source before OnePole and RHPF shape it into water.";
});

brookButton.addEventListener("click", async () => {
  await ensureAudioContext();
  playBabblingBrook();
  statusText.textContent =
    "Babbling brook is playing. This version follows the James McCartney sample patch.";
});

footstepsButton.addEventListener("click", async () => {
  await ensureAudioContext();
  playFootsteps();
  statusText.textContent =
    "Footsteps are playing. This Part II sound uses heel, edge, and ball phases to drive a gravel texture.";
});

stopButton.addEventListener("click", () => {
  stopCurrentScene();
  statusText.textContent = "Audio stopped.";
});
