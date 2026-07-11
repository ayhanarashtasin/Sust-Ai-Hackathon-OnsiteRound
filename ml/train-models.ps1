param(
  [string]$DatasetDir = "data/ml",
  [string]$ArtifactsDir = "ml/artifacts"
)

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$features = "/workspace/$DatasetDir/features.csv"
$liquidityLabels = "/workspace/$DatasetDir/liquidity_labels.csv"
$anomalyLabels = "/workspace/$DatasetDir/anomaly_labels.csv"

docker build -f (Join-Path $root "ml/Dockerfile") -t sust-super-agent-trainer $root
if (-not $?) { exit $LASTEXITCODE }

docker run --rm -v "${root}:/workspace" sust-super-agent-trainer `
  --features $features --labels $liquidityLabels --out "/workspace/$ArtifactsDir/liquidity" --model-type lightgbm
if (-not $?) { exit $LASTEXITCODE }

docker run --rm -v "${root}:/workspace" sust-super-agent-trainer `
  --features $features --labels $anomalyLabels --out "/workspace/$ArtifactsDir/anomaly" --model-type lightgbm
