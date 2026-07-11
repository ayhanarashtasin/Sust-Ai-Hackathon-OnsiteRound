import { modelMetrics, modelStatus } from '../services/ml/modelRuntime.js';

export async function getModelStatus(_req, res) {
  res.json({ models: await modelStatus(), simulated: true });
}

export async function getModelMetrics(_req, res) {
  res.json({ models: await modelMetrics(), simulated: true });
}
