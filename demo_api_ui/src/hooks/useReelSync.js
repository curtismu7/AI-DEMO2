import { useEffect } from "react";

/**
 * A click on a movie-reel card (TokenChainFilmstrip) announces its step on window as "token-chain-step-select".
 * `reelSync(stepId)` maps it to this diagram's step index; the diagram is walked there and the <details> it sits in
 * (if any) is opened. `rootRef` is any element inside the diagram.
 */
export function useReelSync(reelSync, goTo, count, rootRef) {
  useEffect(() => {
    if (!reelSync) return undefined;
    const onSelect = (e) => {
      const i = reelSync(e.detail?.stepId);
      if (!Number.isInteger(i) || i < 0 || i >= count) return;
      const box = rootRef.current?.closest("details");
      if (box) box.open = true;
      goTo(i);
    };
    window.addEventListener("token-chain-step-select", onSelect);
    return () => window.removeEventListener("token-chain-step-select", onSelect);
  }, [reelSync, goTo, count, rootRef]);
}
