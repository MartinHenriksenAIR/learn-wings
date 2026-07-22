import { queryOne } from '../shared/db';
import { endpoint } from '../shared/endpoint';

export default endpoint('assessment-skip', async ({ profile, reply }) => {
  const row = await queryOne<{ assessment_skipped_at: string }>(
    `UPDATE profiles
     SET assessment_skipped_at = COALESCE(assessment_skipped_at, now())
     WHERE id = $1
     RETURNING assessment_skipped_at`,
    [profile.id],
  );

  return reply(200, { skipped_at: row?.assessment_skipped_at ?? null });
});
