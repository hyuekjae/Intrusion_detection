// =======================
// script.js (CSV logging version)
// =======================

const STATUS = document.getElementById('status');
const VIDEO = document.getElementById('webcam');
const ENABLE_CAM_BUTTON = document.getElementById('enableCam');
const RESET_BUTTON = document.getElementById('reset');
const TRAIN_BUTTON = document.getElementById('train');

const MOBILE_NET_INPUT_WIDTH = 224;
const MOBILE_NET_INPUT_HEIGHT = 224;

const STOP_DATA_GATHER = -1;
const CLASS_NAMES = [];

// ----- Bottom Log Panel (optional) -----
const LOG_STREAM = document.getElementById('logStream');
const LOG_MAX = 500;
function appendLog(msg) {
  if (!LOG_STREAM) return;
  const t = new Date();
  const line = document.createElement('div');
  line.textContent = `[${t.toLocaleTimeString()}] ${msg}`;
  LOG_STREAM.appendChild(line);
  while (LOG_STREAM.childElementCount > LOG_MAX) {
    LOG_STREAM.removeChild(LOG_STREAM.firstChild);
  }
  LOG_STREAM.parentElement.scrollTop = LOG_STREAM.parentElement.scrollHeight;
}

// ===== Detection CSV logging (det_data.csv) =====
// 저장 형식: 헤더 포함 "seq,normal,intrusion" (소수점 ., 행 구분 CRLF)
// Excel 호환: UTF-8 BOM + CRLF
let DET_active = false;
let DET_seq = 0;
let DET_rows = [];                 // 문자열 행 버퍼 (header 포함)
let DET_fileHandle = null;         // File System Access API 핸들
let DET_requestedPicker = false;   // 저장 위치 1회만 요청

async function DET_openPickerOnce() {
  if (DET_requestedPicker) return;
  DET_requestedPicker = true;
  if ('showSaveFilePicker' in window) {
    try {
      DET_fileHandle = await window.showSaveFilePicker({
        suggestedName: 'det_data.csv',
        types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }]
      });
      appendLog && appendLog('det_data.csv 저장 위치 선택됨');
    } catch (e) {
      DET_fileHandle = null; // 취소 → fallback 사용
      appendLog && appendLog('파일 저장 위치 선택 취소됨 → 자동 다운로드(fallback)');
    }
  } else {
    appendLog && appendLog('File System Access API 미지원 → 자동 다운로드(fallback)');
  }
}

function DET_start() {
  DET_active = true;
  DET_seq = 0;
  DET_rows = [];
  // CSV header
  DET_rows.push('seq,normal,intrusion');
}

function DET_append(normalProb, intrusionProb) {
  if (!DET_active) return;
  DET_seq += 1;
  // 소수점 3자리, 쉼표로 분리, 공백 없음
  const row = `${DET_seq},${normalProb.toFixed(3)},${intrusionProb.toFixed(3)}`;
  DET_rows.push(row);
}

// 버퍼 → CSV 파일 저장
async function DET_saveNow() {
  if (!DET_rows.length) return;
  // CRLF 결합 + UTF-8 BOM
  const csvText = '\uFEFF' + DET_rows.join('\r\n') + '\r\n';
  try {
    if (DET_fileHandle) {
      const writable = await DET_fileHandle.createWritable();
      await writable.write(new Blob([csvText], { type: 'text/csv;charset=utf-8;' }));
      await writable.close();
      appendLog && appendLog(`det_data.csv 저장 완료 (${DET_rows.length - 1}개 레코드)`);
    } else {
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'det_data.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      appendLog && appendLog(`det_data.csv 자동 다운로드 완료 (${DET_rows.length - 1}개 레코드)`);
    }
  } catch (e) {
    appendLog && appendLog(`det_data.csv 저장 오류: ${e?.message || e}`);
  } finally {
    DET_rows = [];  // 저장 후 비움
  }
}

// 페이지 이탈 전에 저장 시도
window.addEventListener('pagehide', () => { DET_saveNow(); });
window.addEventListener('beforeunload', () => { DET_saveNow(); });

