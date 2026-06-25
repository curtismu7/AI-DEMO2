# Design System Components

## Overview
Component library documentation for the PingOne Banking Demo design system. This document provides guidelines for creating consistent, accessible, and reusable components.

## Component Principles

### 1. Accessibility First
- All components must meet WCAG 2.1 AA standards
- Semantic HTML elements are required
- Keyboard navigation must be supported
- Screen reader compatibility is mandatory
- Focus management must be implemented

### 2. Mobile-First Responsive Design
- Design for mobile screens first
- Progressive enhancement for larger screens
- Touch-friendly interaction areas
- Readable typography on all devices

### 3. Consistent Visual Language
- Use design tokens for all styling
- Maintain consistent spacing and typography
- Follow established color and shadow patterns
- Use consistent border radius and sizing

### 4. Performance Optimized
- Minimal JavaScript for interactions
- CSS-only solutions where possible
- Optimized animations and transitions
- Efficient rendering patterns

## Component Categories

### 1. Layout Components

#### Container
```jsx
<Container size="sm|md|lg|xl" fluid={false}>
  {/* Content */}
</Container>
```
- **Purpose**: Wrapper for content with consistent max-width and centering
- **Props**: size (max-width), fluid (full-width)
- **Accessibility**: Landmark region when appropriate

#### Grid
```jsx
<Grid cols={12} gap={4} responsive>
  <Grid.Col span={{ sm: 12, md: 6, lg: 4 }}>
    {/* Content */}
  </Grid.Col>
</Grid>
```
- **Purpose**: Flexible grid layout system
- **Props**: cols, gap, responsive breakpoints
- **Accessibility**: Proper landmark structure

#### Stack
```jsx
<Stack direction="vertical" spacing={4} align="start">
  {/* Content */}
</Stack>
```
- **Purpose**: Simple flexbox layout for stacking elements
- **Props**: direction, spacing, align, justify
- **Accessibility**: Logical content order

### 2. Navigation Components

#### Header
```jsx
<Header size="sm|md|lg" sticky={false}>
  <Header.Logo />
  <Header.Nav>
    <Header.NavItem href="#" active>Home</Header.NavItem>
    <Header.NavItem href="#">Dashboard</Header.NavItem>
  </Header.Nav>
  <Header.Actions>
    <Button variant="primary">Sign In</Button>
  </Header.Actions>
</Header>
```
- **Purpose**: Site/application header with navigation
- **Props**: size, sticky, transparent
- **Accessibility**: Proper nav landmarks, skip links

#### Breadcrumb
```jsx
<Breadcrumb>
  <Breadcrumb.Item href="/">Home</Breadcrumb.Item>
  <Breadcrumb.Item href="/dashboard">Dashboard</Breadcrumb.Item>
  <Breadcrumb.Item current>Accounts</Breadcrumb.Item>
</Breadcrumb>
```
- **Purpose**: Navigation breadcrumb trail
- **Props**: separator, maxItems
- **Accessibility**: Proper ARIA landmarks

### 3. Form Components

#### Input
```jsx
<Input
  type="text"
  label="Email Address"
  placeholder="Enter your email"
  error="Invalid email format"
  disabled={false}
  required
/>
```
- **Purpose**: Text input with label and validation
- **Props**: type, label, placeholder, error, disabled, required
- **Accessibility**: Proper label association, error announcements

#### Select
```jsx
<Select
  label="Account Type"
  placeholder="Select account type"
  options={[
    { value: 'checking', label: 'Checking Account' },
    { value: 'savings', label: 'Savings Account' }
  ]}
  error="Please select an account type"
/>
```
- **Purpose**: Dropdown selection input
- **Props**: label, placeholder, options, error, disabled
- **Accessibility**: Proper ARIA attributes

#### Checkbox
```jsx
<Checkbox
  label="Enable two-factor authentication"
  checked={false}
  onChange={handleChange}
  disabled={false}
  required
/>
```
- **Purpose**: Single checkbox input
- **Props**: label, checked, onChange, disabled, required
- **Accessibility**: Proper label association

#### Radio Group
```jsx
<RadioGroup
  label="Notification Preference"
  value={value}
  onChange={handleChange}
  options={[
    { value: 'email', label: 'Email Notifications' },
    { value: 'sms', label: 'SMS Notifications' }
  ]}
/>
```
- **Purpose**: Radio button group for single selection
- **Props**: label, value, onChange, options, disabled
- **Accessibility**: Fieldset and legend for grouping

### 4. Action Components

#### Button
```jsx
<Button
  variant="primary|secondary|outline|ghost"
  size="sm|md|lg"
  disabled={false}
  loading={false}
  icon={<Icon />}
  onClick={handleClick}
>
  Button Text
</Button>
```
- **Purpose**: Clickable action button
- **Props**: variant, size, disabled, loading, icon, onClick
- **Accessibility**: Proper button type, disabled state handling

