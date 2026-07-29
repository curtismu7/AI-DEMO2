/**
 * SVG Diagram Renderer Service
 * Pure SVG rendering engine for sequence diagrams.
 * No external dependencies, uses native SVG DOM APIs only.
 */

// Constants for layout
const LANE_WIDTH = 150;
const HEADER_HEIGHT = 50;
const STEP_HEIGHT = 60;
const MARGIN = 20;

// Dark theme compatible colors
const COLORS = {
  background: '#1a1a1a',
  text: '#e0e0e0',
  laneLine: '#444444',
  headerBg: '#2563eb',
  headerText: '#ffffff',
  stepBorder: '#888888',
  stepBg: '#2a2a2a',
  currentStepBorder: '#10b981',
  currentStepBg: '#1f3a3a',
  emptyMessage: '#999999',
};

/**
 * Create an SVG element with given attributes.
 * @param {string} tag - SVG element tag name (e.g., 'svg', 'rect', 'text')
 * @param {Object} attrs - Attributes to set on the element
 * @returns {SVGElement} The created SVG element
 */
function createSvgElement(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      el.setAttribute(key, value);
    }
  });
  return el;
}

/**
 * Render a sequence diagram as an SVG element.
 * @param {Object|null} flowSpec - Flow specification with actors and steps
 * @param {string[]} flowSpec.actors - List of actor names
 * @param {Object[]} flowSpec.steps - Array of step objects
 * @param {string} flowSpec.steps[].id - Unique step identifier
 * @param {string} flowSpec.steps[].fromActor - Source actor name
 * @param {string} flowSpec.steps[].toActor - Target actor name
 * @param {string} flowSpec.steps[].label - Step label/description
 * @param {number} canvasWidth - Diagram width in pixels
 * @param {number} canvasHeight - Diagram height in pixels
 * @param {string|null} currentStep - ID of the currently active step
 * @returns {SVGElement} The rendered SVG element
 */
