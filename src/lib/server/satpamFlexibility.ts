/**
 * Rollout switch for the flexible Satpam workflow.
 *
 * SATPAM_FLEXIBILITY_ENABLED=true enables every team (the default).
 * SATPAM_FLEXIBILITY_ENABLED=false keeps the legacy date, shift, and roster
 * restrictions, except for comma-separated team IDs listed in
 * SATPAM_FLEXIBILITY_TEAM_IDS. Intentionally unstaffed posts remain valid.
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
