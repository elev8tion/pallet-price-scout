import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Exclusive data-directory lock to prevent two server instances from
 * concurrently modifying the same SQLite database and run artifacts.
 *
 * Uses exclusive file creation (O_EXCL). If the lock exists, checks whether
 * the recorded owner process is still alive before reclaiming. Never steals
 * a live or ambiguous lock.
 */
export class DataLock {
  private readonly lockPath: string;
  private readonly ownerToken: string;
  private acquired = false;

  constructor(dataDir: string) {
    this.lockPath = join(dataDir, ".scout.lock");
    this.ownerToken = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  }

  acquire(): void {
    if (this.acquired) return;
    try {
      const fd = openSync(this.lockPath, "wx");
      writeFileSync(fd, this.ownerToken, { encoding: "utf8" });
      closeSync(fd);
      this.acquired = true;
      return;
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw new Error(`LOCK_ACQUIRE_FAILED: ${error.message}`);
    }
    // Lock exists — check if the owner is still running.
    let content: string;
    try {
      content = readFileSync(this.lockPath, "utf8").trim();
    } catch {
      throw new Error("LOCK_UNREADABLE: cannot read the data lock file; remove it manually if the previous server is not running");
    }
    const pid = Number(content.split(":")[0]);
    if (!Number.isFinite(pid) || pid <= 0) {
      throw new Error("LOCK_AMBIGUOUS: the data lock file has an unrecognized owner; remove it manually if the previous server is not running");
    }
    try {
      process.kill(pid, 0);
      throw new Error(`LOCK_HELD: another server instance (PID ${pid}) owns this data directory`);
    } catch (error: any) {
      if (error.message.startsWith("LOCK_HELD")) throw error;
      // ESRCH or EPERM: process not running or not checkable.
      // If EPERM (can't signal), we are uncertain — refuse to steal.
      if (error.code === "EPERM") {
        throw new Error(`LOCK_UNCERTAIN: the recorded owner (PID ${pid}) could not be checked; remove the lock file manually if it is not running`);
      }
      // ESRCH: process not running — reclaim the stale lock.
      try {
        unlinkSync(this.lockPath);
      } catch {
        throw new Error("LOCK_STALE: cannot remove the stale lock file");
      }
      try {
        const fd = openSync(this.lockPath, "wx");
        writeFileSync(fd, this.ownerToken, { encoding: "utf8" });
        closeSync(fd);
        this.acquired = true;
      } catch (acquireError: any) {
        throw new Error(`LOCK_ACQUIRE_FAILED: ${acquireError.message}`);
      }
    }
  }

  release(): void {
    if (!this.acquired) return;
    this.acquired = false;
    try {
      const content = readFileSync(this.lockPath, "utf8").trim();
      if (content === this.ownerToken) unlinkSync(this.lockPath);
      // If the content doesn't match, it's not our lock — leave it.
    } catch {
      // Lock file already gone or unreadable; nothing to do.
    }
  }
}