function renderDiagram(flowSpec, canvasWidth, canvasHeight, currentStep = null) {
  // Create root SVG element
  const svg = createSvgElement('svg', {
    width: canvasWidth,
    height: canvasHeight,
    viewBox: `0 0 ${canvasWidth} ${canvasHeight}`,
    xmlns: 'http://www.w3.org/2000/svg',
    'xmlns:xlink': 'http://www.w3.org/1999/xlink',
  });

  // Draw background
  const background = createSvgElement('rect', {
    width: canvasWidth,
    height: canvasHeight,
    fill: COLORS.background,
  });
  svg.appendChild(background);

  // Handle empty spec
  if (!flowSpec || !flowSpec.actors || flowSpec.actors.length === 0) {
    const emptyText = createSvgElement('text', {
      x: canvasWidth / 2,
      y: canvasHeight / 2,
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      fill: COLORS.emptyMessage,
      'font-size': '16px',
      'font-family': 'system-ui, -apple-system, sans-serif',
    });
    emptyText.textContent = 'No flow specification provided';
    svg.appendChild(emptyText);
    return svg;
  }

  const actors = flowSpec.actors || [];
  const steps = flowSpec.steps || [];

  // Calculate positions
  const startX = MARGIN;
  const startY = MARGIN + HEADER_HEIGHT;
  const laneSpacing = LANE_WIDTH;

  // Draw actor headers
  actors.forEach((actor, idx) => {
    const x = startX + idx * laneSpacing;

    // Header background
    const headerBg = createSvgElement('rect', {
      x,
      y: MARGIN,
      width: LANE_WIDTH - 5,
      height: HEADER_HEIGHT,
      fill: COLORS.headerBg,
      rx: 4,
    });
    svg.appendChild(headerBg);

    // Header text
    const text = createSvgElement('text', {
      x: x + (LANE_WIDTH - 5) / 2,
      y: MARGIN + HEADER_HEIGHT / 2,
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      fill: COLORS.headerText,
      'font-size': '14px',
      'font-weight': 'bold',
      'font-family': 'system-ui, -apple-system, sans-serif',
    });
    text.textContent = actor;
    svg.appendChild(text);

    // Vertical dashed lane line
    const laneLine = createSvgElement('line', {
      x1: x + (LANE_WIDTH - 5) / 2,
      y1: MARGIN + HEADER_HEIGHT,
      x2: x + (LANE_WIDTH - 5) / 2,
      y2: startY + (steps.length + 1) * STEP_HEIGHT,
      stroke: COLORS.laneLine,
      'stroke-dasharray': '5,5',
      'stroke-width': 1,
    });
    svg.appendChild(laneLine);
  });

  // Draw steps
  steps.forEach((step, stepIdx) => {
    if (!step || !step.fromActor || !step.toActor) return;

    const fromIdx = actors.indexOf(step.fromActor);
    const toIdx = actors.indexOf(step.toActor);

    if (fromIdx === -1 || toIdx === -1) return;

    const stepY = startY + stepIdx * STEP_HEIGHT;
    const fromX = startX + fromIdx * laneSpacing + (LANE_WIDTH - 5) / 2;
    const toX = startX + toIdx * laneSpacing + (LANE_WIDTH - 5) / 2;
    const minX = Math.min(fromX, toX);
    const maxX = Math.max(fromX, toX);
    const stepWidth = maxX - minX;
    const stepX = minX - 10;

    // Determine if this is the current step
    const isCurrentStep = currentStep && step.id === currentStep;

    // Step background box
    const stepBg = createSvgElement('rect', {
      x: stepX,
      y: stepY,
      width: stepWidth + 20,
      height: STEP_HEIGHT - 10,
      fill: isCurrentStep ? COLORS.currentStepBg : COLORS.stepBg,
      stroke: isCurrentStep ? COLORS.currentStepBorder : COLORS.stepBorder,
      'stroke-width': isCurrentStep ? 3 : 1,
      rx: 2,
    });
    svg.appendChild(stepBg);

    // Step label text
    const labelText = createSvgElement('text', {
      x: stepX + (stepWidth + 20) / 2,
      y: stepY + (STEP_HEIGHT - 10) / 2,
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      fill: COLORS.text,
      'font-size': '12px',
      'font-family': 'system-ui, -apple-system, sans-serif',
    });
    labelText.textContent = step.label || `${step.fromActor} → ${step.toActor}`;
    svg.appendChild(labelText);

    // Arrow line from source to target
    const arrow = createSvgElement('line', {
      x1: fromX,
      y1: stepY + 5,
      x2: toX,
      y2: stepY + 5,
      stroke: isCurrentStep ? COLORS.currentStepBorder : COLORS.stepBorder,
      'stroke-width': isCurrentStep ? 2 : 1,
      'marker-end': `url(#arrowhead-${isCurrentStep ? 'current' : 'normal'})`,
    });
    svg.appendChild(arrow);
  });

  // Define arrow markers
  const defs = createSvgElement('defs');

  const normalArrow = createSvgElement('marker', {
    id: 'arrowhead-normal',
    markerWidth: 10,
    markerHeight: 10,
    refX: 9,
    refY: 3,
    orient: 'auto',
  });
  const normalPath = createSvgElement('polygon', {
    points: '0 0, 10 3, 0 6',
    fill: COLORS.stepBorder,
  });
  normalArrow.appendChild(normalPath);
  defs.appendChild(normalArrow);

  const currentArrow = createSvgElement('marker', {
    id: 'arrowhead-current',
    markerWidth: 10,
    markerHeight: 10,
    refX: 9,
    refY: 3,
    orient: 'auto',
  });
  const currentPath = createSvgElement('polygon', {
    points: '0 0, 10 3, 0 6',
    fill: COLORS.currentStepBorder,
  });
  currentArrow.appendChild(currentPath);
  defs.appendChild(currentArrow);

  svg.appendChild(defs);

  return svg;
}

export {
  renderDiagram,
  LANE_WIDTH,
  HEADER_HEIGHT,
  STEP_HEIGHT,
  MARGIN,
  COLORS,
};
