import { moveEdgePoints } from '../ArchitectureSimSvg';

describe('moveEdgePoints', () => {
  const pts = [[0, 0], [10, 0], [10, 50], [20, 50]];

  it('leaves an unmoved edge alone', () => {
    expect(moveEdgePoints(pts, { x: 0, y: 0 }, { x: 0, y: 0 })).toEqual(pts);
  });

  it('shifts the source half with the source box and the target half with the target box', () => {
    expect(moveEdgePoints(pts, { x: 5, y: 5 }, { x: 0, y: 100 })).toEqual([[5, 5], [15, 5], [10, 150], [20, 150]]);
  });
});
