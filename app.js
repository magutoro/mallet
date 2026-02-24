const passForm = document.querySelector("#pass-form");
const statusEl = document.querySelector("#status");
const notifyForm = document.querySelector("#notify-form");
const notifyStatusEl = document.querySelector("#notify-status");

const barcodeValueInput = document.querySelector("#barcode-value");
const barcodeFormatInput = document.querySelector("#barcode-format");
const passTitleInput = document.querySelector("#pass-title");
const passLabelInput = document.querySelector("#pass-label");
const passSecondaryValueInput = document.querySelector("#pass-secondary-value");
const colorPresetInput = document.querySelector("#color-preset");
const expirationInput = document.querySelector("#expiration-days");

const startCameraButton = document.querySelector("#start-camera");
const stopCameraButton = document.querySelector("#stop-camera");
const uploadImageButton = document.querySelector("#upload-image");
const imageInput = document.querySelector("#image-input");
const cameraWrap = document.querySelector("#camera-wrap");
const cameraStatus = document.querySelector("#camera-status");
const cameraVideo = document.querySelector("#camera");

const generateButton = document.querySelector("#generate-pass");

let cameraStream = null;
let scanFrameHandle = null;
const cameraCanvas = document.createElement("canvas");
const cameraCanvasContext = cameraCanvas.getContext("2d", { willReadFrequently: true });

const detectorSupported = "BarcodeDetector" in window;
const formatMap = {
  aztec: "aztec",
  code_128: "code128",
  pdf417: "pdf417",
  qr_code: "qr"
};

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

function setNotifyStatus(message, type = "") {
  notifyStatusEl.textContent = message;
  notifyStatusEl.className = `status ${type}`.trim();
}

function stopCamera() {
  if (scanFrameHandle) {
    cancelAnimationFrame(scanFrameHandle);
    scanFrameHandle = null;
  }

  if (cameraStream) {
    for (const track of cameraStream.getTracks()) {
      track.stop();
    }
    cameraStream = null;
  }

  cameraVideo.srcObject = null;
  cameraWrap.hidden = true;
}

function applyDetectedCode(rawValue, rawFormat) {
  if (!rawValue) {
    return;
  }

  barcodeValueInput.value = rawValue;
  const mappedFormat = formatMap[(rawFormat || "").toLowerCase()];
  if (mappedFormat) {
    barcodeFormatInput.value = mappedFormat;
  }

  setStatus("Barcode detected and filled in.", "success");
}

async function scanCameraFrame(detector) {
  if (!cameraStream) {
    return;
  }

  if (cameraVideo.readyState < 2) {
    scanFrameHandle = requestAnimationFrame(() => scanCameraFrame(detector));
    return;
  }

  cameraCanvas.width = cameraVideo.videoWidth;
  cameraCanvas.height = cameraVideo.videoHeight;
  cameraCanvasContext.drawImage(cameraVideo, 0, 0, cameraCanvas.width, cameraCanvas.height);

  try {
    const codes = await detector.detect(cameraCanvas);
    if (codes.length > 0) {
      const best = codes[0];
      applyDetectedCode(best.rawValue, best.format);
      cameraStatus.textContent = "Detected. Camera stopped.";
      stopCamera();
      return;
    }
  } catch {
    cameraStatus.textContent = "Scanning failed. Use manual input if needed.";
  }

  scanFrameHandle = requestAnimationFrame(() => scanCameraFrame(detector));
}

async function startCamera() {
  setStatus("");

  if (!detectorSupported) {
    setStatus("This browser does not support live barcode detection. Use upload or manual input.", "error");
    return;
  }

  try {
    const detector = new window.BarcodeDetector({
      formats: ["qr_code", "code_128", "pdf417", "aztec"]
    });

    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" }
      }
    });

    cameraVideo.srcObject = cameraStream;
    cameraWrap.hidden = false;
    cameraStatus.textContent = "Point your camera at the barcode or QR code.";
    scanFrameHandle = requestAnimationFrame(() => scanCameraFrame(detector));
  } catch {
    setStatus("Unable to access your camera. Check browser permissions and try again.", "error");
    stopCamera();
  }
}

async function detectFromImageFile(file) {
  if (!file) {
    return;
  }

  if (!detectorSupported) {
    setStatus("Image barcode detection is not supported in this browser. Enter barcode manually.", "error");
    return;
  }

  setStatus("Reading image...", "");

  try {
    const detector = new window.BarcodeDetector({
      formats: ["qr_code", "code_128", "pdf417", "aztec"]
    });
    const bitmap = await createImageBitmap(file);
    const codes = await detector.detect(bitmap);

    if (codes.length === 0) {
      setStatus("No barcode detected in the image.", "error");
      return;
    }

    const best = codes[0];
    applyDetectedCode(best.rawValue, best.format);
  } catch {
    setStatus("Could not process that image. Try another file or enter manually.", "error");
  }
}

async function generatePass(event) {
  event.preventDefault();
  setStatus("");

  const payload = {
    barcodeValue: barcodeValueInput.value.trim(),
    barcodeFormat: barcodeFormatInput.value,
    title: passTitleInput.value.trim()
  };

  if (passLabelInput.value.trim()) {
    payload.label = passLabelInput.value.trim();
  }
  if (passSecondaryValueInput.value.trim()) {
    payload.value = passSecondaryValueInput.value.trim();
  }
  if (colorPresetInput.value) {
    payload.colorPreset = colorPresetInput.value;
  }
  if (expirationInput.value) {
    payload.expirationDays = Number(expirationInput.value);
  }

  generateButton.disabled = true;
  generateButton.textContent = "Generating...";

  try {
    const response = await fetch("/api/pkpass", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      let message = "Pass generation failed.";
      try {
        const body = await response.json();
        if (body.error) {
          message = body.error;
        }
      } catch {
        message = await response.text();
      }
      setStatus(message, "error");
      return;
    }

    const blob = await response.blob();
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = "mallet-pass.pkpass";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    setStatus("Pass generated. Download started.", "success");
  } catch {
    setStatus("Network error while generating pass.", "error");
  } finally {
    generateButton.disabled = false;
    generateButton.textContent = "Generate .pkpass";
  }
}

function onNotifySubmit(event) {
  event.preventDefault();
  const emailInput = document.querySelector("#notify-email");
  const email = emailInput.value.trim();
  if (!email) {
    setNotifyStatus("Please provide an email address.", "error");
    return;
  }

  localStorage.setItem("mallet_notify_email", email);
  setNotifyStatus("Saved. We will use this for updates in your local demo.", "success");
  notifyForm.reset();
}

startCameraButton.addEventListener("click", startCamera);
stopCameraButton.addEventListener("click", stopCamera);
uploadImageButton.addEventListener("click", () => imageInput.click());
imageInput.addEventListener("change", () => detectFromImageFile(imageInput.files[0]));
passForm.addEventListener("submit", generatePass);
notifyForm.addEventListener("submit", onNotifySubmit);

window.addEventListener("beforeunload", stopCamera);