// ----- Result bars (optional) -----
const RESULT_ROWS = document.getElementById('resultRows');
function buildResultRows() {
  if (!RESULT_ROWS) return;
  RESULT_ROWS.innerHTML = '';
  const names = (CLASS_NAMES.length ? CLASS_NAMES : ['Class 1', 'Class 2']);
  names.forEach((name, idx) => {
    const row = document.createElement('div');
    row.className = 'cls-row';
    row.innerHTML = `
      <div class="cls-label">${name}</div>
      <div class="meter"><div class="bar" id="bar-${idx}"></div></div>
      <div class="pct" id="pct-${idx}">0%</div>
    `;
    RESULT_ROWS.appendChild(row);
  });
}
function updateResultBars(probArray) {
  if (!probArray || !RESULT_ROWS) return;
  for (let i = 0; i < probArray.length; i++) {
    const pct = Math.round(probArray[i] * 100);
    const bar = document.getElementById(`bar-${i}`);
    const txt = document.getElementById(`pct-${i}`);
    if (bar) bar.style.width = `${pct}%`;
    if (txt) txt.textContent = `${pct}%`;
  }
}

// ----- Buttons / events -----
ENABLE_CAM_BUTTON.addEventListener('click', enableCam);
TRAIN_BUTTON.addEventListener('click', trainAndPredict);
RESET_BUTTON.addEventListener('click', reset);

// 데이터 수집 버튼
let dataCollectorButtons = document.querySelectorAll('button.dataCollector');
for (let i = 0; i < dataCollectorButtons.length; i++) {
  dataCollectorButtons[i].addEventListener('mousedown', gatherDataForClass);
  dataCollectorButtons[i].addEventListener('mouseup', gatherDataForClass);
  CLASS_NAMES.push(dataCollectorButtons[i].getAttribute('data-name'));
}
buildResultRows();

// ----- Retraining policy -----
const CLASS1_INDEX = 0;
const CLASS2_INDEX = 1;
const CONFIDENCE_THRESHOLD = 0.85;
const LOWER_NORMAL_BAND = 0.75;
const RELEARN_BATCH = 5;
const CAPTURE_COOLDOWN_MS = 100;

// ----- INTRUSION overlay -----
const INTRUSION_THRESHOLD = 0.70;
let intrusionPrevAbove = false;
let intrusionHideTimer = null;

function ensureIntrusionOverlay() {
  if (document.getElementById('intrusion-overlay')) return;
  const div = document.createElement('div');
  div.id = 'intrusion-overlay';
  Object.assign(div.style, {
    position: 'fixed',
    inset: '0',
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '99999',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
    fontSize: '72px',
    fontWeight: '900',
    color: '#ffffff',
    textShadow: '0 2px 6px rgba(0,0,0,.45)',
    background: 'rgba(220, 20, 60, 0.22)',
    transition: 'opacity 220ms ease',
    opacity: '0'
  });
  div.textContent = 'INTRUSION';
  document.body.appendChild(div);
}
function showIntrusionOnce() {
  ensureIntrusionOverlay();
  const div = document.getElementById('intrusion-overlay');
  if (!div) return;
  div.style.display = 'flex';
  requestAnimationFrame(() => { div.style.opacity = '1'; });
  clearTimeout(intrusionHideTimer);
  intrusionHideTimer = setTimeout(() => {
    div.style.opacity = '0';
    setTimeout(() => { div.style.display = 'none'; }, 250);
  }, 1000);
  appendLog && appendLog('INTRUSION triggered (Class 2 >= 70%)');
}


// === NEW: 알람(사운드) & 지속표시 유틸 ===
const ALARM_COOLDOWN_MS = 3000;
let lastAlarmTime = 0;

let audioCtx;
function ringAlarm() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(()=>{});
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.value = 0.0008;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    const now = audioCtx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.40);
    o.stop(now + 0.42);
    if (navigator.vibrate) navigator.vibrate(200);
  } catch (e) { /* ignore */ }
}

function showIntrusionActive() {
  ensureIntrusionOverlay();
  const div = document.getElementById('intrusion-overlay');
  if (!div) return;
  div.style.display = 'flex';
  div.style.opacity = '1';
}

