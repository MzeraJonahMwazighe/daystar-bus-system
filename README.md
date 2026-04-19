# Daystar Bus Booking System

A comprehensive bus booking system for Daystar University.

## Project Structure

```
daystar-bus-system/
├── frontend/
│   ├── index.html           # Landing page
│   ├── campus.html          # Campus & destination selection
│   ├── trips.html           # Bus list & seat selection
│   ├── payment.html         # Payment page
│   ├── ticket.html          # Ticket display with QR code
│   ├── css/
│   │   └── styles.css       # Main stylesheet
│   └── js/
│       └── (future JS files)
├── backend/
│   ├── server.js            # Express server
│   ├── routes/
│   │   ├── buses.js         # Bus routes
│   │   ├── bookings.js      # Booking routes
│   │   └── payments.js      # Payment routes
│   ├── controllers/
│   └── database/
├── database/
│   └── schema.sql           # Database schema
├── package.json
├── .env
└── README.md
```

## Features

- **Bus Selection**: Select from Nairobi and Athi River campuses
- **Seat Selection**: Dynamic seat layouts for 45-seat and 29-seat buses
- **Professional Seat States**: Available, Selected, Booked, Reserved
- **Payment Integration**: M-Pesa payment validation
- **QR Ticket Generation**: Travel tickets with QR codes
- **Dynamic Pricing**: Route-based fare calculation

## Bus Configurations

### NEW BUSES (45 seats)
- Layout: 2 left + aisle + 3 right
- Plates: KDA347R, KDC234K, KDE456K, KCY564K

### OLD BUSES (29 seats)
- Layout: 2 left + aisle + 2 right
- Plates: KCU978S, KBX319D, KBX514D, KCU453E

## Fare Structure

- Nairobi ↔ Athi: KSH 200
- Any location → Syokimau: KSH 150

## Installation

1. Install dependencies:
```bash
npm install
```

2. Initialize database:
```bash
# Run schema.sql to set up database
```

3. Start server:
```bash
npm start
# For development with nodemon:
npm run dev
```

4. Access system:
```
http://localhost:3000
```

## API Endpoints

- `GET /api/health` - Health check
- `GET /api/buses` - Get all buses
- `GET /api/buses/:plate` - Get bus details
- `POST /api/bookings` - Create booking
- `POST /api/payments/mpesa` - Process M-Pesa payment
- `GET /api/payments/verify/:transactionId` - Verify payment

## Technology Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Backend**: Node.js, Express.js
- **Database**: SQLite
- **Payment**: M-Pesa integration (simulated)

## Reserved Seats

Seats 1 and 2 on all buses are reserved by default and cannot be selected.

## Default User Flow

1. index.html → Campus & destination selection
2. campus.html → Bus list
3. trips.html → Seat selection with live summary
4. payment.html → M-Pesa payment
5. ticket.html → QR code ticket

---

Developed for Daystar University Bus Booking System
