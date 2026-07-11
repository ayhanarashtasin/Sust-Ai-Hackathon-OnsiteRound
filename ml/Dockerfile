FROM python:3.11-slim

WORKDIR /workspace/ml
COPY ml/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --timeout 300 --retries 15 -r requirements.txt
RUN apt-get update \
  && apt-get install -y --no-install-recommends libgomp1 \
  && rm -rf /var/lib/apt/lists/*

ENTRYPOINT ["python", "train.py"]
