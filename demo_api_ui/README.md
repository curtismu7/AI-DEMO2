# Banking Admin Client

A React-based administrative interface for banking operations, providing user management, account oversight, and transaction monitoring capabilities.

## Features

- User Dashboard with account overview
- Transaction management and monitoring
- Activity logs and audit trails
- Account management interface
- Real-time data visualization with charts
- Responsive design for desktop and mobile

## Prerequisites

Before running this project, make sure you have the following installed:

- [Node.js](https://nodejs.org/) (version 14 or higher)
- [npm](https://www.npmjs.com/) (comes with Node.js)

## Getting Started

### 1. Clone the Repository

```bash
git clone <your-repository-url>
cd banking_api_ui
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Setup

Copy the example environment file and configure your settings:

```bash
cp .env.example .env
```

Edit the `.env` file with your specific configuration:

```
PORT=3000
REACT_APP_API_URL=http://localhost:3001
REACT_APP_CLIENT_URL=http://localhost:3000
REACT_APP_ENDUSER_AUDIENCE=your_enduser_audience_here
REACT_APP_AI_AGENT_AUDIENCE=your_ai_agent_audience_here
```

### 4. Start the Development Server

```bash
npm start
```

The application will automatically open in your browser at [http://localhost:3000](http://localhost:3000).

> **Note:** Make sure your backend API server is running on port 3001 before starting the client application.

## Available Scripts

- `npm start` - Runs the app in development mode
- `npm test` - Launches the test runner in interactive watch mode
- `npm run build` - Builds the app for production to the `build` folder
- `npm run eject` - **Note: this is a one-way operation. Once you eject, you can't go back!**

## Project Structure

```
src/
├── components/
│   ├── Accounts.js          # Account management interface
│   ├── ActivityLogs.js      # Activity logging component
│   ├── Dashboard.js         # Main dashboard view
│   ├── Header.js            # Navigation header
│   ├── Login.js             # Authentication component
│   ├── Transactions.js      # Transaction management
│   ├── UserDashboard.js     # User-specific dashboard
│   ├── UserDashboard.css    # Dashboard styling
│   └── Users.js             # User management interface
├── App.js                   # Main application component
├── App.css                  # Global application styles
├── index.js                 # Application entry point
└── index.css                # Base styles
```

## Dependencies

### Core Dependencies
- **React 18.2.0** - UI framework
- **React Router DOM 6.3.0** - Client-side routing
- **Axios 1.4.0** - HTTP client for API requests

### UI & Visualization
- **Chart.js 4.3.0** & **React-ChartJS-2 5.2.0** - Data visualization
- **React Table 7.8.0** - Table components
- **Date-fns 2.30.0** - Date manipulation utilities

### Testing
- **@testing-library/react** - React testing utilities
- **@testing-library/jest-dom** - Custom Jest matchers

## API Integration

This application is configured to work with a backend API running on `http://localhost:3001`. Make sure your backend server is running before starting the client application.

The proxy configuration in `package.json` automatically forwards API requests to the backend server during development.

## Building for Production

To create a production build:

```bash
npm run build
```

This creates a `build` folder with optimized production files ready for deployment.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is private and proprietary.