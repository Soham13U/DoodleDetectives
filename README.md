# <DoodleDetectives>

- Server: Node/Express + Socket.IO (TypeScript)
- Frontend: Vite + React + TypeScript

## Dev
Server:
  cd server
  npm i
  npm run dev

Frontend:
  cd frontend
  npm i
  npm run dev
  # expects VITE_SERVER_URL (default http://localhost:3020)

## Build
Server: npm run build && node dist/index.js
Frontend: npm run build (outputs to frontend/dist)

## Env
Frontend: VITE_SERVER_URL
Server: PORT (defaults to 3020), ALLOWED_ORIGIN (for CORS)