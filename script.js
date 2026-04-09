const brownNoiseButton = document.querySelector("#play-brown-noise");
const brookButton = document.querySelector("#play-brook");
const stopButton = document.querySelector("#stop-audio");
const statusText = document.querySelector("#status");

let audioCtx;
let currentCleanup = null;

async function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }

  if (audioCtx.state === "suspended") {
    await audioCtx.resume();
  }
}

function createBrownNoiseSource(context) {
  const bufferSize = 10 * context.sampleRate;
  const noiseBuffer = context.createBuffer(1, bufferSize, context.sampleRate);
  const output = noiseBuffer.getChannelData(0);

  let lastOut = 0;

  for (let i = 0; i < bufferSize; i += 1) {
    const brown = Math.random() * 2 - 1;
    output[i] = (lastOut + 0.02 * brown) / 1.02;
    lastOut = output[i];
    output[i] *= 3.5;
  }

  const source = context.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;
  return source;
}

function createOnePole(context, coefficient) {
  // Approximate SuperCollider's OnePole.ar using a one-pole IIR filter.
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
  // Main audio path:
  // BrownNoise -> OnePole -> RHPF -> Gain
  const sourceNoise = createBrownNoiseSource(audioCtx);
  const onePole = createOnePole(audioCtx, 0.99);
  const rhpf = audioCtx.createBiquadFilter();
  const outputGain = audioCtx.createGain();

  // Control path for the moving cutoff:
  // BrownNoise -> LPF -> scale -> offset -> rhpf.frequency
  const controlNoise = createBrownNoiseSource(audioCtx);
  const controlLowpass = audioCtx.createBiquadFilter();
  const controlScaleGain = audioCtx.createGain();
  const controlOffsetSource = audioCtx.createConstantSource();

  rhpf.type = "highpass";
  rhpf.frequency.value = 0;
  // SuperCollider uses rq (reciprocal of Q), so Web Audio Q is 1 / rq.
  rhpf.Q.value = 1 / rq;

  // SuperCollider's mul argument is modeled here with an output gain node.
  outputGain.gain.value = outputLevel;

  controlLowpass.type = "lowpass";
  // This LPF makes the modulation move slowly, like bubbling water.
  controlLowpass.frequency.value = controlFrequency;
  controlLowpass.Q.value = 0.0001;

  // These match the "* scale + offset" part of the SuperCollider code.
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
  masterGain.gain.value = 0.4;

  // Layer 1 maps to:
  // RHPF.ar(OnePole.ar(BrownNoise.ar, 0.99), LPF.ar(BrownNoise.ar, 14) * 400 + 500, 0.03, 0.003)
  const layerOne = createBrookLayer({
    controlFrequency: 14,
    controlScale: 400,
    controlOffset: 500,
    rq: 0.03,
    outputLevel: 0.003,
  });

  // Layer 2 maps to:
  // RHPF.ar(OnePole.ar(BrownNoise.ar, 0.99), LPF.ar(BrownNoise.ar, 20) * 800 + 1000, 0.03, 0.005) * 4
  // The original patch multiplies this layer by 4, so the output gain is larger here.
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
    "Babbling brook is playing. This version follows the original patch with two bubbling layers.";
});

stopButton.addEventListener("click", () => {
  stopCurrentScene();
  statusText.textContent = "Audio stopped.";
});
