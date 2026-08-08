# Daystar Bus Booking System

A Node.js + Express + SQLite bus booking app with a browser-based ticket flow and a Chrome extension shell.

## Run locally

```bash
npm install
node backend/server.js
```

## Deploy to Render

1. Push this project to GitHub.
2. Create a MongoDB Atlas cluster and database user.
3. Import the repository in Render.
4. Select the Render blueprint file `render.yaml`.
5. Set the environment variables listed in `DEPLOYMENT_CHECKLIST.md`.
6. Deploy the service and open `/health` to confirm it is live.

## Optional environment variables

- `MONGODB_URI` for MongoDB support
- `MPESA_CONSUMER_KEY`
- `MPESA_CONSUMER_SECRET`
- `MPESA_SHORTCODE`
- `MPESA_PASSKEY`
- `MPESA_CALLBACK_URL`
