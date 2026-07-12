# CourseFoundry

Video-native adaptive learning platform.

## Local Setup

1. Copy environment defaults:

   ```bash
   cp .env.example .env
   ```

2. Install JavaScript dependencies:

   ```bash
   npm install
   ```

3. Install Python pipeline dependencies:

   ```bash
   cd pipeline
   uv sync --extra dev --python 3.12
   cd ..
   ```

4. Start the full local stack:

   ```bash
   docker compose up --build
   ```

5. Verify service health:

   ```bash
   npm run test:health
   ```

The web service exposes `http://localhost:3000/api/health`.
The pipeline service exposes `http://localhost:8000/health`.

## Architecture Decisions

Confirmed decisions are tracked in `implementation.md`.
