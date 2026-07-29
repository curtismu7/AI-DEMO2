import {
  renderDiagram,
  LANE_WIDTH,
  HEADER_HEIGHT,
  STEP_HEIGHT,
  MARGIN,
  COLORS,
} from '../diagramRenderer';

// Mock document.createElementNS and appendChild for pure unit testing
describe('diagramRenderer', () => {
  describe('constants', () => {
    it('exports correct layout constants', () => {
      expect(LANE_WIDTH).toBe(150);
      expect(HEADER_HEIGHT).toBe(50);
      expect(STEP_HEIGHT).toBe(60);
      expect(MARGIN).toBe(20);
    });

    it('exports color palette for dark theme', () => {
      expect(COLORS.background).toBe('#1a1a1a');
      expect(COLORS.text).toBe('#e0e0e0');
      expect(COLORS.headerBg).toBe('#2563eb');
      expect(COLORS.headerText).toBe('#ffffff');
      expect(COLORS.currentStepBorder).toBe('#10b981');
      expect(COLORS.emptyMessage).toBe('#999999');
    });
  });

  describe('renderDiagram', () => {
    beforeEach(() => {
      // Mock document for SVG element creation
      jest.spyOn(document, 'createElementNS').mockImplementation((ns, tag) => {
        const element = document.createElement(tag === 'svg' ? 'div' : 'span');
        element._tag = tag;
        element._ns = ns;
        element._attrs = {};
        element._children = [];
        element.setAttribute = jest.fn((key, value) => {
          element._attrs[key] = value;
        });
        element.appendChild = jest.fn((child) => {
          element._children.push(child);
        });
        return element;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('returns an SVG element', () => {
      const spec = {
        actors: ['Actor A', 'Actor B'],
        steps: [],
      };
      const svg = renderDiagram(spec, 800, 600);
      expect(svg._tag).toBe('svg');
      expect(svg._ns).toBe('http://www.w3.org/2000/svg');
    });

    it('sets correct SVG viewBox dimensions', () => {
      const spec = {
        actors: ['Actor A'],
        steps: [],
      };
      const width = 1000;
      const height = 700;
      const svg = renderDiagram(spec, width, height);
      expect(svg._attrs.width).toBe(width);
      expect(svg._attrs.height).toBe(height);
      expect(svg._attrs.viewBox).toBe(`0 0 ${width} ${height}`);
    });

    it('renders background rectangle', () => {
      const spec = {
        actors: [],
        steps: [],
      };
      const svg = renderDiagram(spec, 800, 600);
      const bgRect = svg._children.find((child) => child._tag === 'rect');
      expect(bgRect).toBeDefined();
      expect(bgRect._attrs.fill).toBe(COLORS.background);
      expect(bgRect._attrs.width).toBe(800);
      expect(bgRect._attrs.height).toBe(600);
    });

    it('handles null flowSpec', () => {
      const svg = renderDiagram(null, 800, 600);
      expect(svg._tag).toBe('svg');
      const textEl = svg._children.find((child) => child._tag === 'text');
      expect(textEl).toBeDefined();
      expect(textEl.textContent).toBe('No flow specification provided');
    });

    it('handles empty actors array', () => {
      const svg = renderDiagram({ actors: [], steps: [] }, 800, 600);
      const textEl = svg._children.find((child) => child._tag === 'text');
      expect(textEl).toBeDefined();
      expect(textEl.textContent).toBe('No flow specification provided');
    });

    it('handles undefined flowSpec', () => {
      const svg = renderDiagram(undefined, 800, 600);
      const textEl = svg._children.find((child) => child._tag === 'text');
      expect(textEl).toBeDefined();
      expect(textEl.textContent).toBe('No flow specification provided');
    });

    it('displays empty message centered on canvas', () => {
      const width = 800;
      const height = 600;
      const svg = renderDiagram(null, width, height);
      const textEl = svg._children.find((child) => child._tag === 'text');
      expect(textEl._attrs.x).toBe(width / 2);
      expect(textEl._attrs.y).toBe(height / 2);
      expect(textEl._attrs['text-anchor']).toBe('middle');
      expect(textEl._attrs['dominant-baseline']).toBe('middle');
    });

    it('renders actor headers as blue boxes', () => {
      const spec = {
        actors: ['Alice', 'Bob'],
        steps: [],
      };
      const svg = renderDiagram(spec, 800, 600);
      const headerBoxes = svg._children.filter(
        (child) => child._tag === 'rect' && child._attrs.fill === COLORS.headerBg
      );
      expect(headerBoxes.length).toBe(2);
      expect(headerBoxes[0]._attrs.height).toBe(HEADER_HEIGHT);
      expect(headerBoxes[0]._attrs.width).toBe(LANE_WIDTH - 5);
    });

    it('renders actor labels in headers', () => {
      const spec = {
        actors: ['Alice', 'Bob', 'Charlie'],
        steps: [],
      };
      const svg = renderDiagram(spec, 1000, 600);
      const headerTexts = svg._children.filter(
        (child) => child._tag === 'text' && child._attrs.fill === COLORS.headerText
      );
      expect(headerTexts.length).toBe(3);
      expect(headerTexts[0].textContent).toBe('Alice');
      expect(headerTexts[1].textContent).toBe('Bob');
      expect(headerTexts[2].textContent).toBe('Charlie');
    });

    it('renders vertical dashed lane lines', () => {
      const spec = {
        actors: ['Alice', 'Bob'],
        steps: [],
      };
      const svg = renderDiagram(spec, 800, 600);
      const laneLines = svg._children.filter(
        (child) => child._tag === 'line' && child._attrs['stroke-dasharray']
      );
      expect(laneLines.length).toBe(2);
      expect(laneLines[0]._attrs.stroke).toBe(COLORS.laneLine);
      expect(laneLines[0]._attrs['stroke-dasharray']).toBe('5,5');
    });

    it('renders single step with correct positioning', () => {
      const spec = {
        actors: ['Alice', 'Bob'],
        steps: [
          {
            id: 'step1',
            fromActor: 'Alice',
            toActor: 'Bob',
            label: 'Send request',
          },
        ],
      };
      const svg = renderDiagram(spec, 800, 600);
      const stepBg = svg._children.find(
        (child) => child._tag === 'rect' && child._attrs.fill === COLORS.stepBg
      );
      expect(stepBg).toBeDefined();
      expect(stepBg._attrs.stroke).toBe(COLORS.stepBorder);
      expect(stepBg._attrs['stroke-width']).toBe(1);
    });

    it('renders step label text', () => {
      const spec = {
        actors: ['Alice', 'Bob'],
        steps: [
          {
            id: 'step1',
            fromActor: 'Alice',
            toActor: 'Bob',
            label: 'Send message',
          },
        ],
      };
      const svg = renderDiagram(spec, 800, 600);
      const stepTexts = svg._children.filter(
        (child) => child._tag === 'text' && child._attrs.fill === COLORS.text
      );
      const labelText = stepTexts.find((t) => t.textContent === 'Send message');
      expect(labelText).toBeDefined();
    });

    it('highlights current step with green border', () => {
      const spec = {
        actors: ['Alice', 'Bob'],
        steps: [
          { id: 'step1', fromActor: 'Alice', toActor: 'Bob', label: 'First' },
          { id: 'step2', fromActor: 'Bob', toActor: 'Alice', label: 'Second' },
        ],
      };
      const svg = renderDiagram(spec, 800, 600, 'step2');
      // Find the step with thicker border (stroke-width 3) which is current
      const currentStepBox = svg._children.find(
        (child) =>
          child._tag === 'rect' &&
          child._attrs.stroke === COLORS.currentStepBorder &&
          child._attrs['stroke-width'] === 3
      );
      expect(currentStepBox).toBeDefined();
      expect(currentStepBox._attrs.fill).toBe(COLORS.currentStepBg);
    });

    it('uses thicker arrow for current step', () => {
      const spec = {
        actors: ['Alice', 'Bob'],
        steps: [
          { id: 'step1', fromActor: 'Alice', toActor: 'Bob', label: 'First' },
        ],
      };
      const svg = renderDiagram(spec, 800, 600, 'step1');
      const arrows = svg._children.filter((child) => child._tag === 'line');
      const currentArrow = arrows.find(
        (arrow) =>
          arrow._attrs.stroke === COLORS.currentStepBorder &&
          arrow._attrs['stroke-width'] === 2
      );
      expect(currentArrow).toBeDefined();
    });

    it('renders multiple steps sequentially', () => {
      const spec = {
        actors: ['User', 'Server', 'DB'],
        steps: [
          {
            id: 'step1',
            fromActor: 'User',
            toActor: 'Server',
            label: 'Request',
          },
          {
            id: 'step2',
            fromActor: 'Server',
            toActor: 'DB',
            label: 'Query',
          },
          {
            id: 'step3',
            fromActor: 'DB',
            toActor: 'Server',
            label: 'Result',
          },
        ],
      };
      const svg = renderDiagram(spec, 800, 600);
      const stepBoxes = svg._children.filter(
        (child) =>
          child._tag === 'rect' &&
          (child._attrs.fill === COLORS.stepBg ||
            child._attrs.fill === COLORS.currentStepBg)
      );
      // Should have actor header boxes + step boxes
      expect(stepBoxes.length).toBeGreaterThanOrEqual(3);
    });

    it('uses default label when step has no label', () => {
      const spec = {
        actors: ['Alice', 'Bob'],
        steps: [
          {
            id: 'step1',
            fromActor: 'Alice',
            toActor: 'Bob',
          },
        ],
      };
      const svg = renderDiagram(spec, 800, 600);
      const stepTexts = svg._children.filter(
        (child) => child._tag === 'text' && child._attrs.fill === COLORS.text
      );
      const defaultLabel = stepTexts.find((t) =>
        t.textContent.includes('Alice → Bob')
      );
      expect(defaultLabel).toBeDefined();
    });

    it('skips steps with missing fromActor', () => {
      const spec = {
        actors: ['Alice', 'Bob'],
        steps: [
          {
            id: 'step1',
            toActor: 'Bob',
            label: 'Incomplete step',
          },
        ],
      };
      const svg = renderDiagram(spec, 800, 600);
      const incompleteLabel = svg._children.find(
        (child) => child.textContent === 'Incomplete step'
      );
      expect(incompleteLabel).toBeUndefined();
    });

    it('skips steps with missing toActor', () => {
      const spec = {
        actors: ['Alice', 'Bob'],
        steps: [
          {
            id: 'step1',
            fromActor: 'Alice',
            label: 'Incomplete step',
          },
        ],
      };
      const svg = renderDiagram(spec, 800, 600);
      const incompleteLabel = svg._children.find(
        (child) => child.textContent === 'Incomplete step'
      );
      expect(incompleteLabel).toBeUndefined();
    });

    it('skips steps with non-existent actors', () => {
      const spec = {
        actors: ['Alice', 'Bob'],
        steps: [
          {
            id: 'step1',
            fromActor: 'Charlie',
            toActor: 'Bob',
            label: 'From non-existent',
          },
        ],
      };
      const svg = renderDiagram(spec, 800, 600);
      const invalidLabel = svg._children.find(
        (child) => child.textContent === 'From non-existent'
      );
      expect(invalidLabel).toBeUndefined();
    });

    it('renders arrow markers for normal and current steps', () => {
      const spec = {
        actors: ['Alice', 'Bob', 'Charlie'],
        steps: [
          { id: 'step1', fromActor: 'Alice', toActor: 'Bob', label: 'First' },
          { id: 'step2', fromActor: 'Bob', toActor: 'Charlie', label: 'Second' },
        ],
      };
      const svg = renderDiagram(spec, 800, 600, 'step1');
      const defs = svg._children.find((child) => child._tag === 'defs');
      expect(defs).toBeDefined();
      const markers = defs._children.filter((child) => child._tag === 'marker');
      expect(markers.length).toBe(2);
      expect(markers[0]._attrs.id).toBe('arrowhead-normal');
      expect(markers[1]._attrs.id).toBe('arrowhead-current');
    });

    it('applies correct namespace to SVG', () => {
      const spec = { actors: ['Alice'], steps: [] };
      const svg = renderDiagram(spec, 800, 600);
      expect(svg._attrs.xmlns).toBe('http://www.w3.org/2000/svg');
      expect(svg._attrs['xmlns:xlink']).toBe('http://www.w3.org/1999/xlink');
    });

    it('handles single actor', () => {
      const spec = {
        actors: ['Standalone'],
        steps: [],
      };
      const svg = renderDiagram(spec, 800, 600);
      const headerTexts = svg._children.filter(
        (child) => child._tag === 'text' && child._attrs.fill === COLORS.headerText
      );
      expect(headerTexts.length).toBe(1);
      expect(headerTexts[0].textContent).toBe('Standalone');
    });

    it('handles many actors', () => {
      const actors = Array.from({ length: 10 }, (_, i) => `Actor${i + 1}`);
      const spec = { actors, steps: [] };
      const svg = renderDiagram(spec, 2000, 600);
      const headerTexts = svg._children.filter(
        (child) => child._tag === 'text' && child._attrs.fill === COLORS.headerText
      );
      expect(headerTexts.length).toBe(10);
    });

    it('positions actor headers with correct spacing', () => {
      const spec = {
        actors: ['Alice', 'Bob'],
        steps: [],
      };
      const svg = renderDiagram(spec, 800, 600);
      const headerTexts = svg._children.filter(
        (child) => child._tag === 'text' && child._attrs.fill === COLORS.headerText
      );
      const firstHeaderX = parseFloat(headerTexts[0]._attrs.x);
      const secondHeaderX = parseFloat(headerTexts[1]._attrs.x);
      expect(secondHeaderX - firstHeaderX).toBe(LANE_WIDTH);
    });

    it('handles step with same source and target actor', () => {
      const spec = {
        actors: ['Alice', 'Bob'],
        steps: [
          {
            id: 'step1',
            fromActor: 'Alice',
            toActor: 'Alice',
            label: 'Self call',
          },
        ],
      };
      const svg = renderDiagram(spec, 800, 600);
      // Should render without error
      expect(svg._tag).toBe('svg');
    });

    it('does not throw on null steps array', () => {
      const spec = {
        actors: ['Alice', 'Bob'],
        steps: null,
      };
      expect(() => renderDiagram(spec, 800, 600)).not.toThrow();
    });

    it('handles mixed valid and invalid steps gracefully', () => {
      const spec = {
        actors: ['Alice', 'Bob', 'Charlie'],
        steps: [
          { id: 'valid1', fromActor: 'Alice', toActor: 'Bob', label: 'Valid' },
          { id: 'invalid1', fromActor: 'Unknown', toActor: 'Bob', label: 'Invalid' },
          { id: 'valid2', fromActor: 'Bob', toActor: 'Charlie', label: 'Valid2' },
        ],
      };
      const svg = renderDiagram(spec, 800, 600);
      const validLabels = svg._children.filter(
        (child) =>
          child._tag === 'text' &&
          (child.textContent === 'Valid' || child.textContent === 'Valid2')
      );
      expect(validLabels.length).toBe(2);
    });

    it('sets header box border radius', () => {
      const spec = {
        actors: ['Alice'],
        steps: [],
      };
      const svg = renderDiagram(spec, 800, 600);
      const headerBox = svg._children.find(
        (child) => child._tag === 'rect' && child._attrs.fill === COLORS.headerBg
      );
      expect(headerBox._attrs.rx).toBe(4);
    });

    it('sets step box border radius', () => {
      const spec = {
        actors: ['Alice', 'Bob'],
        steps: [
          {
            id: 'step1',
            fromActor: 'Alice',
            toActor: 'Bob',
            label: 'Test',
          },
        ],
      };
      const svg = renderDiagram(spec, 800, 600);
      const stepBox = svg._children.find(
        (child) => child._tag === 'rect' && child._attrs.fill === COLORS.stepBg
      );
      expect(stepBox._attrs.rx).toBe(2);
    });

    it('renders with large canvas', () => {
      const spec = {
        actors: ['Alice', 'Bob'],
        steps: [
          {
            id: 'step1',
            fromActor: 'Alice',
            toActor: 'Bob',
            label: 'Test',
          },
        ],
      };
      const svg = renderDiagram(spec, 4000, 3000);
      expect(svg._attrs.width).toBe(4000);
      expect(svg._attrs.height).toBe(3000);
    });

    it('renders with small canvas', () => {
      const spec = {
        actors: ['A'],
        steps: [],
      };
      const svg = renderDiagram(spec, 200, 200);
      expect(svg._attrs.width).toBe(200);
      expect(svg._attrs.height).toBe(200);
    });

    it('preserves step ID without rendering it visually', () => {
      // Step IDs are used for matching currentStep but not rendered as text
      const spec = {
        actors: ['Alice', 'Bob'],
        steps: [
          {
            id: 'unique-step-id-123',
            fromActor: 'Alice',
            toActor: 'Bob',
            label: 'Test step',
          },
        ],
      };
      const svg = renderDiagram(spec, 800, 600, 'unique-step-id-123');
      const currentStepBox = svg._children.find(
        (child) =>
          child._tag === 'rect' && child._attrs['stroke-width'] === 3
      );
      expect(currentStepBox).toBeDefined();
    });

    it('does not highlight non-matching currentStep ID', () => {
      const spec = {
        actors: ['Alice', 'Bob'],
        steps: [
          {
            id: 'step1',
            fromActor: 'Alice',
            toActor: 'Bob',
            label: 'Test',
          },
        ],
      };
      const svg = renderDiagram(spec, 800, 600, 'non-existent-step');
      const normalStepBox = svg._children.find(
        (child) =>
          child._tag === 'rect' &&
          child._attrs.fill === COLORS.stepBg &&
          child._attrs['stroke-width'] === 1
      );
      expect(normalStepBox).toBeDefined();
    });
  });
});