function hideIntrusionActive() {
  const div = document.getElementById('intrusion-overlay');
  if (!div) return;
  div.style.opacity = '0';
  setTimeout(() => { div.style.display = 'none'; }, 250);
}




// ----- Runtime states -----
let mobilenet = undefined;
let videoPlaying = false;
let predict = false;         // 초기엔 false (초기훈련 후 시작)
let inferenceStarted = false;

let gatherDataState = STOP_DATA_GATHER;
let trainingDataInputs = [];
let trainingDataOutputs = [];
let examplesCount = [];

const FEATURE_LEN = 1024;
const classPools = [[], []];
let lowConfBatch = [];
let lastCaptureTime = 0;

// =======================
// Load MobileNet feature extractor
// =======================
async function loadMobileNetFeatureModel() {
  const URL =
    'https://tfhub.dev/google/tfjs-model/imagenet/mobilenet_v3_small_100_224/feature_vector/5/default/1';
  mobilenet = await tf.loadGraphModel(URL, { fromTFHub: true });
  STATUS.innerText = 'MobileNet v3 loaded successfully!';
  appendLog('MobileNet v3 feature extractor loaded');
  tf.tidy(function () {
    let answer = mobilenet.predict(tf.zeros([1, MOBILE_NET_INPUT_HEIGHT, MOBILE_NET_INPUT_WIDTH, 3]));
    console.log('MobileNet output shape:', answer.shape);
  });
}
loadMobileNetFeatureModel();

// =======================
// Classifier (MLP head)
// =======================
let model = tf.sequential();
model.add(tf.layers.dense({ inputShape: [1024], units: 128, activation: 'relu' }));
model.add(tf.layers.dense({ units: CLASS_NAMES.length || 2, activation: 'softmax' }));
model.compile({
  optimizer: 'adam',
  loss: ((CLASS_NAMES.length || 2) === 2) ? 'binaryCrossentropy' : 'categoricalCrossentropy',
  metrics: ['accuracy']
});
model.summary();

// =======================
// Webcam
// =======================
function hasGetUserMedia() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}
function enableCam() {
  if (hasGetUserMedia()) {
    const constraints = { video: true, width: 640, height: 480 };
    navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
      VIDEO.srcObject = stream;
      VIDEO.addEventListener('loadeddata', function onLoaded() {
        VIDEO.removeEventListener('loadeddata', onLoaded);
        videoPlaying = true;
        ENABLE_CAM_BUTTON.classList.add('removed');
        appendLog('Webcam enabled & video stream started');
      });
    }).catch(err => {
      appendLog(`Webcam error: ${err?.message || err}`);
    });
  } else {
    const msg = 'getUserMedia() is not supported by your browser';
    console.warn(msg);
    appendLog(msg);
  }
}

// =======================
// Manual data gather
// =======================
function gatherDataForClass() {
  let classNumber = parseInt(this.getAttribute('data-1hot'));
  const toggledOn = (gatherDataState === STOP_DATA_GATHER);
  gatherDataState = toggledOn ? classNumber : STOP_DATA_GATHER;
  appendLog(toggledOn ? `Start collecting for class ${classNumber}` : `Stop collecting`);
  dataGatherLoop();
}
function dataGatherLoop() {
  if (videoPlaying && gatherDataState !== STOP_DATA_GATHER) {
    let imageFeatures = calculateFeaturesOnCurrentFrame();
    trainingDataInputs.push(imageFeatures);
    trainingDataOutputs.push(gatherDataState);
    const copy = imageFeatures.dataSync();
    classPools[gatherDataState].push(copy);
    if (examplesCount[gatherDataState] === undefined) examplesCount[gatherDataState] = 0;
    examplesCount[gatherDataState]++;
    STATUS.innerText = '';
    for (let n = 0; n < CLASS_NAMES.length; n++) {
      STATUS.innerText += CLASS_NAMES[n] + ' data count: ' + (examplesCount[n] || 0) + '. ';
    }
    window.requestAnimationFrame(dataGatherLoop);
  }
}

