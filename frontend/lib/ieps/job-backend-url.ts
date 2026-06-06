export function resolveJobBackendUrl(input?: string): string | undefined {
  if (process.env.NODE_ENV === "production" || process.env.MCM_JOB_QUEUE_MODE === "sqs") {
    return undefined;
  }
  return input;
}
