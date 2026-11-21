export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackgroundScheduler } = await import(
      "@/backend/jobs/scheduler"
    );
    startBackgroundScheduler();
  }
}
