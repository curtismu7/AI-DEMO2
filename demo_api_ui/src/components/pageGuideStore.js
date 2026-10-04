// Tiny shared store so the header "Guide" button (in TopNav) and the modal
// (PageGuide, mounted once in App.js) can find each other without a provider.
let headerButtons = 0;
const headerSubs = new Set();
const openSubs = new Set();

export const registerHeaderButton = () => {
  headerButtons += 1;
  headerSubs.forEach((f) => f());
  return () => {
    headerButtons -= 1;
    headerSubs.forEach((f) => f());
  };
};
export const subscribeHeaderButtons = (f) => {
  headerSubs.add(f);
  return () => headerSubs.delete(f);
};
export const headerButtonCount = () => headerButtons;

export const openPageGuide = () => openSubs.forEach((f) => f());
export const onOpenPageGuide = (f) => {
  openSubs.add(f);
  return () => openSubs.delete(f);
};