// =======================
// Feature extraction
// =======================
function calculateFeaturesOnCurrentFrame() {
  return tf.tidy(function () {
    let videoFrameAsTensor = tf.browser.fromPixels(VIDEO);
    let resizedTensorFrame = tf.image.resizeBilinear(
      videoFrameAsTensor, [MOBILE_NET_INPUT_HEIGHT, MOBILE_NET_INPUT_WIDTH], true
    );
    let normalizedTensorFrame = resizedTensorFrame.div(255);
    return mobilenet.predict(normalizedTensorFrame.expandDims()).squeeze();
  });
}

// =======================
// Initial train → inference → start logging
// =======================
async function trainAndPredict() {
  predict = false;
  appendLog('Initial training started');

  tf.util.shuffleCombo(trainingDataInputs, trainingDataOutputs);
  let outputsAsTensor = tf.tensor1d(trainingDataOutputs, 'int32');
  let oneHotOutputs = tf.oneHot(outputsAsTensor, CLASS_NAMES.length);
  let inputsAsTensor = tf.stack(trainingDataInputs);

  await model.fit(inputsAsTensor, oneHotOutputs, {
    shuffle: true,
    batchSize: 5,
    epochs: 10,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        console.log('Initial epoch', epoch, logs);
        appendLog(`Initial train epoch ${epoch + 1} acc=${(logs.acc || logs.accuracy || 0).toFixed(3)}`);
      }
    }
  });

  outputsAsTensor.dispose();
  oneHotOutputs.dispose();
  inputsAsTensor.dispose();

  await model.save('indexeddb://mlp-latest');
  appendLog('Initial model saved to IndexedDB (mlp-latest)');

  inferenceStarted = true;
  STATUS.innerText = '초기 학습 완료. 인식기 모드 시작!';
  appendLog('Switched to inference mode');

  // CSV 로깅 시작 + 저장 위치 선택(사용자 제스처 컨텍스트)
  DET_start();
  await DET_openPickerOnce();

  startPredictLoop();
}

// =======================
// Worker (retraining)
// =======================
const trainer = new Worker('trainer.js');
trainer.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'progress') {
    STATUS.innerText = `재학습 중… epoch ${msg.epoch + 1} acc=${(msg.logs.acc || msg.logs.accuracy || 0).toFixed(3)}`;
    appendLog(`Retrain epoch ${msg.epoch + 1} acc=${(msg.logs.acc || msg.logs.accuracy || 0).toFixed(3)}`);
  }
  if (msg.type === 'trained') {
    try {
      const newHead = await tf.loadLayersModel('indexeddb://mlp-latest');
      const old = model;
      model = newHead;
      if (old) old.dispose();
      const t = new Date().toLocaleTimeString();
      STATUS.innerText = `[${t}] 분류기 가중치 업데이트 완료!`;
      appendLog('Classifier weights updated (hot-swap completed)');
      startPredictLoop();
    } catch (err) {
      console.error('새 MLP 로드 실패:', err);
      STATUS.innerText = '가중치 업데이트 실패';
      appendLog(`Weight update failed: ${err?.message || err}`);
    }
  }
};
trainer.postMessage({ type: 'init', numClasses: CLASS_NAMES.length || 2 });

function startPredictLoop() {
  if (!videoPlaying) { appendLog('Predict wait: video not ready'); return; }
  if (!model)        { appendLog('Predict wait: model not ready'); return; }
  if (!mobilenet)    { appendLog('Predict wait: mobilenet not ready'); return; }
  if (!predict) {
    predict = true;
    appendLog('Predict loop started');
    requestAnimationFrame(predictLoop);
  }
}

