/**
 * Rollout switch for the flexible Satpam workflow.
 *
 * SATPAM_FLEXIBILITY_ENABLED=true enables every team (the default).
 * SATPAM_FLEXIBILITY_ENABLED=false keeps the legacy strict validation, except
 * for comma-separated team IDs listed in SATPAM_FLEXIBILITY_TEAM_IDS.
 */
export function isSatpamFlexibilityEnabled(teamId: string): boolean {
  if (process.env.SATPAM_FLEXIBILITY_ENABLED !== 'false') return true;
  const pilotTeams = new Set(
    String(process.env.SATPAM_FLEXIBILITY_TEAM_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  return pilotTeams.has(teamId);
}
