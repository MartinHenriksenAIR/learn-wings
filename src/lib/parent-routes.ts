import { matchPath } from 'react-router-dom';
import { routes } from './routes';

type RouteParams = Record<string, string | undefined>;
type ParentResolver = (params: RouteParams, homeHref: string) => string;

const PARENT_ROUTES: ReadonlyArray<readonly [string, ParentResolver]> = [
  [
    routes.community.postEditPattern,
    (params) =>
      params.scope && params.postId
        ? routes.community.postDetail(params.scope, params.postId)
        : routes.community.feed,
  ],
  [routes.community.postDetailPattern, () => routes.community.feed],
  [routes.community.ideaNew, () => routes.community.ideas],
  [routes.community.ideaEditPattern, () => routes.community.ideas],
  [routes.community.ideaDetailPattern, () => routes.community.ideas],
  [routes.community.ideas, () => routes.community.feed],
  [routes.learner.courseDetailPattern, () => routes.learner.courses],
  [routes.learner.coursePlayerPattern, () => routes.learner.courses],
  [routes.learner.assessment, (_params, homeHref) => homeHref],
  [routes.platformAdmin.organizationDetailPattern, () => routes.platformAdmin.organizations],
  [routes.platformAdmin.courseEditorPattern, () => routes.platformAdmin.courses],
  [routes.settings, (_params, homeHref) => homeHref],
];

export function parentRouteFor(pathname: string, homeHref: string): string | null {
  for (const [pattern, resolveParent] of PARENT_ROUTES) {
    const match = matchPath(pattern, pathname);
    if (match) {
      return resolveParent(match.params, homeHref);
    }
  }
  return null;
}
