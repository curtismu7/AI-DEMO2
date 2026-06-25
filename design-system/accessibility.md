# Accessibility Guidelines

## Overview
Comprehensive accessibility guidelines for the PingOne Banking Demo design system, ensuring WCAG 2.1 AA compliance and inclusive design practices.

## WCAG 2.1 AA Compliance Requirements

### 1. Perceivable
Information and user interface components must be presentable to users in ways they can perceive.

#### 1.1 Text Alternatives
- **Images**: All meaningful images must have descriptive alt text
- **Icons**: Icon-only buttons must have aria-label or aria-labelledby
- **Charts/Diagrams**: Complex images need detailed descriptions
- **Decorative Images**: Use alt="" or role="presentation"

#### 1.2 Time-Based Media
- **Captions**: Videos must have accurate captions
- **Audio Descriptions**: Visual content in videos must be described
- **Transcripts**: Provide transcripts for audio/video content

#### 1.3 Adaptable
- **Semantic HTML**: Use proper HTML elements for their purpose
- **Reading Order**: Content must maintain logical reading order
- **Structure**: Use proper heading hierarchy (h1-h6)
- **Landmarks**: Use ARIA landmarks (header, nav, main, footer)

#### 1.4 Distinguishable
- **Color**: Don't use color alone to convey information
- **Contrast**: Text must have 4.5:1 contrast ratio (3:1 for large text)
- **Audio**: Background audio must be controllable
- **Separation**: Text must be separable from background

### 2. Operable
User interface components and navigation must be operable.

#### 2.1 Keyboard Accessible
- **All Functions**: All functionality must be available via keyboard
- **No Keyboard Trap**: Focus must not be trapped
- **Focus Order**: Logical tab order
- **Time Limits**: Provide sufficient time for users

#### 2.2 Enough Time
- **Timeouts**: Allow users to turn off or extend timeouts
- **Pause/Stop**: Provide controls for moving content
- **Re-authentication**: Don't require re-authentication after timeouts
- **Warnings**: Warn before timeouts

#### 2.3 Seizures and Physical Reactions
- **Flashing**: No flashing content more than 3 times per second
- **Motion**: Avoid motion that can cause seizures
- **Controls**: Provide controls for motion

#### 2.4 Navigable
- **Bypass Blocks**: Provide skip links for navigation
- **Page Titles**: Descriptive page titles
- **Focus Order**: Logical focus order
- **Link Purpose**: Clear link destinations

### 3. Understandable
Information and the operation of user interface must be understandable.

#### 3.1 Readable
- **Language**: Specify language of page content
- **Reading Level**: Content should be readable
- **Pronunciation**: Provide pronunciation for unusual words
- **Abbreviations**: Explain abbreviations

#### 3.2 Predictable
- **Consistent Navigation**: Navigation should be consistent
- **Consistent Identification**: Elements should be consistent
- **Context Changes**: Warn before context changes
- **Input Assistance**: Help users avoid mistakes

#### 3.3 Input Assistance
- **Error Identification**: Identify errors clearly
- **Labels**: Labels must be descriptive
- **Instructions**: Provide instructions for user input
- **Error Prevention**: Prevent errors when possible

### 4. Robust
Content must be robust enough to be interpreted reliably by a wide variety of user agents, including assistive technologies.

#### 4.1 Compatible
- **Markup**: Use valid HTML
- **ARIA**: Use ARIA correctly
- **Assistive Technology**: Support assistive technologies
- **Future Proof**: Design for future technologies

## Implementation Guidelines

### 1. Semantic HTML

#### Headings
```html
<!-- Good -->
<h1>Main Page Title</h1>
<h2>Section Title</h2>
<h3>Subsection Title</h3>

<!-- Bad -->
<div class="title">Main Page Title</div>
<div class="section-title">Section Title</div>
```

#### Lists
```html
<!-- Good -->
<nav>
  <ul>
    <li><a href="/home">Home</a></li>
    <li><a href="/dashboard">Dashboard</a></li>
  </ul>
</nav>

<!-- Bad -->
<div class="nav">
  <span class="nav-item">Home</span>
  <span class="nav-item">Dashboard</span>
</div>
```

