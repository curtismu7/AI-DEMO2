import { Navigate, useNavigate, useParams } from "react-router-dom";
import TopNav from "../components/TopNav";
import LessonShell from "../components/learning/LessonShell";
import { getLesson } from "../learning/lessonCatalog";
import GuidedJourneyPage from "../pages/GuidedJourneyPage";
import AppShell from "./AppShell";

export function normalizeAcademyMode(routeMode) {
  if (routeMode === undefined) return "guided";
  return routeMode === "guided" || routeMode === "standalone" ? routeMode : null;
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
          >
            {children || (
              <>
                <p>{lesson.category}</p>
                <p>{lesson.talkingPoints[0]}</p>
                <ul>
                  {lesson.talkingPoints.slice(1).map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </>
            )}
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