#### Link
```jsx
<Link
  href="/dashboard"
  variant="primary|secondary"
  external={false}
  icon={<Icon />}
>
  Dashboard
</Link>
```
- **Purpose**: Navigation link
- **Props**: href, variant, external, icon
- **Accessibility**: Proper link semantics, external link indicators

#### IconButton
```jsx
<IconButton
  icon={<Icon />}
  label="Settings"
  variant="primary|secondary|ghost"
  size="sm|md|lg"
  disabled={false}
  onClick={handleClick}
/>
```
- **Purpose**: Icon-only button with accessibility label
- **Props**: icon, label, variant, size, disabled, onClick
- **Accessibility**: Proper aria-label for icon-only buttons

### 5. Display Components

#### Card
```jsx
<Card
  variant="default|elevated|outlined"
  padding="sm|md|lg"
  hover={false}
>
  <Card.Header>
    <Card.Title>Card Title</Card.Title>
    <Card.Actions>
      <Button variant="ghost" size="sm">Edit</Button>
    </Card.Actions>
  </Card.Header>
  <Card.Body>
    {/* Content */}
  </Card.Body>
  <Card.Footer>
    {/* Footer content */}
  </Card.Footer>
</Card>
```
- **Purpose**: Content container with optional header/footer
- **Props**: variant, padding, hover
- **Accessibility**: Proper semantic structure

#### Badge
```jsx
<Badge
  variant="primary|secondary|success|warning|error"
  size="sm|md|lg"
  dot={false}
>
  5
</Badge>
```
- **Purpose**: Small status indicator
- **Props**: variant, size, dot
- **Accessibility**: Status announcement when needed

#### Avatar
```jsx
<Avatar
  src="/path/to/image.jpg"
  alt="John Doe"
  size="sm|md|lg|xl"
  fallback="JD"
  status="online|offline|away|busy"
/>
```
- **Purpose**: User avatar with fallback
- **Props**: src, alt, size, fallback, status
- **Accessibility**: Proper alt text for images

### 6. Feedback Components

#### Alert
```jsx
<Alert
  variant="info|success|warning|error"
  title="Success"
  dismissible={true}
  onDismiss={handleDismiss}
>
  Your changes have been saved successfully.
</Alert>
```
- **Purpose**: Information or status message
- **Props**: variant, title, dismissible, onDismiss
- **Accessibility**: Role="alert", live regions

#### Toast
```jsx
<Toast
  variant="info|success|warning|error"
  title="Notification"
  duration={5000}
  onClose={handleClose}
>
  Message content
</Toast>
```
- **Purpose**: Temporary notification message
- **Props**: variant, title, duration, onClose
- **Accessibility**: Live region announcements

#### Skeleton
```jsx
<Skeleton
  variant="text|circle|rect"
  width="100%"
  height={20}
  lines={3}
  animate={true}
/>
```
- **Purpose**: Loading placeholder
- **Props**: variant, width, height, lines, animate
- **Accessibility**: aria-busy state

### 7. Data Display Components

#### Table
```jsx
<Table
  columns={columns}
  data={data}
  sortable={true}
  filterable={true}
  pagination={true}
  pageSize={10}
/>
```
- **Purpose**: Data table with sorting and filtering
- **Props**: columns, data, sortable, filterable, pagination
- **Accessibility**: Proper table semantics, sorting indicators

#### Progress
```jsx
<Progress
  value={75}
  max={100}
  variant="default|success|warning|error"
  size="sm|md|lg"
  showLabel={true}
  label="75% Complete"
/>
```
- **Purpose**: Progress indicator
- **Props**: value, max, variant, size, showLabel, label
- **Accessibility**: Proper aria attributes

#### Tooltip
```jsx
<Tooltip
  content="This action cannot be undone"
  placement="top|bottom|left|right"
  delay={300}
>
  <Button>Delete</Button>
</Tooltip>
```
- **Purpose**: Contextual help text
- **Props**: content, placement, delay
- **Accessibility**: Proper ARIA attributes

## Component Patterns

### 1. Form Patterns

#### Form Layout
```jsx
<form>
  <Stack direction="vertical" spacing={4}>
    <Input label="Email" type="email" required />
    <Input label="Password" type="password" required />
    <Checkbox label="Remember me" />
    <Button type="submit" variant="primary">Sign In</Button>
  </Stack>
</form>
```

#### Form Validation
```jsx
<Stack direction="vertical" spacing={4}>
  <Input
    label="Email"
    type="email"
    error={errors.email}
    required
    aria-invalid={!!errors.email}
    aria-describedby={errors.email ? 'email-error' : undefined}
  />
  {errors.email && (
    <Alert variant="error" id="email-error" role="alert">
      {errors.email}
    </Alert>
  )}
</Stack>
```

### 2. Loading Patterns

