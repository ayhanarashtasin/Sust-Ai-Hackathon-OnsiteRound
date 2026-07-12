import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { DECISION_CONFIG } from '../../config/decisionConfig.js';
import { FEATURE_COLUMNS, FEATURE_SCHEMA_VERSION } from './featurePipeline.js';

const TASK_DIR = {
  liquidity_shortage_60m: 'liquidity',
  unusual_activity_review: 'anomaly',
};
const cache = new Map();

function checksum(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function artifactDirectory(task) {
  const subdirectory = TASK_DIR[task];
  if (!subdirectory) throw new Error(`Unsupported model task: ${task}`);
  return resolve(process.cwd(), DECISION_CONFIG.modelDir, subdirectory);
}

function unavailable(task, reason) {
  return { task, available: false, decisionSource: 'rules_only', fallbackReason: reason };
}

function safeArtifactPath(base, relativePath) {
  const resolved = resolve(base, relativePath);
  if (!resolved.startsWith(base + sep)) {
    throw Object.assign(new Error('Artifact path outside expected directory'), { code: 'ENOENT' });
  }
  return resolved;
}

async function load(task) {
  if (!DECISION_CONFIG.mlEnabled) return unavailable(task, 'ML_DISABLED');
  const directory = artifactDirectory(task);
  const manifestPath = join(directory, 'manifest.json');
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const order = manifest?.schema?.feature_order;
    if (!Array.isArray(order) || order.join('|') !== FEATURE_COLUMNS.join('|')) {
      return unavailable(task, 'FEATURE_SCHEMA_MISMATCH');
    }
    if (manifest?.artifacts?.onnx_model?.status !== 'exported') {
      return unavailable(task, 'ONNX_ARTIFACT_UNAVAILABLE');
    }
    const relativePath = manifest.artifacts.onnx_model.path;
    const modelBytes = await readFile(safeArtifactPath(directory, relativePath));
    if (manifest.artifacts.onnx_model.sha256 && checksum(modelBytes) !== manifest.artifacts.onnx_model.sha256) {
      return unavailable(task, 'MODEL_CHECKSUM_MISMATCH');
    }
    let ort;
    try {
      ort = await import('onnxruntime-node');
    } catch {
      return unavailable(task, 'ONNX_RUNTIME_UNAVAILABLE');
    }
    const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['cpu'] });
    let validationPrAuc = null;
    try {
      const evaluation = JSON.parse(await readFile(safeArtifactPath(directory, manifest.artifacts.evaluation.path), 'utf8'));
      validationPrAuc = Number(evaluation?.champion?.validation?.pr_auc) || null;
    } catch {
      // Evaluation metadata improves confidence estimates but is not required for safe inference.
    }
    return {
      task,
      available: true,
      manifest,
      session,
      ort,
      inputName: manifest.artifacts.onnx_model.input_name || session.inputNames[0],
      modelType: manifest.model.type,
      modelVersion: manifest.created_at_utc || manifest.artifacts.native_model.sha256.slice(0, 12),
      featureSchemaVersion: manifest.package_version || FEATURE_SCHEMA_VERSION,
      validationPrAuc,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return unavailable(task, 'MODEL_ARTIFACT_MISSING');
    return unavailable(task, `MODEL_LOAD_ERROR:${error.name}`);
  }
}

async function runtime(task) {
  if (!cache.has(task)) cache.set(task, load(task));
  return cache.get(task);
}

function numericTensor(value) {
  if (!value || !value.data) return null;
  const values = Array.from(value.data, Number).filter(Number.isFinite);
  if (!values.length) return null;
  return values.length > 1 ? values[values.length - 1] : values[0];
}

function outputProbability(outputs) {
  const ordered = Object.entries(outputs).sort(([left], [right]) => {
    const score = (name) => /prob|score/i.test(name) ? 0 : /label/i.test(name) ? 2 : 1;
    return score(left) - score(right);
  });
  for (const [, output] of ordered) {
    const value = numericTensor(output);
    if (value != null && value >= 0 && value <= 1) return value;
  }
  return null;
}

export async function predictModel(task, featureSnapshot) {
  const loaded = await runtime(task);
  if (!loaded.available) return loaded;
  if (featureSnapshot.schemaVersion !== FEATURE_SCHEMA_VERSION || featureSnapshot.vector.length !== FEATURE_COLUMNS.length) {
    return unavailable(task, 'FEATURE_SCHEMA_MISMATCH');
  }
  try {
    const vector = Float32Array.from(featureSnapshot.vector.map((value) => Number.isFinite(value) ? value : 0));
    const input = new loaded.ort.Tensor('float32', vector, [1, vector.length]);
    const outputs = await loaded.session.run({ [loaded.inputName]: input });
    const probability = outputProbability(outputs);
    if (probability == null) return unavailable(task, 'MODEL_OUTPUT_INVALID');
    return {
      task,
      available: true,
      probability,
      threshold: Number(loaded.manifest?.model?.threshold) || 0.5,
      modelType: loaded.modelType,
      modelVersion: loaded.modelVersion,
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      validationPrAuc: loaded.validationPrAuc,
      decisionSource: 'model',
    };
  } catch (error) {
    return unavailable(task, `MODEL_INFERENCE_ERROR:${error.name}`);
  }
}

export async function modelStatus() {
  const tasks = await Promise.all(Object.keys(TASK_DIR).map((task) => runtime(task)));
  return tasks.map((model) => ({
    task: model.task,
    available: model.available,
    modelType: model.modelType || null,
    modelVersion: model.modelVersion || null,
    featureSchemaVersion: model.featureSchemaVersion || FEATURE_SCHEMA_VERSION,
    fallbackReason: model.fallbackReason || null,
  }));
}

export async function modelMetrics() {
  const output = [];
  for (const task of Object.keys(TASK_DIR)) {
    const loaded = await runtime(task);
    if (!loaded.available) {
      output.push({ task, available: false, fallbackReason: loaded.fallbackReason });
      continue;
    }
    try {
      const evaluationPath = safeArtifactPath(artifactDirectory(task), loaded.manifest.artifacts.evaluation.path);
      const evaluation = JSON.parse(await readFile(evaluationPath, 'utf8'));
      output.push({
        task,
        available: true,
        modelType: loaded.modelType,
        modelVersion: loaded.modelVersion,
        threshold: loaded.manifest.model.threshold,
        evaluation: evaluation.champion,
      });
    } catch (error) {
      output.push({ task, available: true, modelType: loaded.modelType, modelVersion: loaded.modelVersion, metricsError: error.name });
    }
  }
  return output;
}

export function clearModelCache() {
  cache.clear();
}
