async function postProtectAuth(path, body) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-protect-auth-csrf": "1",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Protect authentication update failed (${response.status})`);
  if (response.status === 204) return undefined;
  return response.json();
}

export async function evaluateProtectAuthentication({ userId, signalsData }) {
  const result = await postProtectAuth("/api/protect-auth/evaluations", { userId, signalsData });
  if (!result?.level || !["LOW", "MEDIUM", "HIGH"].includes(result.level)) {
    throw new Error("Protect returned an invalid risk result");
  }
  if (result.level !== "HIGH" && !result.flowId) throw new Error("Protect response is missing its flow handle");
  return result;
}

export function completeProtectAuthentication({ flowId, completionStatus }) {
  if (!flowId || !["SUCCESS", "FAILED"].includes(completionStatus)) {
    return Promise.reject(new Error("Invalid Protect completion request"));
  }
  return postProtectAuth("/api/protect-auth/completions", { flowId, completionStatus });
}
