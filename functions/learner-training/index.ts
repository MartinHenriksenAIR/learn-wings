import { endpoint } from '../shared/endpoint';
import { getLearnerProgress } from '../shared/learner-progress';

export default endpoint('learner-training', async ({ req, profile, reply, requireActiveMember }) => {
  const { orgId } = await req.json() as { orgId?: unknown };

  if (!orgId || typeof orgId !== 'string') {
    return reply(400, { error: 'orgId is required' });
  }

  await requireActiveMember(orgId);

  const { enrollments, progress } = await getLearnerProgress(profile.id, orgId);
  return reply(200, { enrollments, progress });
});
