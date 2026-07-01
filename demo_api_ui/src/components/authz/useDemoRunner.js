import { useCallback, useState } from "react";
import apiClient from "../../services/apiClient";

/**
 * Runs a learning-page demo against POST /api/authorize/test-evaluate.
 * transaction demos send { amount, type, acr }; others send { demoType, input }.
 */
export function useDemoRunner() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(async ({ demoType, input, transaction }) => {
    setLoading(true);
    setError(null);
    try {
      const body =
        demoType === "transaction"
          ? { amount: transaction.amount, type: transaction.type, acr: transaction.acr || undefined }
          : { demoType, input: input || {} };
      const { data } = await apiClient.post("/api/authorize/test-evaluate", body);
      setResult(data);
      return data;
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || "Evaluation failed";
      setError(msg);
      setResult(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { result, loading, error, run };
}
