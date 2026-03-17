import numpy as np
from sklearn.preprocessing import MinMaxScaler

class LSTMModel:
    def __init__(self, window: int = 10):
        self.window  = window
        self.scaler  = MinMaxScaler()
        self.model   = None  # lazy-loaded

    def predict(self, df) -> dict:
        prices = df["Close"].values.reshape(-1, 1)
        scaled = self.scaler.fit_transform(prices)
        X      = self._make_sequences(scaled)

        # TODO: load or train model, run inference
        # Placeholder output:
        return {
            "direction":  "up",
            "change_pct": 1.5,
            "confidence": 0.70,
            "model_used": "lstm"
        }

    def _make_sequences(self, data):
        sequences = []
        for i in range(len(data) - self.window):
            sequences.append(data[i:i + self.window])
        return np.array(sequences)