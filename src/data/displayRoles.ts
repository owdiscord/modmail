import type { GuildMember, Role } from "discord.js";
import config from "../cfg";
import { useDb } from "../db";
import { getMainRole } from "../utils";

const { fallbackRoleName } = config;

const db = useDb();

export async function getModeratorDefaultRoleOverride(
	moderatorId: string,
): Promise<string | null> {
	const roleOverride =
		await db`SELECT role_id FROM moderator_role_overrides WHERE thread_id IS NULL AND moderator_id = ${moderatorId} LIMIT 1`;

	if (roleOverride && roleOverride.length === 1) return roleOverride[0].role_id;

	return null;
}

export async function setModeratorDefaultRoleOverride(
	moderator_id: string,
	role_id: string,
) {
	const existingGlobalOverride =
		await getModeratorDefaultRoleOverride(moderator_id);
	if (existingGlobalOverride) {
		await db`UPDATE moderator_role_overrides SET role_id = ${role_id} WHERE thread_id IS NULL AND moderator_id = ${moderator_id}`;
	} else {
		await db`INSERT INTO moderator_role_overrides ${db({ thread_id: null, role_id, moderator_id })}`;
	}
}

export async function resetModeratorDefaultRoleOverride(moderator_id: string) {
	await db`DELETE FROM moderator_role_overrides WHERE moderator_id = ${moderator_id} AND thread_id IS NULL`;
}

export async function getModeratorThreadRoleOverride(
	moderator_id: string,
	thread_id: string,
) {
	const roleOverride =
		await db`SELECT role_id FROM moderator_role_overrides WHERE thread_id = ${thread_id} AND moderator_id = ${moderator_id} LIMIT 1`;

	if (roleOverride && roleOverride.length === 1) return roleOverride[0].role_id;

	return null;
}

export async function setModeratorThreadRoleOverride(
	moderator_id: string,
	thread_id: string,
	role_id: string,
) {
	const existingThreadOverride = await getModeratorThreadRoleOverride(
		moderator_id,
		thread_id,
	);

	if (existingThreadOverride) {
		await db`UPDATE moderator_role_overrides SET role_id = ${role_id} WHERE thread_id = ${thread_id} AND moderator_id = ${moderator_id}`;
	} else {
		await db`INSERT INTO moderator_role_overrides ${db({ thread_id: null, role_id, moderator_id })}`;
	}
}

export async function resetModeratorThreadRoleOverride(
	moderator_id: string,
	thread_id: string,
) {
	await db`DELETE FROM moderator_role_overrides WHERE moderator_id = ${moderator_id} AND thread_id = ${thread_id}`;
}

export async function getModeratorDefaultDisplayRole(
	moderator: GuildMember,
): Promise<Role | null> {
	const globalOverrideRoleId = await getModeratorDefaultRoleOverride(
		moderator.id,
	);

	if (globalOverrideRoleId) {
		return await moderator.guild.roles.fetch(globalOverrideRoleId);
	}

	return getMainRole(moderator) || null;
}

export async function getModeratorDefaultDisplayRoleName(
	moderator: GuildMember,
) {
	const defaultDisplayRole = await getModeratorDefaultDisplayRole(moderator);
	return defaultDisplayRole
		? defaultDisplayRole.name
		: fallbackRoleName || null;
}

export async function getModeratorThreadDisplayRole(
	moderator: GuildMember,
	thread_id: string,
): Promise<Role | null> {
	const threadOverrideRoleId = await getModeratorThreadRoleOverride(
		moderator.id,
		thread_id,
	);
	if (threadOverrideRoleId) {
		return await moderator.guild.roles.fetch(threadOverrideRoleId);
	}

	return getModeratorDefaultDisplayRole(moderator);
}

export async function getModeratorThreadDisplayRoleName(
	moderator: GuildMember,
	thread_id: string,
) {
	const threadDisplayRole = await getModeratorThreadDisplayRole(
		moderator,
		thread_id,
	);
	return threadDisplayRole ? threadDisplayRole.name : fallbackRoleName || null;
}

export default {
	getModeratorDefaultRoleOverride,
	setModeratorDefaultRoleOverride,
	resetModeratorDefaultRoleOverride,

	getModeratorThreadRoleOverride,
	setModeratorThreadRoleOverride,
	resetModeratorThreadRoleOverride,

	getModeratorDefaultDisplayRole,
	getModeratorDefaultDisplayRoleName,

	getModeratorThreadDisplayRole,
	getModeratorThreadDisplayRoleName,
};
