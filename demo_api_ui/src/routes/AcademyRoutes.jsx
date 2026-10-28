import lazyWithRetry from "../utils/lazyWithRetry";
import { Navigate, useNavigate, useParams } from "react-router-dom";
const TopNav = lazyWithRetry(() => import("../components/TopNav"));
const LessonShell = lazyWithRetry(() => import("../components/learning/LessonShell"));
import { getLesson } from "../learning/lessonCatalog";
const GuidedJourneyPage = lazyWithRetry(() => import("../pages/GuidedJourneyPage"));
const StandaloneDemoLauncherPage = lazyWithRetry(() => import("../pages/StandaloneDemoLauncherPage"));
const OAuthTokenExchangeLessonPage = lazyWithRetry(() => import("../pages/OAuthTokenExchangeLessonPage"));
const AgentIdentityAcademyPage = lazyWithRetry(() => import("../pages/AgentIdentityAcademyPage"));
import {
  canObserveLesson,
  resetLesson,
  runLesson,
} from "../services/lessonExecutionService";
import AppShell from "./AppShell";

export function normalizeAcademyMode(routeMode) {
  if (routeMode === undefined) return "guided";
  return routeMode === "guided" || routeMode === "standalone" ? routeMode : null;
}

export function AcademyLegacyPrefixRoute() {
  const { lessonId, mode } = useParams();
  return <Navigate to={`/academy/${lessonId}/${mode}`} replace />;
}

export function AgentIdentityAcademyRoute({ loading = false, user, logout }) {
  if (loading) return null;

  return (
    <AppShell user={user} logout={logout}>
      <AgentIdentityAcademyPage />
    </AppShell>
  );
}

export function AcademyLessonRoute({ loading, user, logout, children }) {
  const { lessonId, mode: routeMode } = useParams();
  const navigate = useNavigate();
  const lesson = getLesson(lessonId);
  const mode = normalizeAcademyMode(routeMode);

  if (!lesson) return <Navigate to="/learning" replace />;
  if (!mode) return <Navigate to={`/academy/${lessonId}/guided`} replace />;

  return (
    loading ? null : (
      <>
        <TopNav user={user} onLogout={logout} />
        <main className="main-content">
          <LessonShell
            lesson={lesson}
            mode={mode}
            onModeChange={(nextMode) => navigate(`/academy/${lessonId}/${nextMode}`)}
            onRun={
              canObserveLesson(lesson.id)
                ? ({ reset, ...input }) =>
                    reset
                      ? resetLesson(lesson.id)
                      : runLesson(lesson.id, input)
                : undefined
            }
          >
            {children ||
              (lesson.id === "delegation" ? (
                <OAuthTokenExchangeLessonPage />
              ) : (
              <>
                <p>{lesson.category}</p>
                <p>{lesson.talkingPoints[0]}</p>
                <ul>
                  {lesson.talkingPoints.slice(1).map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </>
              ))}
          </LessonShell>
        </main>
      </>
    )
  );
}

export function GuidedJourneyRoute({
  loading = false,
  user,
  logout,
  journeyProps,
}) {
  if (loading) return null;

  return (
    <AppShell user={user} logout={logout}>
      <GuidedJourneyPage {...journeyProps} />
    </AppShell>
  );
}

export function StandaloneDemoLauncherRoute({
  loading = false,
  user,
  logout,
  launcherProps,
}) {
  if (loading) return null;

  return (
    <AppShell user={user} logout={logout}>
      <StandaloneDemoLauncherPage {...launcherProps} />
    </AppShell>
  );
}