#### Forms
```html
<!-- Good -->
<form>
  <fieldset>
    <legend>Personal Information</legend>
    <label for="name">Name:</label>
    <input type="text" id="name" name="name" required>
    <label for="email">Email:</label>
    <input type="email" id="email" name="email" required>
  </fieldset>
</form>

<!-- Bad -->
<div class="form">
  <div class="field">
    <span>Name:</span>
    <input type="text" placeholder="Name">
  </div>
  <div class="field">
    <span>Email:</span>
    <input type="text" placeholder="Email">
  </div>
</div>
```

### 2. Keyboard Navigation

#### Focus Management
```jsx
// Good focus management
const Modal = ({ isOpen, onClose, children }) => {
  const modalRef = useRef(null);
  
  useEffect(() => {
    if (isOpen) {
      modalRef.current?.focus();
      // Trap focus within modal
      trapFocus(modalRef.current);
    }
  }, [isOpen]);
  
  return isOpen ? (
    <div ref={modalRef} tabIndex={-1} role="dialog">
      {children}
      <button onClick={onClose}>Close</button>
    </div>
  ) : null;
};
```

#### Skip Links
```html
<!-- Skip to main content -->
<a href="#main-content" class="skip-link">
  Skip to main content
</a>

<main id="main-content">
  <!-- Main content -->
</main>
```

#### Keyboard Events
```jsx
// Handle keyboard events
const Button = ({ onClick, children, ...props }) => {
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };
  
  return (
    <button
      onClick={onClick}
      onKeyDown={handleKeyDown}
      {...props}
    >
      {children}
    </button>
  );
};
```

### 3. ARIA Usage

#### Landmarks
```html
<header role="banner">
  <nav role="navigation">
    <ul>
      <li><a href="/">Home</a></li>
      <li><a href="/dashboard">Dashboard</a></li>
    </ul>
  </nav>
</header>

<main role="main">
  <!-- Main content -->
</main>

<aside role="complementary">
  <!-- Sidebar content -->
</aside>

<footer role="contentinfo">
  <!-- Footer content -->
</footer>
```

#### Dynamic Content
```jsx
// Live regions for dynamic content
const StatusMessage = ({ message, type }) => {
  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      {message}
    </div>
  );
};
```

#### Descriptions
```jsx
// Complex descriptions
const ComplexButton = ({ icon, label, description }) => {
  const descriptionId = useId();
  
  return (
    <>
      <button
        aria-describedby={descriptionId}
        aria-label={label}
      >
        {icon}
      </button>
      <div id={descriptionId} className="sr-only">
        {description}
      </div>
    </>
  );
};
```

### 4. Color and Contrast

#### Contrast Requirements
```css
/* Good contrast ratios */
.text-primary {
  color: #0f172a; /* 15.8:1 contrast on white */
}

.text-secondary {
  color: #475569; /* 7.1:1 contrast on white */
}

.text-tertiary {
  color: #64748b; /* 4.5:1 contrast on white */
}

/* Large text can have lower contrast */
.text-large {
  font-size: 1.25rem;
  color: #64748b; /* 4.5:1 contrast on white */
}
```

#### Color Independence
```css
/* Don't rely on color alone */
.error {
  color: #dc2626;
  border-left: 4px solid #dc2626;
  padding-left: 1rem;
}

.success {
  color: #16a34a;
  border-left: 4px solid #16a34a;
  padding-left: 1rem;
}

/* Use icons and text together */
.required {
  color: #dc2626;
}

.required::after {
  content: "*";
  color: #dc2626;
  font-weight: bold;
}
```

### 5. Form Accessibility

#### Labels and Descriptions
```jsx
const FormField = ({ label, error, hint, required, children }) => {
  const fieldId = useId();
  const errorId = useId();
  const hintId = useId();
  
  return (
    <div>
      <label htmlFor={fieldId}>
        {label}
        {required && <span aria-label="required">*</span>}
      </label>
      
      {hint && (
        <div id={hintId} className="form-hint">
          {hint}
        </div>
      )}
      
      {React.cloneElement(children, {
        id: fieldId,
        'aria-describedby': [
          hint ? hintId : null,
          error ? errorId : null
        ].filter(Boolean).join(' '),
        'aria-invalid': !!error,
        'aria-required': required
      })}
      
      {error && (
        <div id={errorId} className="form-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
};
```

