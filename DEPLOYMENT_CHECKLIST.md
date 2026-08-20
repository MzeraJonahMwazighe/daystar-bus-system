# Deployment checklist for Daystar Bus Booking System

## 1. Create accounts
- GitHub account
- Render account (or Railway/other Node host)
- MongoDB Atlas account
- Optional: Daraja/M-Pesa developer account

## 2. Prepare the repository
- Ensure the project is pushed to GitHub
- Keep package.json, backend/server.js, render.yaml, and .env.example in the repo

## 3. Create MongoDB Atlas database
- Create a free cluster
- Create a database user
- Whitelist 0.0.0.0/0 for development or add your host IPs
- Copy the connection string

## 4. Set environment variables on the host
- PORT=3000
- NODE_ENV=production
- MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<dbname>?retryWrites=true&w=majority
- CORS_ORIGIN=https://your-app.onrender.com
- SOCKET_CORS_ORIGIN=https://your-app.onrender.com
- CLIENT_ORIGIN=https://your-app.onrender.com
- FRONTEND_URL=https://your-app.onrender.com

## 5. Deploy
- Import the GitHub repo into Render
- Use the existing render.yaml blueprint
- Deploy the service

## 6. Post-deployment checks
- Visit /health
- Visit /
- Test booking flow
- Test admin API

## 7. M-Pesa/Daraja integration
- Add MPESA_CONSUMER_KEY
- Add MPESA_CONSUMER_SECRET
- Add MPESA_SHORTCODE
- Add MPESA_PASSKEY
- Add MPESA_CALLBACK_URL
- Add MPESA_ENV=Sandbox or Production
- Note: For LOCAL development, MPESA_CALLBACK_URL must point to a public tunnel URL (e.g. ngrok) because Daraja cannot reach localhost directly — update this URL each time the tunnel restarts unless using a paid/static ngrok domain. For PRODUCTION, set MPESA_CALLBACK_URL to your permanent deployed callback URL (e.g. https://daystar-bus-system-dvd9.onrender.com/api/mpesa/callback).
