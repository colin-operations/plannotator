import { spawn } from "node:child_process";

const SESSION_ID = /^[A-Za-z0-9_-]{1,256}$/;
const OPEN_TIMEOUT_MS = 15_000;

export type SessionBrowserOpener = (
  url: string,
  options?: { isRemote?: boolean; useGlimpse?: boolean },
) => Promise<boolean>;

function killSessionBrowser(child: ReturnType<typeof spawn>, detached: boolean): void {
  if (detached && child.pid !== undefined) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {}
  }
  child.kill("SIGKILL");
}

export async function openBrowserForSession(
  url: string,
  sessionId: string | undefined,
  timeoutMs = OPEN_TIMEOUT_MS,
): Promise<boolean> {
  const browser = process.env.PLANNOTATOR_SESSION_BROWSER?.trim();
  if (!browser) return false;
  if (!sessionId || !SESSION_ID.test(sessionId)) {
    console.error("[Plannotator] Session browser routing requires a valid OpenCode session ID.");
    return false;
  }

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (opened: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(opened);
    };
    let child: ReturnType<typeof spawn>;
    const detached = process.platform !== "win32";
    try {
      child = spawn(browser, [url], {
        env: { ...process.env, PLANNOTATOR_SESSION_ID: sessionId },
        detached,
        shell: false,
        stdio: "ignore",
      });
    } catch (error) {
      console.error(`[Plannotator] Could not start the session browser: ${error instanceof Error ? error.message : String(error)}`);
      finish(false);
      return;
    }
    timer = setTimeout(() => {
      killSessionBrowser(child, detached);
      console.error(`[Plannotator] Session browser exceeded its ${timeoutMs}ms deadline.`);
      finish(false);
    }, timeoutMs);
    child.once("error", (error) => {
      console.error(`[Plannotator] Session browser failed: ${error.message}`);
      finish(false);
    });
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) console.error(`[Plannotator] Session browser exited with code ${code ?? "unknown"}.`);
      finish(code === 0);
    });
  });
}

export function createSessionBrowserOpener(
  sessionId: string | undefined,
): SessionBrowserOpener | undefined {
  if (!process.env.PLANNOTATOR_SESSION_BROWSER?.trim()) return undefined;
  // A configured session browser must fail closed rather than use a generic
  // process-global opener when invocation identity is absent or invalid.
  return async (url) => await openBrowserForSession(url, sessionId);
}
