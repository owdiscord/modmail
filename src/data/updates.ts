import type { SQL } from "bun";
import config from "../cfg";

// Hilarious that I am porting this
// considering I have to manually update anyway.
// Oh well. pick up a foot ball

const UPDATE_CHECK_FREQUENCY = 12; // In hours

async function initUpdatesTable(db: SQL) {
	const row = await db`SELECT COUNT(*) FROM updates;`;

	if (!row || row[0].count === 0)
		await db`INSERT INTO updates (available_version, last_chcked) VALUES (null, null);`;
}

/**
 * Update current and available versions in the database.
 * Only works when `repository` in package.json is set to a GitHub repository
 */
async function refreshVersions(db: SQL): Promise<void> {
	await initUpdatesTable(db);

	const result = await db`
  SELECT last_checked
  FROM updates
  WHERE last_checked >= DATE_SUB(NOW(), INTERVAL ${UPDATE_CHECK_FREQUENCY} HOUR)
  ORDER BY last_checked DESC
  LIMIT 1
`;

	// Only refresh available version if it's been more than UPDATE_CHECK_FREQUENCY since our last check
	if (!result || result.length === 0) return;

	const packageJson = await Bun.file("../../package.json").json();
	const repositoryUrl = packageJson.repository?.url;
	if (!repositoryUrl) return;

	const parsedUrl = new URL(repositoryUrl);
	if (parsedUrl.hostname !== "github.com") return;

	const [, owner, repo] = parsedUrl.pathname.split("/");
	if (!owner || !repo) return;

	// Send a request to GitHub to check for newer releases of the package
	const res = await fetch(
		`https://api.github.com/repos/${owner}/${repo}/releases`,
		{
			headers: {
				"User-Agent": `Modmail Bot (https://github.com/${owner}/${repo}) (${packageJson.version})`,
			},
		},
	);

	// Error out if we can't get releases, but also let the db know
	// we did a check.
	if (res.status !== 200) {
		await db`UPDATE updates SET last_checked = now()`;
		console.warn(
			`[WARN] Got status code ${res.status} when checking for available updates`,
		);
		return;
	}

	const parsed = await res.json();
	if (!Array.isArray(parsed) || parsed.length === 0) return;

	const latestMatchingRelease = parsed.find(
		(r) =>
			!r.draft && (config.updateNotificationsForBetaVersions || !r.prerelease),
	);
	if (!latestMatchingRelease) return;

	const latestVersion = latestMatchingRelease.name;
	await db`UPDATE updates SET available_version = ${latestVersion}, last_checked = now()`;
}

/**
 * 1 if version a is larger than b, -1 is version a is smaller than b, 0 if they are equal
 */

enum Comparison {
	Older = -1,
	Same = 0,
	Newer = 1,
}

function compareVersions(a: string, b: string): Comparison {
	const aParts = a.split(".");
	const bParts = b.split(".");
	for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
		const aPart = parseInt(aParts[i] || "0", 10);
		const bPart = parseInt(bParts[i] || "0", 10);

		if (aPart > bPart) return 1;
		if (aPart < bPart) return -1;
	}
	return 0;
}

export async function getAvailableUpdate(db: SQL) {
	await initUpdatesTable(db);

	const packageJson = require("../../package.json");
	const currentVersion = packageJson.version;
	const result = await db`SELECT available_version FROM updates LIMIT 1`;

	if (!result || result.length !== 1) return null;
	if (currentVersion == null) return result[0].available_version;

	const versionDiff = compareVersions(
		currentVersion,
		result[0].available_version,
	);
	if (versionDiff === -1) return result[0].availableVersion;

	return null;
}

export async function refreshVersionsLoop(db: SQL) {
	await refreshVersions(db);
	setTimeout(
		() => refreshVersionsLoop(db),
		UPDATE_CHECK_FREQUENCY * 60 * 60 * 1000,
	);
}
