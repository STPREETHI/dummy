FROM node:18-alpine

WORKDIR /app

# Bootstrap a CRA app and inject DevPilot dashboard
RUN npx --yes create-react-app devpilot-ui --template cra-template 2>/dev/null || true

WORKDIR /app/devpilot-ui

RUN npm install recharts 2>/dev/null || true

# Copy our dashboard component as the app entry point
COPY DevPilotDashboard.jsx src/App.jsx

ENV REACT_APP_API_URL=http://localhost:8000

EXPOSE 3000

CMD ["npm", "start"]