#### Error Handling
```jsx
const FormValidation = ({ errors }) => {
  const errorCount = Object.keys(errors).length;
  
  return (
    <>
      {errorCount > 0 && (
        <div role="alert" aria-live="polite">
          <h2>Form Validation Errors</h2>
          <p>Please correct the following {errorCount} errors:</p>
          <ul>
            {Object.entries(errors).map(([field, message]) => (
              <li key={field}>
                <a href={`#${field}`}>{field}</a>: {message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
};
```

### 6. Media Accessibility

#### Images
```jsx
const Image = ({ src, alt, decorative, ...props }) => {
  if (decorative) {
    return <img src={src} alt="" role="presentation" {...props} />;
  }
  
  return <img src={src} alt={alt} {...props} />;
};
```

#### Complex Images
```jsx
const Chart = ({ data, title }) => {
  const descriptionId = useId();
  
  return (
    <figure>
      <svg aria-labelledby={descriptionId}>
        {/* Chart content */}
      </svg>
      <figcaption id={descriptionId}>
        <h3>{title}</h3>
        <p>Detailed description of chart data and trends...</p>
      </figcaption>
    </figure>
  );
};
```

## Testing Guidelines

### 1. Automated Testing

#### Axe DevTools
```javascript
// Automated accessibility testing
import { axe, toHaveNoViolations } from 'jest-axe';

