import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface PiInstallation {
  executable: string;
  packageRoot: string;
  moduleEntry: string;
  version: string;
}

const KNOWN_PACKAGE_ROOTS = [
  "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent",
  "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent",
  "/usr/lib/node_modules/@earendil-works/pi-coding-agent",
];

function executablePath(): string | undefined {
  const configured = process.env.PI_EXECUTABLE;
  if (configured && existsSync(configured)) return realpathSync(configured);
  try {
    const candidate = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
    return candidate && existsSync(candidate) ? realpathSync(candidate) : undefined;
  } catch {
    return undefined;
  }
}

function packageRoots(executable: string | undefined): string[] {
  const configured = process.env.PI_CODING_AGENT_PACKAGE;
  const fromExecutable = executable
    ? [
        resolve(dirname(executable), "../lib/node_modules/@earendil-works/pi-coding-agent"),
        resolve(dirname(executable), "../../lib/node_modules/@earendil-works/pi-coding-agent"),
      ]
    : [];
  return [...(configured ? [configured] : []), ...fromExecutable, ...KNOWN_PACKAGE_ROOTS];
}

/** Resolve the already-installed Pi executable and package. Never downloads or installs Pi. */
export function resolvePiInstallation(): PiInstallation {
  const executable = executablePath();
  const packageRoot = packageRoots(executable).find((candidate) => existsSync(join(candidate, "package.json")));
  if (!packageRoot) {
    throw new Error("PI_NOT_FOUND: could not locate the installed Pi package");
  }

  const resolvedRoot = realpathSync(packageRoot);
  const packageJson = JSON.parse(readFileSync(join(resolvedRoot, "package.json"), "utf8")) as {
    version?: string;
  };
  const version = packageJson.version;
  if (!version) throw new Error("PI_VERSION_UNSUPPORTED: installed Pi package has no version");
  const moduleEntry = join(resolvedRoot, "dist/index.js");
  if (!existsSync(moduleEntry)) throw new Error(`PI_VERSION_UNSUPPORTED: missing public entrypoint at ${moduleEntry}`);

  return {
    executable: executable ?? "unknown",
    packageRoot: resolvedRoot,
    moduleEntry,
    version,
  };
}

export function assertSupportedVersion(installation: PiInstallation, supportedMajors = [0, 1]): void {
  const major = Number.parseInt(installation.version.split(".")[0] ?? "-1", 10);
  if (!Number.isFinite(major) || !supportedMajors.includes(major)) {
    throw new Error(`PI_VERSION_UNSUPPORTED: expected Pi major ${supportedMajors.join(" or ")}, found ${installation.version}`);
  }
}
