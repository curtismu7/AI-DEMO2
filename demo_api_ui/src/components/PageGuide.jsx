import { lazy, Suspense, useState } from "react";
import { useLocation } from "react-router-dom";
import DraggableModal from "./DraggableModal";
import { PAGE_GUIDES } from "../config/pageGuides";
import { getLesson } from "../learning/lessonCatalog";
import "./PageGuide.css";

const IntentBindingLearningPage = lazy(() => import("../pages/IntentBindingLearningPage"));
const BODIES = { "intent-binding": IntentBindingLearningPage };

function LessonGuide({ id }) {
  const lesson = getLesson(id);
  if (!lesson) return null;
  return (
    <section className="page-guide__lesson">
      <h3>{lesson.title}</h3>
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
  const guide = PAGE_GUIDES[pathname.replace(/(.)\/$/, "$1")];
  if (!guide) return null;
  const Body = guide.body ? BODIES[guide.body] : null;
  return (
    <>
      <button type="button" className="page-guide__trigger" onClick={() => setOpen(true)} title="Learning Guide">
        Guide
      </button>
      <DraggableModal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={guide.title}
        defaultWidth={860}
        defaultHeight={680}
        storageKey="page-guide-modal"
      >
        <div className="page-guide__body">
          {Body ? (
            <Suspense fallback={null}>
              <Body />
            </Suspense>
          ) : (
            guide.lessons.map((id) => <LessonGuide key={id} id={id} />)
          )}
        </div>
      </DraggableModal>
    </>
  );
}
