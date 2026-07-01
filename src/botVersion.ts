import fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function getPrettyVersion() {
  const gitDir = path.resolve(import.meta.dirname, "..", ".git");

  async function getPackageVersion() {
    const packageJson = JSON.parse(
      await readFile(
        path.join(
          import.meta.dirname,
          process.env.NODE_ENV === "production"
            ? "package.json"
            : "../package.json",
        ),
        "utf-8",
      ),
    );
    return packageJson.version;
  }

  async function getHeadCommitHash() {
    try {
      fs.accessSync(gitDir);
    } catch (_e) {
      return null;
    }

    // Find HEAD ref and read the commit hash from that ref
    const headRefInfo = await readFile(path.resolve(gitDir, "HEAD"), {
      encoding: "utf8",
    });
    if (headRefInfo.startsWith("ref:")) {
      const refPath = headRefInfo.slice(5).trim(); // ref: refs/heads/... to refs/heads/...
      return fs
        .readFileSync(path.resolve(gitDir, refPath), { encoding: "utf8" })
        .trim();
    } else {
      // Detached head, just the commit hash
      return headRefInfo.trim();
    }
  }

  const packageVersion = await getPackageVersion();
  const headCommitHash = await getHeadCommitHash();

  return headCommitHash
    ? `v${packageVersion} (${headCommitHash.slice(0, 7)})`
    : packageVersion;
}
