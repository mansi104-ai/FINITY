FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt requirements-full.txt ./
# The container has room for FinBERT, unlike the serverless target. The CPU
# index is not optional: the default one serves a CUDA torch build that adds
# several GB for no benefit on a headline classifier.
RUN pip install --no-cache-dir -r requirements-full.txt       --extra-index-url https://download.pytorch.org/whl/cpu
COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
