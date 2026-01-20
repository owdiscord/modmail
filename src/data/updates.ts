import moment from "moment";
import config from "../cfg";
import knex from "../knex";

const UPDATE_CHECK_FREQUENCY = 12; // In hours

async function initUpdatesTable() {
	const row = await knex("updates").first();
	if (!row) {
		await knex("updates").insert({
			available_version: null,
			last_checked: null,
		});
	}
}

/**
 * Update current and available versions in the database.
 * Only works when `repository` in package.json is set to a GitHub repository
 */
async function refreshVersions(): Promise<void> {
	await initUpdatesTable();
	const { last_checked } = await knex("updates").first();

	// Only refresh available version if it's been more than UPDATE_CHECK_FREQUENCY since our last check
	if (
		last_checked != null &&
		last_checked >
			moment
				.utc()
				.subtract(UPDATE_CHECK_FREQUENCY, "hours")
				.format("YYYY-MM-DD HH:mm:ss")
	)
		return;

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
		await knex("updates").update({
			last_checked: moment.utc().format("YYYY-MM-DD HH:mm:ss"),
		});
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
	await knex("updates").update({
		available_version: latestVersion,
		last_checked: moment.utc().format("YYYY-MM-DD HH:mm:ss"),
	});
}

/**
 * @param {String} a Version string, e.g. "2.20.0"
 * @param {String} b Version string, e.g. "2.20.0"
 * @returns {Number} 1 if version a is larger than b, -1 is version a is smaller than b, 0 if they are equal
 */

function compareVersions(a: string, b: string): number {
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

export async function getAvailableUpdate() {
	await initUpdatesTable();

	const packageJson = require("../../package.json");
	const currentVersion = packageJson.version;
	const { available_version: availableVersion } = await knex("updates").first();
	if (availableVersion == null) return null;
	if (currentVersion == null) return availableVersion;

	const versionDiff = compareVersions(currentVersion, availableVersion);
	if (versionDiff === -1) return availableVersion;

	return null;
}

export async function refreshVersionsLoop() {
	await refreshVersions();
	setTimeout(refreshVersionsLoop, UPDATE_CHECK_FREQUENCY * 60 * 60 * 1000);
}
