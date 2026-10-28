// One strip that links the four DaVinci demos in teaching order, so a presenter
// can move from one to the next without going back to the side nav. Plain
// anchors, like the rest of these lessons: no router dependency, and the pages
// that mock react-router-dom in their tests keep working.
import { DAVINCI_FAMILY } from "../../config/davinciFamily";
import "./DavinciFamilyNav.css";

export default function DavinciFamilyNav({ current }) {
  return (
    <nav className="dvfam lesson-no-print" aria-label="DaVinci demos">
      <ol className="dvfam__list">
        {DAVINCI_FAMILY.map((item, i) => {
          const isCurrent = item.id === current;
          const body = (
            <>
              <span className="dvfam__num" aria-hidden="true">{i + 1}</span>
              <span className="dvfam__text">
                <span className="dvfam__label">{item.label}</span>
                <span className="dvfam__hint">{item.hint}</span>
              </span>
            </>
          );
          const common = {
            className: `dvfam__link${isCurrent ? " is-current" : ""}`,
            "aria-current": isCurrent ? "page" : undefined,
          };
          return (
            <li className="dvfam__item" key={item.id}>
              <a href={item.path} {...common}>{body}</a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
