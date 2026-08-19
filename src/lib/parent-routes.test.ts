import { describe, it, expect } from 'vitest';

import { parentRouteFor } from './parent-routes';
import { routes } from './routes';

const HOME = routes.learner.dashboard;

describe('parentRouteFor — top-level destinations have no parent (#462)', () => {
  it.each([
    routes.learner.dashboard,
    routes.learner.training,
    routes.learner.courses,
    routes.learner.tips,
    routes.community.feed,
    routes.community.events,
    routes.community.resources,
    routes.orgAdmin.root,
    routes.orgAdmin.settings,
    routes.orgAdmin.ideas,
    routes.orgAdmin.moderation,
    routes.platformAdmin.organizations,
    routes.platformAdmin.courses,
    routes.platformAdmin.analytics,
    routes.platformAdmin.settings,
    routes.platformAdmin.moderation,
  ])('returns null for %s', (path) => {
    expect(parentRouteFor(path, HOME)).toBeNull();
  });
});

describe('parentRouteFor — child pages climb one level (#462)', () => {
  it.each([
    [routes.learner.courseDetail('c-1'), routes.learner.courses],
    [routes.learner.coursePlayer('c-1'), routes.learner.courses],
    [routes.learner.coursePlayer('c-1', 'training'), routes.learner.courses],
    [routes.community.postDetail('org', 'p-1'), routes.community.feed],
    [routes.community.ideas, routes.community.feed],
    [routes.community.ideaNew, routes.community.ideas],
    [routes.community.ideaDetail('i-1'), routes.community.ideas],
    [routes.community.ideaEdit('i-1'), routes.community.ideas],
    [routes.platformAdmin.organizationDetail('o-1'), routes.platformAdmin.organizations],
    [routes.platformAdmin.courseEditor('c-1'), routes.platformAdmin.courses],
  ])('maps %s to %s', (path, expected) => {
    expect(parentRouteFor(path, HOME)).toBe(expected);
  });

  it('sends post edit back to the post it edits', () => {
    expect(parentRouteFor(routes.community.postEdit('org', 'p-1'), HOME)).toBe(
      routes.community.postDetail('org', 'p-1'),
    );
  });

  it('resolves the role home for pages that hang off it', () => {
    expect(parentRouteFor(routes.settings, HOME)).toBe(HOME);
    expect(parentRouteFor(routes.learner.assessment, HOME)).toBe(HOME);
  });

  it('resolves the role home per role rather than hard-coding the learner dashboard', () => {
    const adminHome = routes.platformAdmin.organizations;
    expect(parentRouteFor(routes.settings, adminHome)).toBe(adminHome);
  });

  it('does not mistake the idea-create route for an idea id', () => {
    expect(parentRouteFor(routes.community.ideaNew, HOME)).toBe(routes.community.ideas);
    expect(parentRouteFor(routes.community.ideaDetail('new-ish'), HOME)).toBe(routes.community.ideas);
  });
});
