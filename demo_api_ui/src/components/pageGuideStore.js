// Tiny shared store so the header "Guide" button (in TopNav) and the modal
// (PageGuide, mounted once in App.js) can find each other without a provider.
// Only one header button is "primary": a page that renders two headers still
// shows a single Guide button.
let claimed = false;
const headerSubs = new Set();
const openSubs = new Set();
const emit = () => headerSubs.forEach((f) => f());

/** Returns { primary, release }. Only the first caller is primary. */
export const claimHeaderButton = () => {
  if (claimed) return { primary: false, release: () => {} };
  claimed = true;
  emit();
  return {
    primary: true,
    release: () => {
      claimed = false;
      emit();
    },
  };
};
export const subscribeHeaderButtons = (f) => {
  headerSubs.add(f);
  return () => headerSubs.delete(f);
};
export const headerButtonCount = () => (claimed ? 1 : 0);

export const openPageGuide = () => openSubs.forEach((f) => f());
export const onOpenPageGuide = (f) => {
  openSubs.add(f);
  return () => openSubs.delete(f);
};
