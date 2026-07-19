# Daystar Bus Booking System

A Node.js + Express + SQLite bus booking app with a browser-based ticket flow and a Chrome extension shell.

## Run locally

```bash
npm install
node backend/server.js
```

## Deploy to Render

1. Push this project to GitHub.
2. Import the repository in Render.
3. Select the Render blueprint file `render.yaml`.
4. Set any M-Pesa and MongoDB environment variables if required.

## Optional environment variables

- `MONGODB_URI` for MongoDB support
- `MPESA_CONSUMER_KEY`
- `MPESA_CONSUMER_SECRET`
- `MPESA_SHORTCODE`
- `MPESA_PASSKEY`
- `MPESA_CALLBACK_URL`
