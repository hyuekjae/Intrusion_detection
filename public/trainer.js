// trainer.js - 웹 워커 (백그라운드 재학습 전용)
importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@3.11.0/dist/tf.min.js');

let xs = [];            // Array<Float32Array(1024)>
let ys = [];            // Array<number>
let numClasses = 2;
let trainingInProgress = false;

function createHead(numClasses) {
  const m = tf.sequential();
  m.add(tf.layers.dense({ inputShape: [1024], units: 128, activation: 'relu' }));
  m.add(tf.layers.dense({ units: numClasses, activation: 'softmax' }));
  m.compile({
    optimizer: 'adam',
    loss: (numClasses === 2) ? 'binaryCrossentropy' : 'categoricalCrossentropy',
    metrics: ['accuracy']
  });
  return m;
}

async function trainOnce() {
  if (trainingInProgress) return;
  if (xs.length === 0)   return;

  trainingInProgress = true;
  let model;

  // 기존 최신 가중치로 warm-start (없으면 새로 생성)
  try {
    model = await tf.loadLayersModel('indexeddb://mlp-latest');
    model.compile({
      optimizer: 'adam',
      loss: (numClasses === 2) ? 'binaryCrossentropy' : 'categoricalCrossentropy',
      metrics: ['accuracy']
    });
  } catch (e) {
    model = createHead(numClasses);
  }

  // Float32Array[] -> 하나로 합쳐 텐서화
  const FEATURE_LEN = 1024;
  const flat = new Float32Array(xs.length * FEATURE_LEN);
  for (let i = 0; i < xs.length; i++) {
    flat.set(xs[i], i * FEATURE_LEN);
  }
  const xTensor = tf.tensor2d(flat, [xs.length, FEATURE_LEN]);
  const yTensor = tf.oneHot(tf.tensor1d(ys, 'int32'), numClasses);

  await model.fit(xTensor, yTensor, {
    shuffle: true,
    batchSize: 16,
    epochs: 12,
    callbacks: {
      onEpochEnd: (epoch, logs) => {
        postMessage({ type: 'progress', epoch, logs });
      }
    }
  });

  xTensor.dispose(); yTensor.dispose();
  await model.save('indexeddb://mlp-latest'); // 최신 가중치 갱신
  model.dispose();

  trainingInProgress = false;
  postMessage({ type: 'trained' });
}

onmessage = async (e) => {
  const msg = e.data;

  if (msg.type === 'init') {
    numClasses = msg.numClasses || 2;
  }

  // (하위호환) 신규 배치 추가 후 수동 학습
  if (msg.type === 'pushBatch') {
    const flat = new Float32Array(msg.flat); // transferable
    const count = msg.count;
    const featureLen = msg.featureLen; // 1024
    const label = msg.label;

    for (let i = 0; i < count; i++) {
      const begin = i * featureLen;
      const slice = flat.subarray(begin, begin + featureLen); // view
      xs.push(new Float32Array(slice)); // copy
      ys.push(label);
    }
  }
  if (msg.type === 'forceTrain') {
    trainOnce();
  }

  // ★ 새로 추가: 전체 데이터셋을 교체하고 즉시 재학습
  if (msg.type === 'replaceDatasetAndTrain') {
    const flat = new Float32Array(msg.flat); // transferable
    const c0 = msg.counts.c0;
    const c1 = msg.counts.c1;
    const featureLen = msg.featureLen;

    xs = [];
    ys = [];

    // class 1 (label 0)
    for (let i = 0; i < c0; i++) {
      const begin = i * featureLen;
      const slice = flat.subarray(begin, begin + featureLen);
      xs.push(new Float32Array(slice));
      ys.push(0);
    }
    // class 2 (label 1)
    for (let j = 0; j < c1; j++) {
      const begin = (c0 + j) * featureLen;
      const slice = flat.subarray(begin, begin + featureLen);
      xs.push(new Float32Array(slice));
      ys.push(1);
    }

    trainOnce();
  }
};
