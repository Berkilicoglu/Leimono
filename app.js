/* Leica Mono Cam - real-time monochrome with tone curve + grain */
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const shutter = document.getElementById('shutter');
const flip = document.getElementById('flip');
const saveLink = document.getElementById('saveLink');
const contrastSlider = document.getElementById('contrast');
const grainSlider = document.getElementById('grain');

let currentStream = null;
let useFront = true;
let rafId = null;

async function startCamera() {
  stopCamera();
  const constraints = {
    video: {
      facingMode: useFront ? 'user' : 'environment',
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    },
    audio: false
  };
  try {
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = currentStream;
    await video.play();
    resizeCanvas();
    renderLoop();
  } catch (e) {
    alert('Kamera erişimi gerekiyor: ' + e.message);
  }
}

function stopCamera() {
  if (rafId) cancelAnimationFrame(rafId);
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
  }
}

function resizeCanvas() {
  const rect = video.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}

window.addEventListener('resize', resizeCanvas);

function applyLeicaMono(imageData, contrast=1.35, grainAmt=0.18) {
  const d = imageData.data;
  const len = d.length;
  // Tone curve control points (approx Leica Monochrom look)
  // We'll apply a gentle S-curve for contrast with deep blacks, protected highlights.
  // Curve implemented via LUT for performance.
  const lut = buildToneCurveLUT();

  // Precompute random grain for this frame
  const grain = new Uint8Array(imageData.width * imageData.height);
  for (let i = 0; i < grain.length; i++) {
    // Gaussian-ish via sum of uniforms
    const n = (Math.random() + Math.random() + Math.random() + Math.random()) / 4; // ~normal(0.5, small)
    grain[i] = (n * 255) | 0;
  }

  let gi = 0;
  for (let i = 0; i < len; i += 4) {
    const r = d[i], g = d[i+1], b = d[i+2];

    // 1) Luminance (Rec. 709)
    let y = 0.2126*r + 0.7152*g + 0.0722*b;

    // 2) Apply S-curve via LUT
    y = lut[y|0];

    // 3) Contrast around mid-gray 128
    y = (y - 128) * contrast + 128;

    // 4) Clamp
    if (y < 0) y = 0; else if (y > 255) y = 255;

    // 5) Grain (blend in overlay-ish)
    const gr = grain[gi++];
    const grainCentered = (gr - 127.5) / 127.5; // -1..1
    y = y + grainAmt * 25 * grainCentered; // subtle

    // Final clamp
    if (y < 0) y = 0; else if (y > 255) y = 255;

    d[i] = d[i+1] = d[i+2] = y;
    // keep alpha
  }
  return imageData;
}

function buildToneCurveLUT() {
  // S-curve via cubic Bezier mapping of 0..1 => 0..1
  // Control points tuned for crushed blacks and protected highlights.
  const p0 = {x:0, y:0};
  const p1 = {x:0.20, y:0.04};   // lower lift
  const p2 = {x:0.70, y:0.90};   // highlight protect
  const p3 = {x:1, y:1};
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const y = cubicBezier(t, p0, p1, p2, p3);
    lut[i] = Math.max(0, Math.min(255, Math.round(y * 255)));
  }
  return lut;
}

function cubicBezier(t, p0, p1, p2, p3) {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  let x = uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x;
  let y = uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y;
  // Since we parametrize x=t, we return y directly.
  return y;
}

function renderLoop() {
  if (!video.videoWidth) { rafId = requestAnimationFrame(renderLoop); return; }
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const cw = canvas.width;
  const ch = canvas.height;

  // Cover fit (like object-fit: cover)
  const vidAspect = vw / vh;
  const canAspect = cw / ch;
  let dw, dh, sx, sy, sw, sh;

  if (vidAspect > canAspect) {
    // video wider than canvas -> crop width
    sh = vh;
    sw = vh * canAspect;
    sy = 0;
    sx = (vw - sw) / 2;
    dw = cw; dh = ch;
  } else {
    // video taller -> crop height
    sw = vw;
    sh = vw / canAspect;
    sx = 0;
    sy = (vh - sh) / 2;
    dw = cw; dh = ch;
  }

  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
  const contrast = parseFloat(contrastSlider.value);
  const grain = parseFloat(grainSlider.value);

  const frame = ctx.getImageData(0, 0, cw, ch);
  const out = applyLeicaMono(frame, contrast, grain);
  ctx.putImageData(out, 0, 0);

  rafId = requestAnimationFrame(renderLoop);
}

shutter.addEventListener('click', () => {
  // Capture current canvas to image and download
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    saveLink.href = url;
    saveLink.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }, 'image/jpeg', 0.95);
});

flip.addEventListener('click', async () => {
  useFront = !useFront;
  await startCamera();
  // Mirror only for front cam
  video.style.transform = useFront ? 'scaleX(-1)' : 'none';
});

window.addEventListener('load', async () => {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('service-worker.js'); } catch(e){}
  }
  await startCamera();
});