#### Skeleton Loading
```jsx
<Card>
  <Card.Header>
    <Skeleton variant="circle" width={40} height={40} />
    <Skeleton variant="text" width="60%" height={20} />
  </Card.Header>
  <Card.Body>
    <Skeleton variant="text" lines={3} />
  </Card.Body>
</Card>
```

#### Button Loading State
```jsx
<Button
  variant="primary"
  loading={isLoading}
  disabled={isLoading}
  onClick={handleSubmit}
>
  {isLoading ? 'Submitting...' : 'Submit'}
</Button>
```

### 3. Responsive Patterns

#### Responsive Grid
```jsx
<Grid cols={12} gap={4}>
  <Grid.Col span={{ sm: 12, md: 6, lg: 4 }}>
    <Card>Content 1</Card>
  </Grid.Col>
  <Grid.Col span={{ sm: 12, md: 6, lg: 4 }}>
    <Card>Content 2</Card>
  </Grid.Col>
  <Grid.Col span={{ sm: 12, md: 12, lg: 4 }}>
    <Card>Content 3</Card>
  </Grid.Col>
</Grid>
```

#### Responsive Navigation
```jsx
<Header>
  <Header.Logo />
  <Header.Nav responsive>
    <Header.NavItem href="#" responsive={{ sm: false, md: true }}>
      Dashboard
    </Header.NavItem>
    <Header.NavItem href="#" responsive={{ sm: false, md: true }}>
      Accounts
    </Header.NavItem>
    <Header.NavMenu responsive={{ sm: true, md: false }}>
      {/* Mobile menu items */}
    </Header.NavMenu>
  </Header.Nav>
</Header>
```

## Accessibility Guidelines

### 1. Semantic HTML
- Use appropriate HTML elements for their purpose
- Maintain proper heading hierarchy (h1-h6)
- Use landmarks (header, nav, main, footer, section, article)
- Ensure logical reading order

### 2. Keyboard Navigation
- All interactive elements must be keyboard accessible
- Implement proper focus management
- Provide visible focus indicators
- Support common keyboard shortcuts

### 3. Screen Reader Support
- Provide alternative text for images
- Use ARIA labels and descriptions appropriately
- Announce dynamic content changes
- Ensure form validation errors are announced

### 4. Color and Contrast
- Don't rely on color alone for meaning
- Ensure sufficient contrast ratios (4.5:1 for normal text)
- Support high contrast mode
- Test with color blindness simulators

## Performance Guidelines

### 1. CSS Optimization
- Use CSS variables for theming
- Minimize custom properties usage
- Avoid expensive CSS selectors
- Use efficient animations (transform, opacity)

### 2. JavaScript Optimization
- Minimize JavaScript for interactions
- Use event delegation where appropriate
- Implement proper cleanup for event listeners
- Avoid layout thrashing

### 3. Image Optimization
- Use appropriate image formats
- Implement lazy loading
- Provide responsive images
- Optimize image sizes

## Testing Guidelines

### 1. Visual Testing
- Test across different browsers
- Verify responsive behavior
- Check color contrast
- Test with different screen sizes

### 2. Accessibility Testing
- Test with keyboard navigation
- Use screen readers for validation
- Test with accessibility tools
- Verify ARIA attributes

### 3. Performance Testing
- Measure rendering performance
- Test animation smoothness
- Check memory usage
- Verify loading times

## Usage Guidelines

### 1. Consistency
- Follow established patterns
- Use design tokens consistently
- Maintain visual consistency
- Follow naming conventions

### 2. Composition
- Combine components thoughtfully
- Avoid over-nesting
- Use appropriate spacing
- Maintain visual hierarchy

### 3. Customization
- Use CSS variables for customization
- Avoid inline styles
- Maintain theme consistency
- Document customizations

## Migration Guide

### From Existing Components
1. **Identify**: Find components to replace
2. **Map**: Map old props to new props
3. **Replace**: Update component usage
4. **Test**: Verify functionality and appearance
5. **Clean**: Remove old component files

### Breaking Changes
- Document all breaking changes
- Provide migration paths
- Update documentation
- Communicate changes to team

## Future Enhancements

### Planned Components
- **DatePicker**: Date selection component
- **TimePicker**: Time selection component
- **FileUpload**: File upload component
- **Modal**: Modal dialog component
- **Drawer**: Slide-out drawer component

### Enhancements
- **Dark Mode**: Complete dark mode support
- **Internationalization**: Multi-language support
- **Advanced Animations**: More sophisticated animations
- **Advanced Testing**: Automated testing suite

## Conclusion

This design system provides a comprehensive foundation for building consistent, accessible, and performant user interfaces. By following these guidelines and using the documented components, we can ensure a cohesive user experience across the entire application.

Regular updates and improvements to this design system will ensure it remains current and continues to meet the needs of our users and development team.
