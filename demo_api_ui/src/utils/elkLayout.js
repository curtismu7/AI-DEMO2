let elkInstancePromise;

export function getElk() {
  if (!elkInstancePromise) {
    elkInstancePromise = import('elkjs/lib/elk.bundled.js').then(({ default: ELK }) => new ELK());
  }
  return elkInstancePromise;
}
