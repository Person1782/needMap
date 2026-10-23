// Keep provider details (request URLs, keys, and report text) out of the UI.
export function analysisFailureMessage(error) {
  const status = error?.customErrorData?.status;
  const details = `${error?.code || ""} ${error?.message || ""}`;
  if (status === 429 || /\b429\b|quota|resource.exhausted|too many requests/i.test(details)) {
    return "The AI analysis service has reached its request limit. Try again later.";
  }
  if ([401, 403].includes(status) || /\b40[13]\b|app.check|api-not-enabled|permission.denied/i.test(details)) {
    return "The AI analysis service could not authorize this request. Check the dashboard's Firebase AI Logic and App Check configuration.";
  }
  if (status >= 500 || /\b50[0234]\b|high demand|overloaded|service unavailable/i.test(details)) {
    return "The AI analysis service is busy or temporarily unavailable. Try again shortly.";
  }
  if (error?.name === "TimeoutError" || /timed?\s*out|timeout/i.test(details)) {
    return "Detailed analysis took too long to respond. Try again shortly.";
  }
  if (/fetch|network|offline/i.test(details)) {
    return "The AI analysis service could not be reached. Check your connection and try again.";
  }
  if (/response|json|evidence|citation/i.test(details)) {
    return "The AI analysis response could not be verified. Try again to generate a new analysis.";
  }
  return "Detailed analysis could not be completed. Try again shortly.";
}
