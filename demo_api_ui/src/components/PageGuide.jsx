import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router-dom";
import DraggableModal from "./DraggableModal";
import { getPageGuide } from "../config/pageGuides";
import { headerButtonCount, onOpenPageGuide, subscribeHeaderButtons } from "./pageGuideStore";
import { getLesson } from "../learning/lessonCatalog";
import { LINKED_ROUTES } from "./linkedRoutes";
import DemoStepsGuide from "./DemoStepsGuide";
import A2aReference from "./A2aReference";
import "./PageGuide.css";

// Walkthrough prose names pages ("open the Agent-to-agent tab on Privilege
// Gateway Topologies"). Linkify the first exact occurrence of each mapped
// phrase so the instruction becomes a click instead of dictation.
function LinkedText({ text }) {
  const hits = LINKED_ROUTES.map(([phrase, to]) => {
    const at = text.indexOf(phrase);
    return at === -1 ? null : { phrase, to, at };
  })
    .filter(Boolean)
    .sort((a, b) => a.at - b.at)
    .filter((h, i, all) => i === 0 || h.at >= all[i - 1].at + all[i - 1].phrase.length);
  if (hits.length === 0) return text;
  const parts = [];
  let cursor = 0;
  hits.forEach(({ phrase, to, at }) => {
    if (at > cursor) parts.push(text.slice(cursor, at));
    parts.push(<Link key={to + at} to={to}>{phrase}</Link>);
    cursor = at + phrase.length;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

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
            <p><LinkedText text={s.explain} /></p>
            <p className="page-guide__demo">Try it: <LinkedText text={s.demonstrate} /></p>
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
          {guide.extra === "a2a-reference" && <A2aReference />}
        </div>
      </DraggableModal>
    </>
  );
}
