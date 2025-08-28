# Transfer Learning Based Intrusion Detection System Using Fiber Speckle Patterns under Dynamic Environmental Conditions

Browser‑based "transfer learning" demo that classifies "intrusion vs. normal" from multimode‑fiber (MMF) speckle patterns captured by a webcam/camera.  
A frozen "MobileNetV3" backbone provides feature vectors, and a lightweight trainable head is (re)trained *on device with a few new samples to adapt to environmental drift (temperature, pressure/contact, and source‑current variations). Implemented in **TensorFlow.js** and runs on Chrome/Chromium/Edge with optional WebGL acceleration.

> This repository accompanies the paper: **“Transfer Learning Based Intrusion Detection System Using Fiber Speckle Patterns under Dynamic Environmental Conditions.”**

---

## ✨ Highlights

- **On‑device training & inference** (no server GPU required): runs entirely in the browser (TF.js), WebGL if available, CPU fallback otherwise.
- **Transfer learning**: ImageNet‑pretrained MobileNetV3 is **frozen**; only a small 2‑class head is trained.
- **Few‑shot micro‑updates**: collect a handful of boundary samples and trigger a quick head‑only retrain to keep up with slow environmental drift.
- **Thresholded alerting**: shows an on‑screen **INTRUSION** overlay when the intrusion probability exceeds the threshold.
- **RPi 5 & PC**: works on Raspberry Pi 5 (Chromium) and desktop PCs; performance depends on camera resolution and hardware acceleration.

---

## 🗂 Repository Structure

```
.
├─ app.js               # Tiny Node/Express static server (serves /public on port 3000)
├─ public/
│  ├─ index.html        # UI
│  ├─ script.js         # webcam, inference loop, sample collection, auto-retrain trigger
│  ├─ trainer.js        # web worker for background (re)training
│  └─ style.css         # minimal styling
└─ README.md
```

---

## 🚀 Quick Start

### 0) Prerequisites
- **Node.js 18+**
- **Chrome / Chromium / Edge** (allow camera access)
- A webcam (USB or built‑in)

> Browser security requires a **secure context**. `http://localhost` is considered secure for `getUserMedia`, so please run the local server rather than opening files directly.

### 1) Clone & install
```bash
git clone <YOUR_REPO_URL> Intrusion_detection
cd Intrusion_detection

# If you do not already have a package.json:
npm init -y
npm i express
```

### 2) Run
```bash
node app.js
# open http://localhost:3000
```

### 3) Use the app
1. Open `http://localhost:3000` and **allow the camera** when prompted.
2. Click **Enable Webcam** to start the live preview.
3. Collect training images with **Gather Normal** and **Gather Intrusion**.
4. Click **Train & Predict!** to train the head and start real‑time inference.
5. When the **intrusion probability** exceeds the threshold, the UI shows an **INTRUSION** overlay.

> Tip: Start with a balanced set of Normal and Intrusion images from your deployment environment (lighting/temperature/contact conditions). Then let the **few‑shot updates** refine performance on borderline cases.

---

## ⚙️ Key Parameters (see `public/script.js`)

```js
// Intrusion alert threshold (default: 0.70)
const INTRUSION_THRESHOLD = 0.70;

// "Low‑confidence Normal" band upper limit (default: 0.85)
const CONFIDENCE_THRESHOLD = 0.85;

// Number of samples to gather before a micro‑retrain (default: 5)
const RELEARN_BATCH = 5;
```

**Optional (boundary‑focused updates).** If you prefer collecting only borderline Normal samples, limit auto‑collection to a band such as `0.75 ≤ p_normal < 0.85` by modifying the condition that queues Normal samples for retraining, e.g.:

```js
if (inferenceStarted && hi === CLASS1_INDEX &&
    prob[CLASS1_INDEX] >= 0.75 && prob[CLASS1_INDEX] < CONFIDENCE_THRESHOLD) {
  // enqueue feature for boundary-focused few-shot update
}
```

This focuses adaptation on **hard/near‑miss** samples close to the decision boundary, which is typically more effective against slow drift.

---

## 🧠 Model Sketch

- **Backbone**: MobileNetV3 (frozen, feature vectors at 224×224 input)
- **Head**: Dense(1024→128, ReLU) → Dense(128→2, Softmax)
- **Loss/Opt**: standard cross‑entropy with an adaptive optimizer (TF.js)
- **Training**: quick head‑only (re)training in a Web Worker (`trainer.js`) to keep the UI responsive

---


## 🔒 Data & Safety

This is a **research demo**. For real deployments, add proper safety measures, redundancy, and rigorous validation. Follow your organization’s policies regarding camera use and data retention. Avoid collecting personally identifiable information.

---

## 📄 Citation

If you use this code, please cite:

**Hyuek Jae Lee**,  
*Transfer Learning Based Intrusion Detection System Using Fiber Speckle Patterns under Dynamic Environmental Conditions*, 2025 (venue/DOI to be added).  

---

## 🙏 Acknowledgements

- [TensorFlow.js](https://www.tensorflow.org/js)  
- MobileNetV3 feature extractor (TF‑Hub / TF.js graph model)

---

## 🤝 Contributing

Issues and pull requests are welcome. Please keep changes minimal and focused (e.g., new camera adapters, small UI fixes, or documentation improvements).

---

## 📜 License

Choose a license and add it as `LICENSE` (e.g., MIT or Apache‑2.0). Until then, the default is “all rights reserved.”

