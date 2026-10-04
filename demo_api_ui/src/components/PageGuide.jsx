import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import DraggableModal from "./DraggableModal";
import { getPageGuide } from "../config/pageGuides";
import { headerButtonCount, onOpenPageGuide, subscribeHeaderButtons } from "./pageGuideStore";
import { getLesson } from "../learning/lessonCatalog";
import DemoStepsGuide from "./DemoStepsGuide";
import "./PageGuide.css";

const IntentBindingLearningPage = lazy(() => import("../pages/IntentBindingLearningPage"));
const BODIES = { "intent-binding": IntentBindingLearningPage, "demo-steps": DemoStepsGuide };

function LessonGuide({ lesson, heading = true }) {
  if (!lesson) return null;
  return (
    <section className="page-guide__lesson">
      {heading && <h3>{lesson.title}</h3>}
      {lesson.talkingPoints?.length > 0 && (
        <ul>
          {lesson.talkingPoints.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      <ol className="page-guide__steps">
        {lesson.walkthrough.map((s) => (
          <li key={s.title}>
            <strong>{s.title}</strong>
            <p>{s.explain}</p>
            <p className="page-guide__demo">Try it: {s.demonstrate}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function PageGuide() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const guide = getPageGuide(pathname);
  // The Guide button lives in the header (TopNav). Pages without that header get
  // the floating button instead, so every guided page has one somewhere.
  const inHeader = useSyncExternalStore(subscribeHeaderButtons, headerButtonCount) > 0;
  useEffect(() => onOpenPageGuide(() => setOpen(true)), []);
  if (!guide) return null;
  const Body = guide.body ? BODIES[guide.body] : null;
  return (
    <>
      {!inHeader && (
        <button type="button" className="page-guide__trigger" onClick={() => setOpen(true)} title="Learning Guide">
          Guide
        </button>
      )}
      <DraggableModal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={guide.title}
        defaultWidth={860}
        defaultHeight={680}
        storageKey="page-guide-modal"
      >
        <div className="dm-scroll page-guide__body">
          {Body ? (
            <Suspense fallback={null}>
              <Body />
            </Suspense>
          ) : (
            guide.lessons ? (
              guide.lessons.map((id) => <LessonGuide key={id} lesson={getLesson(id)} />)
            ) : (
              <LessonGuide lesson={guide} heading={false} />
            )
          )}
        </div>
      </DraggableModal>
    </>
  );
}