// =======================
// Real-time predict loop
// =======================
function predictLoop() {
  if (!predict) return;
  try {
    tf.tidy(() => {
      const feat = calculateFeaturesOnCurrentFrame();
      const pred = model.predict(feat.expandDims()).squeeze();
      const prob = pred.arraySync();
      const hi = pred.argMax().arraySync();

      if (STATUS) {
        STATUS.innerText = `Prediction: ${(CLASS_NAMES[hi] || hi)} with ${Math.floor(prob[hi] * 100)}% confidence`;
      }
      updateResultBars(prob);

      // CSV 로깅
      if (inferenceStarted) {
        const normalP = prob[CLASS1_INDEX] ?? 0;
        const intruP  = prob[CLASS2_INDEX] ?? 0;
        DET_append(normalP, intruP);
      }

      // Intrusion overlay
      //const c2Above = prob[CLASS2_INDEX] >= INTRUSION_THRESHOLD;
      //if (inferenceStarted && c2Above && !intrusionPrevAbove) showIntrusionOnce();
      //intrusionPrevAbove = c2Above;


	// Intrusion overlay + audio alarm (지속표시 + 주기적 삑)
	const c2Above = prob[CLASS2_INDEX] >= INTRUSION_THRESHOLD;

	if (inferenceStarted && c2Above) {
	  showIntrusionActive();                 // 화면 경고 계속 표시
	  const now = performance.now();
	  if (now - lastAlarmTime > ALARM_COOLDOWN_MS) {
	    ringAlarm();                         // 3초 쿨다운으로 주기적 삑
	    lastAlarmTime = now;
	    appendLog && appendLog('INTRUSION alarm (Class 2 >= 70%)');
	  }
	} else {
	  hideIntrusionActive();                 // 임계치 밑이면 숨김
	}

	intrusionPrevAbove = c2Above;            // (다른 로직과 호환 위해 유지)





      // Retrain trigger
      if (inferenceStarted && hi === CLASS1_INDEX &&
                         prob[CLASS1_INDEX] >= LOWER_NORMAL_BAND && prob[CLASS1_INDEX] < CONFIDENCE_THRESHOLD) {
        const now = performance.now();
        if (now - lastCaptureTime > CAPTURE_COOLDOWN_MS) {
          const f = feat.dataSync();
          lowConfBatch.push(f);
          lastCaptureTime = now;
          appendLog(`Low-confidence Class 1 sample collected (${lowConfBatch.length}/${RELEARN_BATCH})`);
          if (lowConfBatch.length >= RELEARN_BATCH) {
            const toRemove = Math.min(RELEARN_BATCH, classPools[CLASS1_INDEX].length);
            if (toRemove > 0) classPools[CLASS1_INDEX].splice(0, toRemove);
            for (let i = 0; i < RELEARN_BATCH; i++) classPools[CLASS1_INDEX].push(lowConfBatch[i]);
            const c0 = classPools[0].length;
            const c1 = classPools[1].length;
            const total = c0 + c1;
            const flat = new Float32Array(total * FEATURE_LEN);
            for (let i = 0; i < c0; i++) flat.set(classPools[0][i], i * FEATURE_LEN);
            for (let j = 0; j < c1; j++) flat.set(classPools[1][j], (c0 + j) * FEATURE_LEN);
            trainer.postMessage(
              { type: 'replaceDatasetAndTrain', flat, counts: { c0, c1 }, featureLen: FEATURE_LEN },
              [flat.buffer]
            );
            lowConfBatch = [];
            STATUS.innerText = `Class 1 오래된 ${toRemove}장 교체 → 재학습 시작`;
            appendLog(`Class 1: removed ${toRemove}, added ${RELEARN_BATCH} → retraining started`);
          }
        }
      }
    });
  } catch (err) {
    appendLog(`predictLoop error: ${err?.message || err}`);
  }
  requestAnimationFrame(predictLoop);
}

// =======================
// Reset
// =======================
function reset() {
  predict = false;
  inferenceStarted = false;
  lowConfBatch = [];
  intrusionPrevAbove = false;

  examplesCount.splice(0);
  for (let i = 0; i < trainingDataInputs.length; i++) {
    trainingDataInputs[i].dispose();
  }
  trainingDataInputs.splice(0);
  trainingDataOutputs.splice(0);

  classPools[0] = [];
  classPools[1] = [];

  STATUS.innerText = 'No data collected';
  appendLog('Reset called: cleared buffers and stopped inference');

  // CSV 저장
  DET_active = false;
  DET_saveNow();

  console.log('Tensors in memory: ' + tf.memory().numTensors);
}