describe('Component Accessibility', () => {
  test('should not have accessibility violations', async () => {
    const { container } = render(<MyComponent />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

#### ESLint Rules
```json
{
  "extends": ["plugin:jsx-a11y/recommended"],
  "rules": {
    "jsx-a11y/alt-text": "error",
    "jsx-a11y/aria-props": "error",
    "jsx-a11y/aria-proptypes": "error",
    "jsx-a11y/interactive-supports-focus": "error",
    "jsx-a11y/keyboard-accessibility": "error"
  }
}
```

### 2. Manual Testing

#### Keyboard Navigation Checklist
- [ ] Tab through all interactive elements
- [ ] Verify logical tab order
- [ ] Test Enter and Space key activation
- [ ] Test arrow key navigation
- [ ] Verify focus indicators are visible
- [ ] Test escape key functionality
- [ ] Verify no keyboard traps

#### Screen Reader Testing
- [ ] Test with NVDA, JAWS, or VoiceOver
- [ ] Verify all images have alt text
- [ ] Test form field announcements
- [ ] Verify error message announcements
- [ ] Test navigation landmarks
- [ ] Verify dynamic content announcements
- [ ] Test table reading order

#### Visual Testing
- [ ] Test color contrast ratios
- [ ] Test with high contrast mode
- [ ] Test text resizing to 200%
- [ ] Test with different zoom levels
- [ ] Test with different screen resolutions
- [ ] Verify focus indicators are visible
- [ ] Test color blindness simulators

### 3. User Testing

#### Accessibility Testing with Users
- Test with users who use assistive technologies
- Test with users with motor impairments
- Test with users with visual impairments
- Test with users with cognitive disabilities
- Gather feedback on accessibility features
- Document accessibility issues and solutions

## Component-Specific Guidelines

### 1. Navigation Components

#### Header Navigation
```jsx
const Header = () => {
  return (
    <header role="banner">
      <nav role="navigation" aria-label="Main navigation">
        <ul>
          <li><a href="/" aria-current="page">Home</a></li>
          <li><a href="/dashboard">Dashboard</a></li>
          <li><a href="/accounts">Accounts</a></li>
        </ul>
      </nav>
    </header>
  );
};
```

#### Breadcrumb Navigation
```jsx
const Breadcrumb = ({ items }) => {
  return (
    <nav aria-label="Breadcrumb">
      <ol>
        {items.map((item, index) => (
          <li key={item.href}>
            {index > 0 && <span aria-hidden="true"> / </span>}
            <a
              href={item.href}
              aria-current={item.current ? 'page' : undefined}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
};
```

### 2. Form Components

#### Input Fields
```jsx
const Input = ({ label, error, hint, required, ...props }) => {
  const inputId = useId();
  const errorId = useId();
  const hintId = useId();
  
  return (
    <div>
      <label htmlFor={inputId}>
        {label}
        {required && <span aria-label="required">*</span>}
      </label>
      
      {hint && (
        <div id={hintId} className="form-hint">
          {hint}
        </div>
      )}
      
      <input
        id={inputId}
        aria-describedby={[
          hint ? hintId : null,
          error ? errorId : null
        ].filter(Boolean).join(' ')}
        aria-invalid={!!error}
        aria-required={required}
        {...props}
      />
      
      {error && (
        <div id={errorId} className="form-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
};
```

#### Buttons
```jsx
const Button = ({ children, icon, loading, disabled, ...props }) => {
  return (
    <button
      disabled={disabled || loading}
      aria-disabled={disabled || loading}
      aria-busy={loading}
      {...props}
    >
      {loading && <span aria-hidden="true">Loading...</span>}
      {icon && <span aria-hidden="true">{icon}</span>}
      <span className={icon || loading ? 'sr-only' : ''}>
        {children}
      </span>
    </button>
  );
};
```

### 3. Data Display Components

#### Tables
```jsx
const Table = ({ columns, data }) => {
  return (
    <table>
      <caption>{data.length} records found</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} scope="col">
              {column.sortable ? (
                <button
                  aria-label={`Sort by ${column.title}`}
                  aria-describedby={`sort-${column.key}`}
                >
                  {column.title}
                  <span id={`sort-${column.key}`} aria-hidden="true">
                    {column.sortDirection === 'asc' ? '↑' : '↓'}
                  </span>
                </button>
              ) : (
                column.title
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((row, index) => (
          <tr key={row.id}>
            {columns.map((column) => (
              <td key={column.key}>
                {row[column.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};
```

#### Progress Indicators
```jsx
const Progress = ({ value, max, label }) => {
  const percentage = Math.round((value / max) * 100);
  
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuetext={`${percentage}% ${label}`}
    >
      <div
        style={{ width: `${percentage}%` }}
        aria-hidden="true"
      />
      <span className="sr-only">{percentage}% {label}</span>
    </div>
  );
};
```

## Performance Considerations

### 1. Efficient ARIA Usage
- Use semantic HTML instead of ARIA when possible
- Avoid unnecessary ARIA attributes
- Use aria-hidden="true" for decorative elements
- Minimize live regions to avoid announcement fatigue

### 2. Focus Management
- Use efficient focus trapping
- Minimize DOM manipulations
- Use CSS for focus indicators
- Avoid expensive focus calculations

### 3. Screen Reader Optimization
- Provide concise, meaningful descriptions
- Use appropriate ARIA roles
- Avoid redundant announcements
- Test with multiple screen readers

## Documentation and Training

### 1. Developer Guidelines
- Document accessibility requirements
- Provide code examples and patterns
- Include accessibility in code reviews
- Create accessibility testing procedures

### 2. Design Guidelines
- Include accessibility in design system
- Provide color contrast guidelines
- Document focus indicator requirements
- Include accessibility in design reviews

### 3. Testing Procedures
- Create accessibility testing checklist
- Document testing tools and procedures
- Include accessibility in QA processes
- Provide accessibility testing training

## Compliance Verification

### 1. Automated Verification
```bash
# Run accessibility tests
npm run test:a11y

# Check contrast ratios
npm run test:contrast

# Validate HTML structure
npm run test:html
```

### 2. Manual Verification
- Keyboard navigation testing
- Screen reader testing
- Visual accessibility testing
- User testing with disabilities

### 3. Third-Party Verification
- WCAG compliance audit
- Accessibility expert review
- User testing with assistive technology
- Accessibility certification

## Continuous Improvement

### 1. Monitoring
- Track accessibility issues
- Monitor user feedback
- Analyze accessibility metrics
- Regular accessibility audits

### 2. Updates
- Stay current with WCAG guidelines
- Update accessibility knowledge
- Improve accessibility tools
- Enhance testing procedures

### 3. Training
- Regular accessibility training
- Accessibility best practices
- New technology accessibility
- User perspective training

## Conclusion

Accessibility is not an afterthought but a fundamental requirement for inclusive design. By following these guidelines, we can ensure that the PingOne Banking Demo is accessible to all users, regardless of their abilities or the assistive technologies they use.

Regular accessibility testing, user feedback, and continuous improvement are essential for maintaining high accessibility standards and ensuring that our application remains usable by everyone.
