async function postProtectEvaluation(path, body) {
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
  if (!response.ok) throw new Error(`Protect evaluation failed (${response.status})`);
  if (response.status === 204) return undefined;
  return response.json();
}

export async function evaluateProtectBrowserRisk({ userId, signalsData }) {
  const result = await postProtectEvaluation("/api/protect-auth/evaluations", { userId, signalsData });
  if (!result?.level || !["LOW", "MEDIUM", "HIGH"].includes(result.level)) {
    throw new Error("Protect returned an invalid risk result");
  }
  return result;
}
