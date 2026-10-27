import { PaddleOCR } from '@paddleocr/paddleocr-js';
import cvModule from '@techstark/opencv-js';

let engine, cv, queue = Promise.resolve();
async function handle({ id, operation, payload }) {
  try {
    let result;
    if (operation === 'init') {
      engine = await PaddleOCR.create({
        worker: false,
        pipelineConfig: {
          pipeline_name: 'OCR',
          SubModules: {
            TextDetection: { model_name: 'PP-OCRv6_small_det' },
            TextRecognition: { model_name: 'PP-OCRv6_small_rec' }
          }
        },
        textDetectionModelName: 'PP-OCRv6_small_det',
        textRecognitionModelName: 'PP-OCRv6_small_rec',
        textDetectionModelAsset: { url: payload.detection },
        textRecognitionModelAsset: { url: payload.recognition },
        textRecognitionBatchSize: 1,
        ortOptions: { ...payload.runtime, wasmPaths: payload.runtimePath },
        ...payload.parameters
      });
      // The Emscripten Module is a self-resolving thenable, not a native Promise.
      cv = cvModule instanceof Promise ? await cvModule : cvModule;
      result = engine.getInitializationSummary();
    } else if (operation === 'recognize') {
      if (!engine) throw Error('OCR worker is not initialized.');
      const rgba = new Uint8ClampedArray(payload.pixels);
      const mat = cv.matFromImageData({ data: rgba, width: payload.width, height: payload.height });
      try { [result] = await engine.predict(mat, payload.parameters); }
      finally { mat.delete(); }
    } else throw Error('Unknown OCR operation.');
    self.postMessage({ id, result });
  } catch (error) { self.postMessage({ id, error: { message: error.message, name: error.name } }); }
}
self.onmessage = ({ data }) => { queue = queue.then(() => handle(data)); };
